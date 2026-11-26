import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type ArmoryItemDetailRead, type ArmoryPersonCandidateRead, type ArmoryPostingRead, type ArmorySafeRead, type ArmorySerialDetailRead, type ArmoryStockTotals } from '@/lib/api'
import i18n from '@/lib/i18n'
import { ItemsPane } from './ItemsPane'

const caps = vi.hoisted(() => ({ edit: false }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => cap === 'armory.view' || cap === 'armory.edit' && caps.edit }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, email: 'armorer@example.test', employee_id: 'T-0001' }, status: 'authed' }) }))

const timestamp = '2026-11-01T09:00:00Z'
const safe: ArmorySafeRead = { id: 11, name_en: 'Test Safe A', name_ar: 'خزنة اختبار أ', created_at: timestamp, vehicle_site: null, duty_post: null }
const other: ArmorySafeRead = { ...safe, id: 12, name_en: 'Test Safe B', name_ar: 'خزنة اختبار ب' }
const witness: ArmoryPersonCandidateRead = {
  person: { employee_id: 'T-0002', name_en: 'Test Witness', name_ar: 'شاهد اختبار', employee_status: 'Active', is_former: false },
  on_duty_here: true, course_round: null, licence_status: 'missing', licence_expires_on: null, open_firearm: null,
}
const totals: ArmoryStockTotals = {
  opening_qty: 3, received_qty: 0, known_in_safe: 3, in_safe: 3, available_qty: 1, unrecorded_qty: 2, out_on_shift: 0,
  in_custody: 0, in_repair: 0, missing: 0, lost: 0, written_off: 0, awaiting_rounds_decision: null, expended_rounds: null,
  lost_rounds: null, settled_rounds: null, expired_qty: null, book_total: 3,
}
const zero: ArmoryStockTotals = { ...totals, opening_qty: 0, known_in_safe: 0, in_safe: 0, available_qty: 0, unrecorded_qty: 0, book_total: 0 }
const itemRef = { id: 31, name_en: 'Test equipment', name_ar: 'معدات اختبار', kind: 'firearm', drawing: 'rifle', category: 'firearms' } as const
const posting: ArmoryPostingRead = {
  id: 41, record_ref: 'TEST-M-001', kind: 'serial_registration', safe_id: 11, occurred_on: '2026-11-01', occurred_at: timestamp,
  voided_at: null, safe, destination_safe: null, related_posting_id: null, created_at: timestamp,
  actor: { user_id: 1, employee: null, display_name: null }, witness: null, person: null, reference: null, source: null,
  reason: null, note: null, serial_action: null, decision_outcome: null, voided_by: null, void_reason: null, void_witness: null,
  lines: [], discrepancy_ids: [],
}
const registered: ArmorySerialDetailRead = {
  id: 51, item: itemRef, serial_code: 'TEST-R-001', safe, state: 'in_safe', state_at: timestamp,
  last_posting_id: 41, assignment_id: null, holder: null, overdue_minutes: null, recent_movements: [posting],
}
const item: ArmoryItemDetailRead = {
  ...itemRef, preset_key: null, optional_kit_ids: [], totals, stock: [{ ...totals, safe }, { ...zero, safe: other }],
  serials: [registered], batches: [], recent_movements: [posting],
}

function mount(search = 'item=31', safeId: number | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onReceive = vi.fn()
  const tree = () => <QueryClientProvider client={client}><I18nextProvider i18n={i18n}>
    <MemoryRouter initialEntries={[`/holdings/armory?tab=items&${search}`]}>
      <ItemsPane safeId={safeId} safes={[safe, other]} onAddItem={vi.fn()} onReceive={onReceive} />
    </MemoryRouter>
  </I18nextProvider></QueryClientProvider>
  const result = render(tree())
  return { rerender: () => result.rerender(tree()), onReceive }
}

beforeEach(async () => {
  vi.restoreAllMocks()
  caps.edit = false
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'getArmoryItem').mockResolvedValue(item)
  vi.spyOn(api, 'getArmorySerial').mockResolvedValue(registered)
  vi.spyOn(api, 'listArmoryPeople').mockResolvedValue([witness])
  vi.spyOn(api, 'recordArmorySerials').mockResolvedValue(posting)
})

