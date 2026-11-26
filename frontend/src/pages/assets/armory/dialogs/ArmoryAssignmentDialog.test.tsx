import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  api, ApiError,
  type ArmoryAssignmentRead, type ArmoryItemDetailRead, type ArmoryItemRead, type ArmoryItemRef, type ArmoryKitRead,
  type ArmoryPersonCandidateRead, type ArmorySafeRead, type ArmoryShiftRead, type ArmoryStockTotals,
} from '@/lib/api'
import i18n from '@/lib/i18n'
import { orgDateTimeInput, orgInputToInstant } from '../armoryFormat'
import { ArmoryAssignmentDialog } from './ArmoryAssignmentDialog'

const caps = vi.hoisted(() => ({ edit: true }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ isLoading: false, has: (cap: string) => cap === 'armory.view' || (cap === 'armory.edit' && caps.edit) }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, email: 'armorer@example.test', employee_id: 'T-0001', name_en: 'Test Armorer', name_ar: 'أمين اختبار' }, status: 'authed' }) }))

const SAFE_A: ArmorySafeRead = { id: 1, name_en: 'Test Safe A', name_ar: 'خزنة اختبار أ', vehicle_site: null, duty_post: null, created_at: '2026-11-01T06:00:00+04:00' }
const SAFE_B: ArmorySafeRead = { ...SAFE_A, id: 2, name_en: 'Test Safe B', name_ar: 'خزنة اختبار ب' }
const RIFLE: ArmoryItemRef = { id: 10, name_en: 'Test rifle', name_ar: 'بندقية اختبار', kind: 'firearm', category: 'firearms', drawing: 'rifle' }
const MAG: ArmoryItemRef = { id: 11, name_en: 'Test magazine', name_ar: 'مخزن اختبار', kind: 'quantity', category: 'accessories', drawing: 'magazine' }
const ROUNDS: ArmoryItemRef = { id: 12, name_en: 'Test rounds', name_ar: 'عتاد اختبار', kind: 'ammunition', category: 'ammo', drawing: 'rounds' }
const RADIO: ArmoryItemRef = { id: 13, name_en: 'Test radio', name_ar: 'جهاز اختبار', kind: 'serial', category: 'comms', drawing: 'radio' }
const SPRAY: ArmoryItemRef = { id: 14, name_en: 'Test spray', name_ar: 'رذاذ اختبار', kind: 'expiry', category: 'nonlethal', drawing: 'spray' }
const KITS: ArmoryKitRead[] = [
  { id: 1, code: 'rifle', name_en: 'Test rifle kit', name_ar: 'طقم بندقية اختبار', firearm_item: RIFLE, lines: [
    { item: MAG, role: 'default', default_qty: 2, substitutes_item_id: null },
    { item: ROUNDS, role: 'default', default_qty: 3, substitutes_item_id: null },
  ] },
  { id: 3, code: 'equipment', name_en: 'Test equipment only', name_ar: 'معدات اختبار فقط', firearm_item: null, lines: [
    { item: RADIO, role: 'optional', default_qty: 0, substitutes_item_id: null },
    { item: SPRAY, role: 'optional', default_qty: 0, substitutes_item_id: null },
  ] },
]
const TOTALS: ArmoryStockTotals = {
  opening_qty: 0, received_qty: 0, known_in_safe: 5, in_safe: 5, available_qty: 5, unrecorded_qty: null, out_on_shift: 0, in_custody: 0,
  in_repair: null, missing: null, lost: null, written_off: null, awaiting_rounds_decision: null, expended_rounds: null, lost_rounds: null,
  settled_rounds: null, expired_qty: null, book_total: 5,
}
const item = (ref: ArmoryItemRef, available: number): ArmoryItemRead => ({
  ...ref, preset_key: null, optional_kit_ids: [], totals: { ...TOTALS, available_qty: available },
  stock: [{ ...TOTALS, available_qty: available, safe: SAFE_A }, { ...TOTALS, available_qty: 0, safe: SAFE_B }],
})
const serialsOf = (ref: ArmoryItemRef, codes: string[], safe = SAFE_A): ArmoryItemDetailRead => ({
  ...item(ref, codes.length), batches: [], recent_movements: [],
  serials: codes.map((code, index) => ({ id: ref.id * 100 + index, item: ref, serial_code: code, safe, state: 'in_safe', state_at: null, last_posting_id: 1, assignment_id: null, holder: null, overdue_minutes: null })),
})
const sprayBatches: ArmoryItemDetailRead = {
  ...item(SPRAY, 4), serials: [], recent_movements: [],
  batches: [{ batch: { id: 140, batch_ref: 'TEST-B-001', expires_on: '2030-01-31' }, safe: SAFE_A, on_hand: 4, status: 'valid' }],
}
const candidate = (overrides: Partial<ArmoryPersonCandidateRead> & { id?: string; name?: string } = {}): ArmoryPersonCandidateRead => ({
  person: { employee_id: overrides.id ?? 'T-0002', name_en: overrides.name ?? 'Test Guard One', name_ar: null, employee_status: 'Active', is_former: false },
  on_duty_here: true, course_round: 1, licence_status: 'valid', licence_expires_on: '2027-06-30', open_firearm: null, ...overrides,
})
const now = Date.now()
const WINDOW = {
  time_zone: 'Asia/Dubai', shift_date: '2026-11-26', shift_kind: 'day' as const,
  starts_at: new Date(now - 3_600_000).toISOString(), ends_at: new Date(now + 4 * 3_600_000).toISOString(),
  next_ends_at: new Date(now + 16 * 3_600_000).toISOString(), grace_minutes: 30,
}
const SHIFT = { window: WINDOW, safes: [], attention: { now_at: new Date(now).toISOString() } } as unknown as ArmoryShiftRead
let people: ArmoryPersonCandidateRead[] = []

