import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, type StoreDashboard, type StoreDashboardBatch } from '@/lib/api'
import i18n from '@/lib/i18n'
import type * as ApiModule from '@/lib/api'
import { widgetRegistry } from '../widgetRegistry'
import { StoreExpiringWidget } from './StoreExpiringWidget'
import { StoreLowStockWidget } from './StoreLowStockWidget'
import type { WidgetTier } from './types'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return { ...actual, api: { ...actual.api, getStoreDashboard: vi.fn() } }
})

const batch: StoreDashboardBatch = {
  item_id: 1, item_code: 'ST-0001', item_name_en: 'Tea', item_name_ar: 'شاي',
  counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: null,
  contains_unit_en: null, contains_unit_ar: null, art_kind: null, art_color: null, batch_id: 1,
  expiry_date: '2026-10-01', expiry_month_only: false, on_hand: 3, days_left: -28,
}
const dashboard: StoreDashboard = {
  today: '2026-10-29', expiring_soon_days: 60,
  expired: [batch],
  expiring_soon: [{ ...batch, batch_id: 2, item_name_en: 'Water', item_name_ar: null, days_left: 10, expiry_date: '2026-11-08' }],
  low_stock: [{ ...batch, minimum_level: 5 }],
  usage: { months: [], rows: [] }, suggestions: [], last_count_on: null, last_delivery_on: null,
  counts_recorded: 0, usage_ready: false, suggestion_count: 0,
}

function renderWidget(kind: 'expiry' | 'low', tier: WidgetTier = 'list', rows = 2) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter>
    {kind === 'expiry' ? <StoreExpiringWidget tier={tier} rows={rows} /> : <StoreLowStockWidget tier={tier} rows={rows} />}
  </MemoryRouter></I18nextProvider></QueryClientProvider>)
}

beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.getStoreDashboard).mockResolvedValue(dashboard)
})

describe('Store widgets', () => {
  it.each<WidgetTier>(['glance', 'summary', 'tall', 'list'])('renders expiry and store links at %s tier', async (tier) => {
    renderWidget('expiry', tier)
    await screen.findByText('Batches expired or expiring within 60 days')
    expect(api.getStoreDashboard).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Expired', { exact: true })).toBeInTheDocument()
    if (tier === 'glance' || tier === 'summary') expect(screen.getByText('2')).toBeInTheDocument()
    for (const link of screen.getAllByRole('link')) expect(link).toHaveAttribute('href', '/holdings/store')
  })

  it.each<WidgetTier>(['glance', 'summary', 'tall', 'list'])('renders low stock at %s tier', async (tier) => {
    renderWidget('low', tier)
    if (tier === 'glance' || tier === 'summary') {
      expect(await screen.findByText('Items below their Minimum level')).toBeInTheDocument()
      expect(screen.getByText('1')).toBeInTheDocument()
    } else {
      expect(await screen.findByText('Tea')).toHaveAttribute('dir', 'auto')
      expect(screen.getByText('Carton')).toBeInTheDocument()
      expect(screen.getByText('Minimum level:')).toBeInTheDocument()
    }
  })

  it('lists expired batches first and caps rows with a remainder link', async () => {
    renderWidget('expiry', 'list', 1)
    const list = await screen.findByRole('list')
    expect(within(list).getByText('Tea')).toBeInTheDocument()
    expect(within(list).getByText('Expired')).toBeInTheDocument()
    expect(screen.queryByText('Water')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Additional batches: 1' })).toHaveAttribute('href', '/holdings/store')
    expect(within(list).getByText('ST-0001')).toHaveAttribute('dir', 'ltr')
  })

  it('uses the server expiry window', async () => {
    vi.mocked(api.getStoreDashboard).mockResolvedValue({ ...dashboard, expiring_soon_days: 45 })
    renderWidget('expiry', 'summary')
    expect(await screen.findByText('Batches expired or expiring within 45 days')).toBeInTheDocument()
  })

  it('uses Arabic names and units with the other name as fallback', async () => {
    await i18n.changeLanguage('ar')
    renderWidget('expiry')
    expect(await screen.findByText('شاي')).toBeInTheDocument()
    expect(screen.getByText('Water')).toBeInTheDocument()
    expect(screen.getAllByText('كرتون')).toHaveLength(2)
    expect(screen.getByText('منتهية الصلاحية')).toBeInTheDocument()
  })

  it.each(['expiry', 'low'] as const)('explains empty %s results', async (kind) => {
    vi.mocked(api.getStoreDashboard).mockResolvedValue({ ...dashboard, expired: [], expiring_soon: [], low_stock: [] })
    renderWidget(kind)
    expect(await screen.findByText(kind === 'expiry' ? 'No batches on hand are expired or expire within 60 days.' : 'No items with a Minimum level have stock below it.')).toBeInTheDocument()
  })

  it.each(['expiry', 'low'] as const)('retries failed %s requests', async (kind) => {
    vi.mocked(api.getStoreDashboard).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(dashboard)
    renderWidget(kind)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Tea')).toBeInTheDocument()
  })

  it.each(['store_expiring', 'store_low_stock'] as const)('gates %s by store.view', (id) => {
    expect(widgetRegistry[id].source).toBe('store')
    expect(widgetRegistry[id].available({ has: (cap) => cap === 'store.view' })).toBe(true)
    expect(widgetRegistry[id].available({ has: () => false })).toBe(false)
  })
})
