import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type ArmoryItemRead, type ArmoryPersonCandidateRead, type ArmoryPostingRead, type ArmorySafeRead, type ArmoryStockTotals } from '@/lib/api'
import i18n from '@/lib/i18n'

import { ReceiveStockDialog } from './ReceiveStockDialog'

const access = vi.hoisted(() => ({ view: true, edit: true }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, email: 'armorer@example.test', employee_id: 'T-0001' }, status: 'authed' }) }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({
  isLoading: false, has: (cap: string) => cap === 'armory.view' ? access.view : cap === 'armory.edit' && access.edit,
}) }))

const DAY = '2025-03-04'
const SAFE_A: ArmorySafeRead = { id: 10, name_en: 'Test Safe A', name_ar: 'خزنة اختبار أ', created_at: `${DAY}T00:00:00Z`, duty_post: null, vehicle_site: null }
const SAFE_B: ArmorySafeRead = { ...SAFE_A, id: 20, name_en: 'Test Safe B', name_ar: 'خزنة اختبار ب' }
const TOTALS: ArmoryStockTotals = {
  opening_qty: null, received_qty: 0, known_in_safe: 0, in_safe: null, available_qty: 0, unrecorded_qty: null,
  out_on_shift: 0, in_custody: 0, in_repair: null, missing: null, lost: null, written_off: null, awaiting_rounds_decision: null,
  expended_rounds: null, lost_rounds: null, settled_rounds: null, expired_qty: null, book_total: null,
}
const COUNTED: ArmoryItemRead = {
  id: 100, name_en: 'Test counted item', name_ar: 'صنف معدود اختباري', kind: 'quantity', category: 'accessories', drawing: 'case',
  optional_kit_ids: [], preset_key: null, totals: TOTALS,
  stock: [{ ...TOTALS, safe: SAFE_A, received_qty: 2, known_in_safe: 2 }, { ...TOTALS, safe: SAFE_B, opening_qty: 0, in_safe: 0, book_total: 0 }],
}
const NUMBERED: ArmoryItemRead = { ...COUNTED, id: 101, name_en: 'Test numbered item', name_ar: 'صنف مرقّم اختباري', kind: 'serial', category: 'comms', drawing: 'radio' }
const BATCHED: ArmoryItemRead = { ...COUNTED, id: 102, name_en: 'Test batch item', name_ar: 'صنف دفعات اختباري', kind: 'expiry', category: 'nonlethal', drawing: 'spray' }
const CONTROLLED: ArmoryItemRead = { ...COUNTED, id: 103, name_en: 'Test controlled item', name_ar: 'صنف خاضع للرقابة للاختبار', kind: 'ammunition', category: 'ammo', drawing: 'rounds' }
const NEW_ITEM: ArmoryItemRead = { ...COUNTED, id: 104, name_en: 'Test newly added item', name_ar: 'صنف اختبار مضاف' }
const WITNESS: ArmoryPersonCandidateRead = {
  person: { employee_id: 'T-0002', name_en: 'Test Witness One', name_ar: 'شاهد الاختبار الأول', employee_status: 'Active', is_former: false },
  on_duty_here: true, course_round: null, licence_status: 'missing', licence_expires_on: null, open_firearm: null,
}
const POSTED: ArmoryPostingRead = {
  id: 123, record_ref: 'TEST-IN-01', kind: 'receipt', safe_id: 10, safe: SAFE_A, destination_safe: null, related_posting_id: null,
  occurred_on: DAY, occurred_at: null, created_at: `${DAY}T00:00:00Z`, actor: { user_id: 1, employee: null, display_name: 'Test armorer' },
  witness: null, person: null, reference: 'TEST-REF-01', source: 'supplier', reason: null, note: null, serial_action: null,
  decision_outcome: null, voided_at: null, voided_by: null, void_reason: null, void_witness: null, lines: [], discrepancy_ids: [],
}

function mount(overrides: Partial<ComponentProps<typeof ReceiveStockDialog>> = {}) {
  const onSaved = vi.fn()
  const onOpenChange = vi.fn()
  const onAddMissingItem = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  let props = { open: true, preset: {}, safes: [SAFE_A, SAFE_B], defaultSafeId: null, resume: null,
    onSaved, onOpenChange, onAddMissingItem, returnFocusRef: { current: null }, ...overrides }
  const node = () => <QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter>
    <ReceiveStockDialog {...props} />
  </MemoryRouter></I18nextProvider></QueryClientProvider>
  const view = render(node())
  return { onSaved, onOpenChange, onAddMissingItem, client, update(patch: Partial<ComponentProps<typeof ReceiveStockDialog>>) {
    props = { ...props, ...patch }
    view.rerender(node())
  } }
}

