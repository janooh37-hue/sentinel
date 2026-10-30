import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
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
    expect(screen.getByText('To Rashid · recorded by Officer One')).toBeInTheDocument()
    expect(screen.getByText('From HQ · recorded by Officer One')).toBeInTheDocument()
    expect(screen.getByText('×3')).toBeInTheDocument()
    expect(screen.getByText('−3 cartons')).toHaveAttribute('dir', 'ltr')
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
    expect(screen.getByText('No records match this filter.')).toBeInTheDocument()
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
})