describe('armory item detail', () => {
  it('uses the Arabic serial-state vocabulary for missing balances and voided serials', async () => {
    await i18n.changeLanguage('ar')
    vi.mocked(api.getArmorySerial).mockResolvedValue({ ...registered, state: null, safe: null, state_at: null })
    mount('item=31&serial=51')
    expect(await screen.findByRole('columnheader', { name: 'مفقود قيد المراجعة' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'الكمية المستلمة' })).toBeInTheDocument()
    expect(await screen.findByText('مُبطل')).toBeVisible()
  })

  it('opens a selected serial history deep link for a viewer, preserves the Audit link and restores row focus', async () => {
    const user = userEvent.setup()
    mount('item=31&serial=51')
    const history = await screen.findByRole('region', { name: 'Serial history: TEST-R-001' })
    expect(api.getArmorySerial).toHaveBeenCalledWith(51)
    expect(screen.getByRole('link', { name: 'TEST-R-001' })).toHaveAttribute('aria-current', 'true')
    expect(within(history).getByRole('link', { name: /Serials recorded TEST-M-001/ })).toHaveAttribute('href', '/holdings/armory?tab=audit&pane=movements&movement=41')
    expect(within(history).getByText('TEST-R-001')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText('Serials not recorded: 2')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Add item|Receive stock|Record serials|Change state/ })).not.toBeInTheDocument()
    expect(api.listArmoryPeople).not.toHaveBeenCalled()
    await user.click(within(history).getByRole('link', { name: 'Close serial history' }))
    expect(screen.getByRole('link', { name: 'TEST-R-001' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Item history' }))
    expect(await screen.findByRole('link', { name: /Serials recorded TEST-M-001/ })).toBeVisible()
  })

  it('limits serial entry to known unrecorded units and requires independent evidence for firearm registration', async () => {
    caps.edit = true
    vi.mocked(api.recordArmorySerials).mockImplementationOnce(async () => {
      const settled = { ...totals, available_qty: 3, unrecorded_qty: 0 }
      vi.mocked(api.getArmoryItem).mockResolvedValue({
        ...item,
        totals: settled,
        stock: [{ ...settled, safe }, { ...zero, safe: other }],
        serials: [registered, { ...registered, id: 52, serial_code: 'TEST-1' }, { ...registered, id: 53, serial_code: 'TEST-2' }],
      })
      return posting
    })
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Record serials' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Record serials' }))
    const input = dialog.getByRole('textbox', { name: 'Serials to record' })
    const save = dialog.getByRole('button', { name: 'Save' })
    const safeInput = dialog.getByRole('combobox', { name: 'Safe' })
    expect(safeInput).toHaveValue('11')
    expect(within(safeInput).queryByRole('option', { name: 'Test Safe B' })).not.toBeInTheDocument()
    expect(dialog.getByText(/does not increase the stock balance/)).toBeVisible()
    fireEvent.change(input, { target: { value: 'test-١ TEST-1, TEST#2 TEST-3' } })
    expect(dialog.getAllByText('Entered more than once')).toHaveLength(2)
    expect(dialog.getByText('Use Latin letters, digits, dots, underscores, slashes or hyphens.')).toBeVisible()
    expect(dialog.getByText(/1 ready.*3 to fix/)).toBeVisible()
    expect(save).toBeDisabled()
    fireEvent.change(input, { target: { value: 'TEST-1 TEST-2 TEST-3' } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(save).toHaveAccessibleDescription('Up to 2 serials can be recorded for this safe.')
    expect(save).toBeDisabled()
    expect(api.recordArmorySerials).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'test-١; TEST-۲' } })
    const chooseWitness = await dialog.findByRole('button', { name: /Test Witness/ })
    await user.type(dialog.getByRole('textbox', { name: 'Reference' }), 'TEST-REF')
    expect(save).toBeDisabled()
    await user.click(chooseWitness)
    expect(save).toBeEnabled()
    await user.click(save)
    await waitFor(() => expect(api.recordArmorySerials).toHaveBeenCalledWith(31, {
      safe_id: 11, serial_codes: ['TEST-1', 'TEST-2'], reference: 'TEST-REF', witness_employee_id: 'T-0002',
    }))
    expect(await screen.findByText('Serials recorded.')).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Record serials' })).not.toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'TEST-2' })).toBeVisible()
    const balance = within(screen.getByRole('table', { name: 'Stock by safe' }))
    expect(within(balance.getByRole('row', { name: /Test Safe A/ })).getByRole('cell', { name: /Book total\s*3/ })).toBeVisible()
  })

  it('discards local registration draft on edit revocation, restores heading focus and never reopens it', async () => {
    caps.edit = true
    const user = userEvent.setup()
    const { rerender } = mount()
    await user.click(await screen.findByRole('button', { name: 'Record serials' }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.change(dialog.getByRole('textbox', { name: 'Serials to record' }), { target: { value: 'TEST-DRAFT' } })
    caps.edit = false
    rerender()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Test equipment' })).toHaveFocus())
    expect(screen.queryByRole('button', { name: 'Record serials' })).not.toBeInTheDocument()
    expect(api.recordArmorySerials).not.toHaveBeenCalled()
    caps.edit = true
    rerender()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Record serials' }))
    expect(within(await screen.findByRole('dialog')).getByRole('textbox', { name: 'Serials to record' })).toHaveValue('')
  })

  it('passes the current item and safe to Receive stock', async () => {
    caps.edit = true
    const user = userEvent.setup()
    const { onReceive } = mount('safe=11&item=31', 11)
    const receive = await screen.findByRole('button', { name: 'Receive stock' })
    await user.click(receive)
    expect(onReceive).toHaveBeenCalledWith(receive, { itemId: 31, safeId: 11 })
  })

  it('shows server batch statuses and isolates the calendar dates', async () => {
    vi.mocked(api.getArmoryItem).mockResolvedValue({ ...item, kind: 'expiry', batches: [
      { batch: { id: 61, batch_ref: 'TEST-B-001', expires_on: '2026-10-31' }, safe, on_hand: 1, status: 'expired' },
      { batch: { id: 62, batch_ref: 'TEST-B-002', expires_on: '2026-12-10' }, safe, on_hand: 2, status: 'expiring' },
      { batch: { id: 63, batch_ref: 'TEST-B-003', expires_on: '2027-04-15' }, safe, on_hand: 3, status: 'valid' },
    ] })
    mount()
    const batches = within(await screen.findByRole('region', { name: 'Expiry batches' }))
    expect(batches.getByText('Expired')).toBeVisible()
    expect(batches.getByText('Expiring soon')).toBeVisible()
    expect(batches.getByText('Valid')).toBeVisible()
    expect(batches.getByText('31/10/2026')).toHaveAttribute('dir', 'ltr')
  })
})
