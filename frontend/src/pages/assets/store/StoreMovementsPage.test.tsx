import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, type StoreMovementRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { StoreMovementsPage } from './StoreMovementsPage'

const state = vi.hoisted(() => ({ editable: true }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => state.editable }) }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const LINE: StoreMovementRead['lines'][number] = { id: 1, item_id: 1, item_code: 'ST-0001', item_name_en: 'Tea', item_name_ar: 'شاي', counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: null, contains_unit_en: null, contains_unit_ar: null, art_kind: null, art_color: null, batch_id: 1, expiry_date: null, expiry_month_only: false, quantity: 2, noted_quantity: null, difference_reason: null }
const OUT: StoreMovementRead = { id: 1, kind: 'out', on: '2026-10-31', created_at: '2026-10-31T08:40:00Z', recorded_by_name: 'Officer One', recorded_by_name_ar: 'موظف', taken_by: 'Rashid', note: 'Reception', reason: null, note_file: null, lines: [LINE, { ...LINE, id: 2, batch_id: 2, quantity: 1 }] }
const IN: StoreMovementRead = { ...OUT, id: 2, kind: 'in', on: '2026-09-01', taken_by: null, lines: [{ ...LINE, noted_quantity: 3, difference_reason: 'One damaged' }] }
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter><StoreMovementsPage /></MemoryRouter></I18nextProvider></QueryClientProvider>)
  return client
}
beforeEach(async () => { vi.restoreAllMocks(); state.editable = true; await i18n.changeLanguage('en'); vi.spyOn(api, 'listStoreMovements').mockResolvedValue([OUT, IN]); vi.spyOn(api, 'deleteStoreHandover').mockResolvedValue(undefined) })
describe('Store movements', () => {
  it('groups rows by month and sums batch splits once per item', async () => {
    renderPage()
    expect(await screen.findByText('October 2026')).toBeInTheDocument()
    expect(screen.getByText('September 2026')).toBeInTheDocument()
    expect(screen.getByText('To Rashid')).toBeInTheDocument()
    expect(screen.getByText('From HQ')).toBeInTheDocument()
    expect(screen.getAllByText(/Recorded/, { exact: false }).length).toBeGreaterThan(0)
    expect(screen.getByText('×3')).toBeInTheDocument()
    const signed = screen.getByText('−3')
    expect(signed).toHaveAttribute('dir', 'ltr')
    expect(signed.closest('bdi[dir="auto"]')).toHaveTextContent('−3 cartons')
  })
  it('filters by kind and searches names or items', async () => {
    const user = userEvent.setup(); renderPage(); await screen.findByText('October 2026')
    await user.click(screen.getByRole('button', { name: /Received\s*1/ }))
    expect(screen.queryByText('October 2026')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /All\s*2/ }))
    await user.type(screen.getByRole('searchbox'), 'Rashid')
    expect(screen.getByText('October 2026')).toBeInTheDocument()
    expect(screen.queryByText('September 2026')).not.toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox')); await user.type(screen.getByRole('searchbox'), 'not found')
    expect(screen.getByRole('status')).toHaveTextContent('No records match this filter.')
  })
  it('shows all detail lines including noted versus received quantities', async () => {
    const user = userEvent.setup(); renderPage(); await user.click(await screen.findByRole('button', { name: /Monthly delivery.*Tea/ }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('Received on')).toBeInTheDocument()
    expect(dialog.getByText('ST-0001')).toBeInTheDocument()
    expect(dialog.getByText(/Note said 3 · received 2/)).toBeInTheDocument()
    expect(dialog.getByText('One damaged')).toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
  it.each([true, false])('gates handover deletion by store.edit=%s', async editable => {
    state.editable = editable; const user = userEvent.setup(); renderPage(); await user.click(await screen.findByRole('button', { name: /Handover.*Tea/ }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getAllByText('Undated batch', { exact: false })).toHaveLength(2)
    if (!editable) { expect(dialog.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument(); return }
    await user.click(dialog.getByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete handover?' })).getByRole('button', { name: 'Delete' }))
    expect(api.deleteStoreHandover).toHaveBeenCalledWith(1)
  })
  it.each(['en', 'ar'])('uses a neutral disposal label for an absent reason (%s)', async language => {
    await i18n.changeLanguage(language)
    vi.mocked(api.listStoreMovements).mockResolvedValue([{ ...OUT, kind: 'disposed', reason: null }])
    renderPage()
    expect(await screen.findByText(i18n.t('assets.store.movements.kind.disposed'), { selector: 'span.mt-1' })).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('assets.store.movements.reason.damaged'), { exact: false })).not.toBeInTheDocument()
  })
  it.each(['in', 'out'] as const)('isolates only signed digits, not Arabic counting and loose units (%s)', async kind => {
    await i18n.changeLanguage('ar')
    vi.mocked(api.listStoreMovements).mockResolvedValue([{ ...OUT, kind, lines: [{ ...LINE, contains_qty: 12, contains_unit_en: 'Jar', contains_unit_ar: 'علبة', quantity: 16 }] }])
    const user = userEvent.setup()
    renderPage()
    const signed = await screen.findByText(kind === 'in' ? '+1' : '−1')
    expect(signed).toHaveAttribute('dir', 'ltr')
    expect(signed.closest('bdi[dir="auto"]')).toHaveTextContent(`${kind === 'in' ? '+' : '−'}1 كرتون + 4 علبة`)
    await user.click(screen.getByRole('button', { name: /شاي/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(kind === 'in' ? '+1' : '−1')).toHaveAttribute('dir', 'ltr')
    expect(within(dialog).getByText('4')).toHaveAttribute('dir', 'ltr')
    for (const bdi of dialog.querySelectorAll('bdi[dir="ltr"]')) expect(bdi).not.toHaveTextContent(/كرتون|علبة/)
  })
  it('focuses Close rather than Delete and restores the opening row on Escape', async () => {
    const user = userEvent.setup()
    renderPage()
    const opener = await screen.findByRole('button', { name: /Handover.*Tea/ })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Handover' })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus())
    expect(within(dialog).getByRole('button', { name: 'Delete' })).not.toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(opener).toHaveFocus())
  })
  it('identifies the handover and irreversible action, with Cancel focused by default', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Handover.*Tea/ }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('dialog', { name: 'Delete handover?' })
    expect(confirm).toHaveTextContent('Rashid')
    expect(confirm).toHaveTextContent('2026-10-31')
    expect(confirm).toHaveTextContent('Tea ×3')
    expect(confirm).toHaveTextContent('This cannot be undone.')
    await waitFor(() => expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus())
    await user.keyboard('{Enter}')
    expect(api.deleteStoreHandover).not.toHaveBeenCalled()
  })
  it('separates the event date from the recording timestamp', async () => {
    vi.mocked(api.listStoreMovements).mockResolvedValue([{ ...OUT, on: '2026-10-30' }])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Handover.*Tea/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Event date').nextElementSibling).toHaveTextContent(/^Oct 30, 2026$/)
    expect(within(dialog).getByText('Recorded by', { selector: 'dt' }).nextElementSibling).toHaveTextContent(/Recorded Oct 31, 2026.*by Officer One/)
  })
  it('distinguishes a true empty feed from filtered results and announces no matches', async () => {
    vi.mocked(api.listStoreMovements).mockResolvedValue([])
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Deliveries, handovers and disposals will appear here once recorded.')
    expect(screen.getByRole('status')).toHaveTextContent('No store records yet.')
    expect(screen.queryByText('No records match this filter.')).not.toBeInTheDocument()
    await user.type(screen.getByRole('searchbox'), 'Tea')
    expect(screen.getByRole('status')).toHaveTextContent('No records match this filter.')
    expect(screen.queryByText('No store records yet.')).not.toBeInTheDocument()
  })
  it('shows unknown counts while loading and after an error, rather than zero', async () => {
    const { promise, reject } = Promise.withResolvers<StoreMovementRead[]>()
    vi.mocked(api.listStoreMovements).mockReturnValue(promise)
    renderPage()
    for (const label of ['All', 'Received', 'Handed out', 'Disposed']) {
      expect(screen.getByRole('button', { name: `${label}–` })).toBeInTheDocument()
    }
    reject(new Error('Unavailable'))
    await screen.findByRole('alert')
    for (const label of ['All', 'Received', 'Handed out', 'Disposed']) {
      expect(screen.getByRole('button', { name: `${label}–` })).toBeInTheDocument()
    }
  })
  it('announces the filtered record count politely', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('October 2026')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('status')).toHaveTextContent('2 records')
    await user.type(screen.getByRole('searchbox'), 'Rashid')
    expect(screen.getByRole('status')).toHaveTextContent('1 record')
    expect(within(screen.getByRole('status')).getByText('1')).toHaveAttribute('dir', 'ltr')
  })
  it('sends labelled inclusive date bounds and clears both dates', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('October 2026')
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-01' } })
    await waitFor(() => expect(api.listStoreMovements).toHaveBeenLastCalledWith({ from: '2026-10-01', to: undefined }))
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-31' } })
    await waitFor(() => expect(api.listStoreMovements).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-31' }))
    expect(screen.getByLabelText('From date').closest('bdi')).toHaveAttribute('dir', 'ltr')
    await user.click(screen.getByRole('button', { name: 'Clear dates' }))
    await waitFor(() => expect(screen.getByLabelText('From date')).toHaveValue(''))
    expect(screen.getByLabelText('To date')).toHaveValue('')
  })
})