function mount(props: Partial<React.ComponentProps<typeof ArmoryAssignmentDialog>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onSaved = vi.fn()
  const onCorrectQualification = vi.fn()
  const element = (extra: Partial<React.ComponentProps<typeof ArmoryAssignmentDialog>> = {}) => <QueryClientProvider client={client}><MemoryRouter>
    <ArmoryAssignmentDialog open mode="shift" safeId={1} safes={[SAFE_A, SAFE_B]} onOpenChange={vi.fn()} onSaved={onSaved}
      onCorrectQualification={onCorrectQualification} resumeSignal={0} returnFocusRef={{ current: null }} {...props} {...extra} />
  </MemoryRouter></QueryClientProvider>
  const view = render(element())
  return { onSaved, onCorrectQualification, rerender: (extra: Partial<React.ComponentProps<typeof ArmoryAssignmentDialog>>) => view.rerender(element(extra)) }
}

async function choosePerson(user: UserEvent, label = 'Test Guard One') {
  await user.click(await screen.findByRole('button', { name: new RegExp(label) }))
}

beforeEach(async () => {
  vi.restoreAllMocks()
  caps.edit = true
  await i18n.changeLanguage('en')
  people = [candidate()]
  vi.spyOn(api, 'listArmoryKits').mockResolvedValue(KITS)
  vi.spyOn(api, 'listArmoryItems').mockResolvedValue([item(RIFLE, 2), item(MAG, 5), item(ROUNDS, 30), item(RADIO, 1), item(SPRAY, 4)])
  vi.spyOn(api, 'getArmoryItem').mockImplementation(async (itemId: number, safeId?: number) =>
    itemId === RIFLE.id ? serialsOf(RIFLE, safeId === 2 ? [] : ['TEST-R-001', 'TEST-R-002']) : itemId === SPRAY.id ? sprayBatches : serialsOf(RADIO, ['TEST-T-001']))
  vi.spyOn(api, 'getArmoryShift').mockResolvedValue(SHIFT)
  vi.spyOn(api, 'listArmoryPeople').mockImplementation(async filters => people.filter(row => !filters.q || row.person.employee_id === filters.q))
})

