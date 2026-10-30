import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, type StoreDashboard } from '@/lib/api'
import i18n from '@/lib/i18n'
import { StoreDashboardPage } from './StoreDashboardPage'
import { canOpenHqMaterialRequest, openHqMaterialRequest } from './hqRequest'

const state = vi.hoisted(() => ({ mobile: false }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => false }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('./hqRequest', () => ({ canOpenHqMaterialRequest: vi.fn(), openHqMaterialRequest: vi.fn() }))

const item = { item_id: 1, item_code: 'ST-0001', item_name_en: 'Tea', item_name_ar: 'شاي', counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 12, contains_unit_en: 'Jar', contains_unit_ar: 'علبة', art_kind: null, art_color: null }
const dashboard: StoreDashboard = {
  today: '2026-10-29', expiring_soon_days: 60,
  expired: [{ ...item, batch_id: 1, expiry_date: '2026-09-30', expiry_month_only: true, on_hand: 14, days_left: -29 }],
  expiring_soon: [{ ...item, batch_id: 2, expiry_date: '2026-11-10', expiry_month_only: false, on_hand: 24, days_left: 12 }],
  low_stock: [{ ...item, on_hand: 38, minimum_level: 48 }],
  usage: { months: ['2026-08', '2026-09', '2026-10'], rows: [{ ...item, values: [null, -2, 48] }] },
  suggestions: [{ ...item, average_usage: 23, on_hand: 10, suggested: 13, suggested_units: 2 }, { ...item, item_id: 2, item_code: 'ST-0002', item_name_en: 'Water', average_usage: 0, on_hand: 10, suggested: 0, suggested_units: 0 }],
  last_count_on: '2026-10-20', last_delivery_on: '2026-10-21',
  counts_recorded: 4, usage_ready: true, suggestion_count: 2,
}

function renderPage() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nextProvider i18n={i18n}><MemoryRouter><StoreDashboardPage /></MemoryRouter></I18nextProvider></QueryClientProvider>)
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state.mobile = false
  await i18n.changeLanguage('en')
  vi.mocked(canOpenHqMaterialRequest).mockReturnValue(true)
  vi.spyOn(api, 'getStoreDashboard').mockResolvedValue(dashboard)
  vi.spyOn(api, 'listStoreItems').mockResolvedValue([{ id: 1, code: item.item_code, name_en: 'Tea', name_ar: 'شاي', category_id: 1, category: { id: 1, name_en: 'Pantry', name_ar: 'ضيافة' }, counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 12, contains_unit_en: 'Jar', contains_unit_ar: 'علبة', art_kind: null, art_color: null, minimum_level: 48, archived_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: null, on_hand: 38, version: '1' }])
})

describe('Store dashboard', () => {
  it.each([false, true])('renders expiry, low stock, usage and suggestions (mobile=%s)', async mobile => {
    state.mobile = mobile
    renderPage()
    const expired = await screen.findByRole('region', { name: 'Expired batches' })
    expect(within(expired).getByText(/Expired ·/)).toBeInTheDocument()
    expect(within(expired).getByText(/29 days overdue/)).toBeInTheDocument()
    expect(within(expired).getByText('2026-09')).toBeInTheDocument()
    expect(within(expired).getByText('1 carton + 2 jars')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Expiring soon' })).toHaveTextContent('12 days left')
    expect(screen.getByRole('region', { name: 'Low stock' })).toHaveTextContent('4 cartons')
    const usage = screen.getByRole('region', { name: 'Monthly usage' })
    expect(within(usage).getByText('−2 jars')).toBeInTheDocument()
    expect(within(usage).getByText('Negative usage')).toBeInTheDocument()
    expect(within(usage).getByText('No data')).toHaveClass('sr-only')
    expect(within(usage).getByText('—')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText(/Negative usage means more stock was found/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Suggested request quantities' })).toHaveTextContent('2 cartons')
    expect(screen.getByText('2026-10-20')).toBeInTheDocument()
    expect(screen.getByText('2026-10-21')).toBeInTheDocument()
  })

  it('hides the HQ action without service permission', async () => {
    vi.mocked(canOpenHqMaterialRequest).mockReturnValue(false)
    renderPage()
    await screen.findByRole('heading', { name: 'Expired batches' })
    expect(screen.queryByRole('button', { name: 'Create HQ request' })).not.toBeInTheDocument()
  })

  it('opens an HQ request using only positive suggestions in whole counting units', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Create HQ request' }))
    expect(openHqMaterialRequest).toHaveBeenCalledWith(expect.any(Function), [{ code: 'ST-0001', description: 'Tea', unit: 'Carton', qty: 2 }])
  })

  it('explains how to establish usage and hides the request when suggestions are absent', async () => {
    vi.spyOn(api, 'getStoreDashboard').mockResolvedValue({ ...dashboard, usage: { months: [], rows: [] }, suggestions: [], last_count_on: null, last_delivery_on: null })
    renderPage()
    expect(await screen.findByText(/No usage window is available yet/)).toBeInTheDocument()
    expect(screen.getAllByText('None yet')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Create HQ request' })).not.toBeInTheDocument()
  })

  it('directs an empty store to the Items tab', async () => {
    vi.spyOn(api, 'listStoreItems').mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No store items yet')).toBeInTheDocument()
    expect(screen.getByText(/Add store items on the Items tab/)).toBeInTheDocument()
  })

  it('offers retry after a dashboard error', async () => {
    vi.spyOn(api, 'getStoreDashboard').mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(dashboard)
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Expired batches' })).toBeInTheDocument()
  })
})