const line = (index: number) => within(screen.getByRole('group', { name: `Line ${index}` }))
const receiptSave = () => screen.getByRole('button', { name: 'Receive stock' })

beforeEach(async () => {
  access.view = true
  access.edit = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listArmoryItems').mockResolvedValue([COUNTED, NUMBERED, BATCHED, CONTROLLED])
  vi.spyOn(api, 'listArmoryPeople').mockResolvedValue([WITNESS])
  vi.spyOn(api, 'createArmoryReceipt').mockResolvedValue(POSTED)
})
afterEach(() => vi.restoreAllMocks())

describe('Receive armory stock', () => {
  it('uses one chosen safe, rejects a repeated item, and sends all valid delivery lines together', async () => {
    const { onSaved } = mount()
    const user = userEvent.setup()
    const safe = screen.getByRole('combobox', { name: 'Receiving safe' })
    expect(safe).toHaveValue('')
    await user.selectOptions(safe, '20')
    await screen.findByRole('option', { name: 'Test counted item' })
    await user.selectOptions(line(1).getByRole('combobox', { name: 'Item' }), '100')
    await user.type(line(1).getByRole('textbox', { name: 'Quantity' }), '3')
    expect(line(1).getByText('In safe:', { exact: false }).parentElement).toHaveTextContent('In safe: 0 → 3')
    await user.click(screen.getByRole('button', { name: 'Add line' }))
    await user.selectOptions(line(2).getByRole('combobox', { name: 'Item' }), '100')
    await user.type(line(2).getByRole('textbox', { name: 'Quantity' }), '1')
    expect(screen.getByText('Combine repeated items on one receipt line.')).toBeInTheDocument()
    expect(receiptSave()).toBeDisabled()
    expect(api.createArmoryReceipt).not.toHaveBeenCalled()
    await user.click(line(2).getByRole('button', { name: 'Remove line' }))
    expect(screen.queryByRole('group', { name: 'Line 2' })).not.toBeInTheDocument()
    const addLine = screen.getByRole('button', { name: 'Add line' })
    expect(addLine).toHaveFocus()
    await user.click(addLine)
    expect(line(2).getByRole('combobox', { name: 'Item' })).toHaveFocus()

    await user.selectOptions(line(2).getByRole('combobox', { name: 'Item' }), '102')
    await user.type(line(2).getByRole('textbox', { name: 'Batch reference' }), 'test-b-٠٢')
    await user.type(line(2).getByRole('textbox', { name: 'Expiry date' }), '٢٠٢٨-٠٩')
    await user.type(line(2).getByRole('textbox', { name: 'Quantity' }), '2')
    await user.click(line(2).getByRole('button', { name: 'Add batch' }))
    const refs = line(2).getAllByRole('textbox', { name: 'Batch reference' })
    expect(refs[1]).toHaveFocus()
    await user.type(refs[1], 'test-b-03')
    await user.type(line(2).getAllByRole('textbox', { name: 'Expiry date' })[1], '29/02/2028')
    await user.type(line(2).getAllByRole('textbox', { name: 'Quantity' })[1], '1')
    const receivedDate = screen.getByLabelText(/^Received date/)
    fireEvent.change(receivedDate, { target: { value: '9999-01-01' } })
    expect(screen.getByText('Enter a valid date on or before today.')).toBeInTheDocument()
    expect(receiptSave()).toBeDisabled()
    fireEvent.change(receivedDate, { target: { value: DAY } })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Received from' }), 'head_office')
    await user.type(screen.getByRole('textbox', { name: 'Reference' }), 'TEST-REF-01')
    expect(screen.getAllByRole('combobox', { name: 'Receiving safe' })).toHaveLength(1)
    await user.click(receiptSave())
    expect(api.createArmoryReceipt).toHaveBeenCalledExactlyOnceWith({
      safe_id: 20, kind: 'receipt', received_on: DAY, source: 'head_office', reference: 'TEST-REF-01', witness_employee_id: null,
      lines: [{ item_id: 100, entry: { type: 'quantity', qty: 3 } },
        { item_id: 102, entry: { type: 'expiry', counted_zero: false, batches: [
          { batch_ref: 'TEST-B-02', expires_on: '2028-09', qty: 2 },
          { batch_ref: 'TEST-B-03', expires_on: '2028-02-29', qty: 1 },
        ] } }],
    })
    await waitFor(() => expect(onSaved).toHaveBeenCalledExactlyOnceWith(POSTED))
  })

  it('prefills but never submits a serial preset, then reviews a paste before posting normalized codes', async () => {
    mount({ preset: { itemId: 101, safeId: 10, serialCode: 'TEST-X-01' }, defaultSafeId: 20 })
    const user = userEvent.setup()
    const serials = await screen.findByRole('textbox', { name: 'Serials to record' })
    expect(serials).toHaveValue('TEST-X-01')
    expect(screen.getByRole('combobox', { name: 'Receiving safe' })).toHaveValue('10')
    expect(api.createArmoryReceipt).not.toHaveBeenCalled()

    await user.clear(serials)
    await user.paste('test-x-٠١,TEST-X-01\n#wrong')
    expect(screen.getAllByText('Entered more than once').length).toBeGreaterThan(0)
    expect(screen.getByText('Use Latin letters, digits, dots, underscores, slashes or hyphens.')).toBeInTheDocument()
    expect(serials).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(screen.getByLabelText(/^Received date/), { target: { value: DAY } })
    await user.type(screen.getByRole('textbox', { name: 'Reference' }), 'TEST-REF-01')
    expect(receiptSave()).toBeDisabled()
    await user.click(receiptSave())
    expect(api.createArmoryReceipt).not.toHaveBeenCalled()

    await user.clear(serials)
    await user.paste('test-x-٠١ ، TEST-X-02')
    expect(line(1).getByText('Not counted before receipt', { exact: false })).toBeInTheDocument()
    await user.click(receiptSave())
    expect(api.createArmoryReceipt).toHaveBeenCalledExactlyOnceWith({
      safe_id: 10, kind: 'receipt', received_on: DAY, source: 'supplier', reference: 'TEST-REF-01', witness_employee_id: null,
      lines: [{ item_id: 101, entry: { type: 'serial', serial_codes: ['TEST-X-01', 'TEST-X-02'] } }],
    })
  })

  it('blocks a previously counted opening and records explicit zero without a delivery source', async () => {
    mount({ preset: { itemId: 102, mode: 'opening' }, defaultSafeId: 20 })
    const user = userEvent.setup()
    expect(await screen.findByText('An opening balance is already recorded for this item at this safe.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Received from' })).not.toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Record opening stock' })
    expect(save).toBeDisabled()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Receiving safe' }), '10')
    await user.click(screen.getByRole('checkbox', { name: 'Counted: no batches' }))
    fireEvent.change(screen.getByLabelText(/^Opening date/), { target: { value: DAY } })
    await user.click(save)
    expect(api.createArmoryReceipt).toHaveBeenCalledExactlyOnceWith({
      safe_id: 10, kind: 'opening', received_on: DAY, reference: null, witness_employee_id: null,
      lines: [{ item_id: 102, entry: { type: 'expiry', batches: [], counted_zero: true } }],
    })
  })

  it('requires a witness at the chosen safe when any delivery line is controlled', async () => {
    mount({ preset: { itemId: 103 }, defaultSafeId: 10 })
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'Quantity' }), '1')
    fireEvent.change(screen.getByLabelText(/^Received date/), { target: { value: DAY } })
    await user.type(screen.getByRole('textbox', { name: 'Reference' }), 'TEST-REF-01')
    expect(receiptSave()).toBeDisabled()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Receiving safe' }), '20')
    await user.click(await screen.findByRole('button', { name: /Test Witness One/ }))
    expect(api.listArmoryPeople).toHaveBeenCalledWith({ purpose: 'witness', safe_id: 20 })
    await user.click(receiptSave())
    expect(api.createArmoryReceipt).toHaveBeenCalledExactlyOnceWith({
      safe_id: 20, kind: 'receipt', received_on: DAY, source: 'supplier', reference: 'TEST-REF-01', witness_employee_id: 'T-0002',
      lines: [{ item_id: 103, entry: { type: 'quantity', qty: 1 } }],
    })
  })

  it('resumes Not listed with earlier lines and delivery details intact, then focuses the new line', async () => {
    const { client, onAddMissingItem, update } = mount({ preset: { itemId: 100 }, defaultSafeId: 10 })
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'Quantity' }), '3')
    await user.type(screen.getByRole('textbox', { name: 'Reference' }), 'TEST-KEEP-01')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Received from' }), 'other')
    await user.click(screen.getByRole('button', { name: 'Not listed? Add item' }))
    expect(onAddMissingItem).toHaveBeenCalledOnce()
    update({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    vi.mocked(api.listArmoryItems).mockResolvedValue([COUNTED, NUMBERED, BATCHED, CONTROLLED, NEW_ITEM])
    await act(() => client.invalidateQueries())
    update({ open: true, resume: { signal: 1, itemIds: [104] } })
    await waitFor(() => expect(line(2).getByRole('combobox', { name: 'Item' })).toHaveFocus())
    expect(line(2).getByRole('combobox', { name: 'Item' })).toHaveValue('104')
    expect(line(1).getByRole('textbox', { name: 'Quantity' })).toHaveValue('3')
    expect(screen.getByRole('textbox', { name: 'Reference' })).toHaveValue('TEST-KEEP-01')
    expect(screen.getByRole('combobox', { name: 'Received from' })).toHaveValue('other')
    expect(api.createArmoryReceipt).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Not listed? Add item' }))
    update({ open: false })
    update({ open: true, resume: { signal: 2, itemIds: [] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Not listed? Add item' })).toHaveFocus())
    expect(line(2).getByRole('combobox', { name: 'Item' })).toHaveValue('104')
  })

  it.each([
    ['armory_duplicate_serial', 'This serial is already recorded.'],
    ['armory_batch_expiry_conflict', 'This batch reference already has a different expiry.'],
    ['armory_insufficient_stock', 'Not enough stock is available in this safe.'],
  ])('refreshes stock after %s without clearing the draft', async (code, message) => {
    vi.mocked(api.createArmoryReceipt).mockRejectedValueOnce(new ApiError(409, code, 'Raw conflict detail'))
    const { onSaved } = mount({ preset: { itemId: 100 }, defaultSafeId: 10 })
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'Quantity' }), '3')
    await user.type(screen.getByRole('textbox', { name: 'Reference' }), 'TEST-KEEP-01')
    await user.click(receiptSave())
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    await waitFor(() => expect(api.listArmoryItems).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveValue('3')
    expect(screen.getByRole('textbox', { name: 'Reference' })).toHaveValue('TEST-KEEP-01')
    expect(screen.queryByText('Raw conflict detail')).not.toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('discards protected fields on a forbidden write and hides the dialog when edit is lost', async () => {
    vi.mocked(api.createArmoryReceipt).mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Raw permission detail'))
    const { update, onSaved } = mount({ preset: { itemId: 100 }, defaultSafeId: 10 })
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'Quantity' }), '2')
    await user.type(screen.getByRole('textbox', { name: 'Reference' }), 'TEST-PRIVATE-01')
    await user.click(receiptSave())
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission for this")
    expect(screen.queryByRole('textbox', { name: 'Reference' })).not.toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    access.edit = false
    update({})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('can keep editing a dirty receipt or discard it without a write', async () => {
    const { onOpenChange } = mount({ preset: { itemId: 100 }, defaultSafeId: 10 })
    const user = userEvent.setup()
    const quantity = await screen.findByRole('textbox', { name: 'Quantity' })
    await user.type(quantity, '1')
    await user.keyboard('{Escape}')
    let confirmation = await screen.findByRole('dialog', { name: 'Discard this stock receipt?' })
    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveValue('1')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    confirmation = await screen.findByRole('dialog', { name: 'Discard this stock receipt?' })
    await user.click(within(confirmation).getByRole('button', { name: 'Discard' }))
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(api.createArmoryReceipt).not.toHaveBeenCalled()
  })

  it('keeps the Arabic dialog RTL and serial and expiry examples isolated LTR', async () => {
    await i18n.changeLanguage('ar')
    mount({ preset: { itemId: 101, serialCode: 'TEST-BIDI-01' }, defaultSafeId: 10 })
    const entry = await screen.findByRole('textbox', { name: 'الأرقام التسلسلية للتسجيل' })
    expect(screen.getByRole('dialog')).toHaveAttribute('dir', 'rtl')
    expect(entry).toHaveAttribute('dir', 'ltr')
    const code = within(screen.getByRole('listitem')).getByText('TEST-BIDI-01')
    expect(code.tagName).toBe('BDI')
    expect(code).toHaveAttribute('dir', 'ltr')

    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'الصنف' }), '102')
    expect(screen.getByRole('textbox', { name: 'تاريخ الانتهاء' })).toHaveAccessibleDescription(
      '31/12/2027 أو 12/2027. عند إدخال الشهر فقط تنتهي الصلاحية في آخر يوم منه.',
    )
    expect(screen.getByText('31/12/2027', { selector: 'bdi' })).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText('12/2027', { selector: 'bdi' })).toHaveAttribute('dir', 'ltr')
    expect(api.createArmoryReceipt).not.toHaveBeenCalled()
  })
})