describe('ArmoryAssignmentDialog', () => {
  it('never pre-selects a firearm serial and posts the exact shift issue once one is chosen', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createArmoryIssue').mockResolvedValue({ id: 5 } as ArmoryAssignmentRead)
    const { onSaved } = mount()
    await choosePerson(user)
    const serial = await screen.findByRole('combobox', { name: 'Serial number' })
    await waitFor(() => expect(within(serial).getAllByRole('option')).toHaveLength(3))
    expect(serial).toHaveValue('')
    const submit = screen.getByRole('button', { name: 'Issue' })
    expect(submit).toBeDisabled()
    expect(screen.getByText('Choose an available firearm serial.')).toBeInTheDocument()
    await user.selectOptions(serial, '1001')
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toEqual({
      safe_id: 1, kit_id: 1, employee_id: 'T-0002',
      lines: [{ item_id: 10, qty: 1, serial_id: 1001 }, { item_id: 11, qty: 2 }, { item_id: 12, qty: 3 }],
      due_at: orgInputToInstant(orgDateTimeInput(WINDOW.ends_at)), off_duty_reason: null, off_duty_note: null,
      excess_rounds_reason: null, licence_warning_acknowledged: false,
    })
    expect(create.mock.calls[0][0].due_at).toMatch(/\+04:00$/)
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('blocks a firearm kit without a weapons course but allows equipment only', async () => {
    const user = userEvent.setup()
    people = [candidate({ course_round: null })]
    mount()
    await choosePerson(user)
    expect((await screen.findAllByText('No weapons course on record')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Issue' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Test equipment only' }))
    expect(screen.queryByText('No weapons course on record', { selector: 'p' })).not.toBeInTheDocument()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Serial number' }), '1300')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Issue' })).toBeEnabled())
  })

  it('blocks Save on a malformed or over-stock batch quantity instead of dropping the batch line', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createArmoryIssue').mockResolvedValue({ id: 6 } as ArmoryAssignmentRead)
    mount()
    await choosePerson(user)
    await user.click(await screen.findByRole('radio', { name: 'Test equipment only' }))
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Serial number' }), '1300')
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Batch reference' }), '140')
    const qty = screen.getByRole('textbox', { name: 'Quantity: Test spray' })
    const submit = screen.getByRole('button', { name: 'Issue' })

    await user.clear(qty)
    await user.type(qty, '1.5')
    expect(submit).toBeDisabled()
    expect(screen.getByText('Enter a whole quantity of zero or more.')).toBeInTheDocument()

    await user.clear(qty)
    await user.type(qty, '5')
    expect(submit).toBeDisabled()
    expect(screen.getAllByText('Only 4 left.').length).toBeGreaterThan(0)
    expect(create).not.toHaveBeenCalled()

    await user.clear(qty)
    await user.type(qty, '2')
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0].lines).toEqual([{ item_id: 13, qty: 1, serial_id: 1300 }, { item_id: 14, qty: 2, batch_id: 140 }])
  })

  it('never lets Enter choose a result of the previous search before the new query settles', async () => {
    const user = userEvent.setup()
    people = [candidate(), candidate({ id: 'T-0004', name: 'Test Guard Two' })]
    mount()
    const search = await screen.findByRole('searchbox', { name: 'Guard' })
    await user.type(search, 'T-0002')
    await screen.findByRole('button', { name: /Test Guard One/ })
    await waitFor(() => expect(screen.queryByRole('button', { name: /Test Guard Two/ })).not.toBeInTheDocument())

    await user.clear(search)
    await user.type(search, 'T-0004{Enter}')
    expect(screen.queryByRole('button', { name: 'Change: Guard' })).not.toBeInTheDocument()
    expect(search).toHaveValue('T-0004')

    await screen.findByRole('button', { name: /Test Guard Two/ })
    await user.type(search, '{Enter}')
    expect(await screen.findByRole('button', { name: 'Change: Guard' })).toBeInTheDocument()
    expect(screen.getByText('Test Guard Two')).toBeInTheDocument()
  })

  it('blocks a second firearm with a link to the held record', async () => {
    const user = userEvent.setup()
    people = [candidate({ open_firearm: { assignment_id: 44, assignment_kind: 'custody', item: RIFLE, serial_id: 1000, serial_code: 'TEST-R-009' } })]
    mount()
    await choosePerson(user)
    expect(await screen.findAllByText(/End custody for \u2068Test rifle\u2069 \u2066TEST-R-009\u2069 first/)).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'View record' })).toHaveAttribute('href', '/holdings/armory?tab=custody&custody=44')
    expect(screen.getByRole('button', { name: 'Issue' })).toBeDisabled()
  })

  it('requires an off-duty reason for a shift issue only', async () => {
    const user = userEvent.setup()
    people = [candidate({ on_duty_here: false })]
    mount()
    await choosePerson(user)
    const reason = await screen.findByRole('combobox', { name: 'Reason for issuing to this guard' })
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Serial number' }), '1000')
    expect(screen.getByText('Choose a reason for issuing to an off-duty guard.')).toBeInTheDocument()
    await user.selectOptions(reason, 'other')
    expect(screen.getByText('Enter a reason of at least 3 characters.')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Describe the reason' }), 'Relief cover')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Issue' })).toBeEnabled())
  })

  it('makes a missing licence an acknowledged data warning, never an authorization, and resumes after Guards', async () => {
    const user = userEvent.setup()
    people = [candidate({ licence_status: 'missing', licence_expires_on: null })]
    const { onCorrectQualification, rerender } = mount()
    await choosePerson(user)
    expect(await screen.findByText('Licence details are missing.')).toBeInTheDocument()
    expect(screen.getByText('Recording does not authorize release.')).toBeInTheDocument()
    expect(screen.queryByText(/anyway/i)).not.toBeInTheDocument()
    const ack = screen.getByRole('checkbox', { name: 'I acknowledge the licence warning on this record.' })
    await user.click(ack)
    expect(ack).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Add licence now' }))
    expect(onCorrectQualification).toHaveBeenCalledWith('T-0002')
    people = [candidate({ licence_status: 'expired', licence_expires_on: '2026-01-01' })]
    rerender({ resumeSignal: 1 })
    expect(await screen.findByText('Eligibility refreshed. Review the licence warning again.')).toBeInTheDocument()
    expect(await screen.findByText('The licence has expired.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'I acknowledge the licence warning on this record.' })).not.toBeChecked()
  })

  it('shows an expiring licence as advice without an acknowledgement', async () => {
    const user = userEvent.setup()
    const soon = new Date(now + 10 * 86_400_000).toISOString().slice(0, 10)
    people = [candidate({ licence_status: 'expiring', licence_expires_on: soon })]
    mount()
    await choosePerson(user)
    expect(await screen.findByText(/The licence expires in/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'I acknowledge the licence warning on this record.' })).not.toBeInTheDocument()
  })

  it('accepts only a real 24-hour due time and keeps the date when the time is retyped', async () => {
    const user = userEvent.setup()
    mount()
    await choosePerson(user)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Serial number' }), '1000')
    const time = screen.getByRole('textbox', { name: 'Time' })
    const date = screen.getByLabelText('Date')
    const dateBefore = (date as HTMLInputElement).value
    await user.clear(time)
    await user.type(time, '24:00')
    expect(screen.getByText('Enter a due time after issue.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Issue' })).toBeDisabled()
    expect(date).toHaveValue(dateBefore)
    await user.clear(time)
    await user.type(time, '١٧:٠٠')
    expect(time).toHaveValue('17:00')
  })

  it('clears the chosen serial with a visible notice when the safe changes', async () => {
    const user = userEvent.setup()
    mount()
    await choosePerson(user)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Serial number' }), '1000')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Safe' }), '2')
    expect(await screen.findByText('The safe changed. Choose the serials and batches again from this safe.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Serial number' })).toHaveValue(''))
  })

  it('locks the draft while an issue is in flight so an edit cannot re-enable a second submission', async () => {
    const user = userEvent.setup()
    // The project's TS lib predates `Promise.withResolvers`.
    let finish: (record: ArmoryAssignmentRead) => void = () => {}
    const create = vi.spyOn(api, 'createArmoryIssue').mockReturnValue(new Promise(resolve => { finish = resolve }))
    const { onSaved } = mount()
    await choosePerson(user)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Serial number' }), '1000')
    const submit = screen.getByRole('button', { name: 'Issue' })
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))

    const magazines = screen.getByRole('textbox', { name: 'Quantity: Test magazine' })
    expect(magazines).toBeDisabled()
    fireEvent.change(magazines, { target: { value: '1' } })
    fireEvent.submit(submit.closest('form')!)
    expect(submit).toBeDisabled()
    expect(create).toHaveBeenCalledTimes(1)

    finish({ id: 7 } as ArmoryAssignmentRead)
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('records site custody with the responsible supervisor', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createArmoryCustody').mockResolvedValue({ id: 9 } as ArmoryAssignmentRead)
    mount({ mode: 'custody' })
    await user.click(await screen.findByRole('radio', { name: 'Site' }))
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Site' })[0], '2')
    await choosePerson(user)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Serial number' }), '1000')
    await user.click(screen.getByRole('button', { name: 'Hand over custody' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toMatchObject({
      safe_id: 1, holder_kind: 'site', holder_employee_id: null, holder_safe_id: 2, supervisor_employee_id: 'T-0002', kit_id: 1, licence_warning_acknowledged: false,
    })
    expect(create.mock.calls[0][0]).not.toHaveProperty('due_at')
  })

  it('keeps the draft and shows translated copy when the serial was taken meanwhile', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'createArmoryIssue').mockRejectedValue(new ApiError(409, 'armory_serial_unavailable', 'Serial gone', { serial_id: 1000 }))
    mount()
    await choosePerson(user)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Serial number' }), '1000')
    await user.click(screen.getByRole('button', { name: 'Issue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This serial is no longer available. Review the refreshed list.')
    expect(screen.queryByText('Serial gone')).not.toBeInTheDocument()
    expect(screen.getByText('Test Guard One')).toBeInTheDocument()
  })

  it('renders nothing for a viewer', () => {
    caps.edit = false
    mount()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.listArmoryPeople).not.toHaveBeenCalled()
  })
})
