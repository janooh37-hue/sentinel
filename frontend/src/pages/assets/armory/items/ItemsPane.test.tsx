import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type ArmoryItemDetailRead, type ArmorySafeRead, type ArmoryStockTotals } from '@/lib/api'
import i18n from '@/lib/i18n'
import { ItemsPane } from './ItemsPane'

const caps = vi.hoisted(() => ({ view: true, edit: false }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => cap === 'armory.view' ? caps.view : cap === 'armory.edit' && caps.edit }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, email: 'armorer@example.test', employee_id: 'T-0001' }, status: 'authed' }) }))

const safe: ArmorySafeRead = { id: 11, name_en: 'Test Safe A', name_ar: 'خزنة اختبار أ', created_at: '2026-11-01T09:00:00Z', vehicle_site: null, duty_post: null }
const counted: ArmoryStockTotals = {
  opening_qty: 0, received_qty: 0, known_in_safe: 0, in_safe: 0, available_qty: 0, unrecorded_qty: null, out_on_shift: 0,
  in_custody: 0, in_repair: null, missing: null, lost: null, written_off: null, awaiting_rounds_decision: null,
  expended_rounds: null, lost_rounds: null, settled_rounds: null, expired_qty: null, book_total: 0,
}
const uncounted: ArmoryStockTotals = { ...counted, in_safe: null, opening_qty: null, book_total: null }
const item: ArmoryItemDetailRead = {
  id: 31, name_en: 'Test case', name_ar: 'حقيبة اختبار', kind: 'quantity', drawing: 'case', category: 'accessories', preset_key: null,
  optional_kit_ids: [], stock: [{ ...uncounted, safe }], totals: uncounted, serials: [], batches: [], recent_movements: [],
}
const zeroItem: ArmoryItemDetailRead = { ...item, id: 32, name_en: 'Test strap', name_ar: 'رباط اختبار', stock: [{ ...counted, safe }], totals: counted }

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onAddItem = vi.fn()
  const onReceive = vi.fn()
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}>
    <MemoryRouter initialEntries={['/holdings/armory?tab=items&safe=11']}>
      <ItemsPane safeId={11} safes={[safe]} onAddItem={onAddItem} onReceive={onReceive} />
    </MemoryRouter>
  </I18nextProvider></QueryClientProvider>)
  return { onAddItem, onReceive }
}

beforeEach(async () => {
  vi.restoreAllMocks()
  caps.view = true
  caps.edit = false
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listArmoryItems').mockResolvedValue([item, zeroItem])
  vi.spyOn(api, 'getArmoryItem').mockResolvedValue(item)
  vi.spyOn(api, 'getArmorySummary').mockResolvedValue({
    now_at: '2026-11-01T09:00:00Z', missing_firearm_count: 0, missing_firearms: [], overdue_count: 0, overdue: [],
    decision_count: 0, due_check_count: 0, expired_batch_count: 1, expiring_batch_count: 2,
    licences: { missing: 0, expired: 0, expiring: 0, valid: 0 }, former_open_count: 0,
  })
})

describe('armory catalogue', () => {
  it('shows known zero, unknown baseline and inapplicable fields separately without editor controls', async () => {
    mount()
    const unknownRow = await screen.findByRole('row', { name: /Test case/ })
    const zeroRow = screen.getByRole('row', { name: /Test strap/ })
    expect(within(unknownRow).getByRole('cell', { name: 'Total Not counted' })).toBeVisible()
    expect(within(zeroRow).getByRole('cell', { name: 'Total 0' })).toBeVisible()
    expect(within(zeroRow).getByRole('cell', { name: 'Not applicable' })).toBeVisible()
    expect(within(unknownRow).getByText('حقيبة اختبار')).toHaveAttribute('lang', 'ar')
    expect(screen.getByText('2 catalogue items')).toBeVisible()
    expect(await screen.findByText('Expired: 1 batch')).toBeVisible()
    expect(screen.getByText('Expiring soon: 2 batches')).toBeVisible()
    expect(api.getArmorySummary).toHaveBeenCalledWith(11)
    expect(screen.queryByRole('button', { name: /Add item|Receive stock/ })).not.toBeInTheDocument()
  })

  it('sends safe, selected filters and trimmed search, then clears search in place', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('link', { name: 'Test case' })
    expect(api.listArmoryItems).toHaveBeenCalledWith({ safe_id: 11, stock_view: 'all' })
    const category = screen.getByRole('combobox', { name: 'Category' })
    await user.selectOptions(category, within(category).getByRole('option', { name: 'Weapon accessories' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Stock view' }), 'needs_attention')
    const search = screen.getByRole('searchbox', { name: 'Search by item or serial' })
    await user.type(search, '  TEST-X  ')
    await waitFor(() => expect(api.listArmoryItems).toHaveBeenLastCalledWith({ safe_id: 11, category: 'accessories', q: 'TEST-X', stock_view: 'needs_attention' }))
    await user.click(screen.getByRole('button', { name: 'Clear search filter' }))
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
    await waitFor(() => expect(api.listArmoryItems).toHaveBeenLastCalledWith({ safe_id: 11, category: 'accessories', stock_view: 'needs_attention' }))
  })

  it('restores focus to the original item after opening and leaving detail', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('link', { name: 'Test case' }))
    expect(await screen.findByRole('heading', { name: 'Test case' })).toHaveFocus()
    expect(api.getArmoryItem).toHaveBeenCalledWith(31, 11)
    await user.click(screen.getByRole('link', { name: 'Back to items' }))
    expect(await screen.findByRole('link', { name: 'Test case' })).toHaveFocus()
  })

  it('hands editor actions their opener and keeps the receiving safe preset', async () => {
    caps.edit = true
    const user = userEvent.setup()
    const { onAddItem, onReceive } = mount()
    const add = screen.getByRole('button', { name: 'Add item' })
    const receive = screen.getByRole('button', { name: 'Receive stock' })
    await user.click(add)
    await user.click(receive)
    expect(onAddItem).toHaveBeenCalledWith(add)
    expect(onReceive).toHaveBeenCalledWith(receive, { safeId: 11 })
  })

  it('does not read protected stock with edit only', () => {
    caps.view = false
    caps.edit = true
    mount()
    expect(screen.queryByRole('heading', { name: 'Item catalogue' })).not.toBeInTheDocument()
    expect(api.listArmoryItems).not.toHaveBeenCalled()
    expect(api.getArmorySummary).not.toHaveBeenCalled()
  })
})
