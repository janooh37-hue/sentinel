import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type StoreCountRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { StoreCountsPage } from './StoreCountsPage'

const state = vi.hoisted(() => ({ mobile: false, editable: true }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => state.editable }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const COUNT: StoreCountRead = {
  id: 7, month: '2026-09', counted_on: '2026-09-20', note: 'Monthly shelf count',
  lines: [{
    id: 1, batch_id: 10, item_id: 1, item_code: 'ST-0001', item_name_en: 'Tea', item_name_ar: 'شاي',
    counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 24, contains_unit_en: 'jar', contains_unit_ar: 'علبة',
    expiry_date: '2028-09-30', expiry_month_only: true, quantity: 77,
  }], created_at: '2026-09-20T10:00:00', updated_at: null, created_by_user_id: 1,
}

function renderPage() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nextProvider i18n={i18n}><MemoryRouter><StoreCountsPage /></MemoryRouter></I18nextProvider></QueryClientProvider>)
}

beforeEach(async () => {
  vi.restoreAllMocks()
  state.mobile = false
  state.editable = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listStoreCounts').mockResolvedValue([COUNT])
})

describe('stock counts list', () => {
  it.each([false, true])('links editors to new and existing counts (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    renderPage()
    expect(await screen.findByRole('link', { name: '2026-09' })).toHaveAttribute('href', '/holdings/store/counts/7')
    expect(screen.getByRole('link', { name: 'New stock count' })).toHaveAttribute('href', '/holdings/store/counts/new')
    expect(screen.getByText('2026-09-20')).toBeInTheDocument()
    expect(screen.getByText('Monthly shelf count')).toBeInTheDocument()
    expect(screen.getByText('2026-09')).toHaveAttribute('dir', 'ltr')
  })

  it.each([false, true])('hides new/edit actions and expands saved quantities for read-only users (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    state.editable = false
    const user = userEvent.setup()
    renderPage()
    const expand = await screen.findByRole('button', { name: /2026-09/ })
    expect(screen.queryByRole('link', { name: 'New stock count' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '2026-09' })).not.toBeInTheDocument()
    await user.click(expand)
    expect(screen.getByText('Tea')).toBeInTheDocument()
    expect(screen.getByText('2028-09')).toBeInTheDocument()
    expect(screen.getByText('3 cartons + 5 jars')).toBeInTheDocument()
    expect(expand).toHaveAttribute('aria-expanded', 'true')
    await user.click(expand)
    expect(screen.queryByText('Tea')).not.toBeInTheDocument()
  })

  it('provides a retry after a load failure', async () => {
    vi.spyOn(api, 'listStoreCounts').mockRejectedValueOnce(new Error('Connection unavailable')).mockResolvedValueOnce([COUNT])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Monthly shelf count')).toBeInTheDocument()
  })

  it('explains how to record the first count', async () => {
    vi.spyOn(api, 'listStoreCounts').mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No stock counts recorded')).toBeInTheDocument()
    expect(screen.getByText('A Store editor can record a monthly stock count to establish the quantities on the shelf.')).toBeInTheDocument()
  })
})
