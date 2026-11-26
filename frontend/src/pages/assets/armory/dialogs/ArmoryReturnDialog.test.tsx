import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from '@/lib/api'
import type { ArmoryAssignmentLineRead, ArmoryAssignmentRead, ArmoryPersonCandidateRead, ArmoryReturnRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { toast } from '@/lib/toast'
import { ArmoryReturnDialog } from './ArmoryReturnDialog'

const access = vi.hoisted(() => ({ view: true, edit: true }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap === 'armory.view' ? access.view : cap === 'armory.edit' && access.edit, isLoading: false }),
}))
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ status: 'authed', user: { id: 1, email: 'armorer@example.test', employee_id: 'T-0001' } }),
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }))

const DATE = '2026-08-18T10:00:00+04:00'
const SAFE = { id: 71, name_en: 'Test Safe A', name_ar: 'خزنة اختبار أ', vehicle_site: null, duty_post: null, created_at: DATE }
const SITE = { ...SAFE, id: 72, name_en: 'Test Receiving Site', name_ar: 'موقع استلام اختباري' }

function candidate(employeeId: string, english: string, arabic: string): ArmoryPersonCandidateRead {
  return {
    person: { employee_id: employeeId, name_en: english, name_ar: arabic, employee_status: 'Active', is_former: false },
    on_duty_here: true, course_round: null, licence_status: 'missing', licence_expires_on: null, open_firearm: null,
  }
}

const ACTOR = candidate('T-0001', 'Test Armorer', 'أمين خزنة اختباري')
const HOLDER = candidate('T-0002', 'Test Guard One', 'حارس اختبار أول')
const SUPERVISOR = candidate('T-0003', 'Test Supervisor', 'مشرف اختبار')
const WITNESS = candidate('T-0004', 'Test Witness', 'شاهد اختبار')
const HELMETS: ArmoryAssignmentLineRead = {
  id: 21, item: { id: 11, name_en: 'Test Helmet', name_ar: 'خوذة اختبار', kind: 'quantity', category: 'riot', drawing: 'helmet' },
  qty: 3, remaining_qty: 2, serial_id: null, serial_code: null, batch: null,
}
const RADIO: ArmoryAssignmentLineRead = {
  id: 22, item: { id: 12, name_en: 'Test Radio', name_ar: 'جهاز اختبار', kind: 'serial', category: 'comms', drawing: 'radio' },
  qty: 1, remaining_qty: 1, serial_id: 101, serial_code: 'TEST-R-001', batch: null,
}
const AMMO: ArmoryAssignmentLineRead = {
  id: 23, item: { id: 13, name_en: 'Test Rounds', name_ar: 'طلقات اختبار', kind: 'ammunition', category: 'ammo', drawing: 'rounds' },
  qty: 5, remaining_qty: 3, serial_id: null, serial_code: null, batch: null,
}

function assignment(lines: ArmoryAssignmentLineRead[], fields: Partial<ArmoryAssignmentRead> = {}): ArmoryAssignmentRead {
  return {
    id: 41, record_ref: 'TEST-A-041', kind: 'shift', state: 'active', safe: SAFE,
    holder: { kind: 'person', employee: HOLDER.person, site_safe: null, supervisor: null },
    issuer: { user_id: 1, employee: ACTOR.person, display_name: null }, issued_at: DATE, due_at: null,
    overdue_minutes: null, licence_warning_acknowledged: false, changed_kit: false, kit_id: 51, lines,
    course_round_snapshot: null, licence_status_at_issue: null, shift_window: null, grace_minutes: null,
    off_duty_reason: null, off_duty_note: null, excess_rounds_reason: null, condition_note: null,
    ended_at: null, ended_by: null, return_ids: [], voided_at: null, voided_by: null, void_reason: null, receipt: null,
    ...fields,
  }
}

function returnResult(record: ArmoryAssignmentRead, witness: ArmoryReturnRead['posting']['witness'] = null): ArmoryReturnRead {
  return {
    assignment: record,
    posting: {
      id: 61, record_ref: 'TEST-RETURN-061', kind: 'return', safe_id: SAFE.id, occurred_on: '2026-08-18', occurred_at: DATE,
      voided_at: null, safe: SAFE, destination_safe: null, related_posting_id: record.id, created_at: DATE,
      actor: record.issuer, witness, person: record.holder.employee, reference: null, source: null, reason: null,
      note: null, serial_action: null, decision_outcome: null, voided_by: null, void_reason: null, void_witness: null,
      lines: [], discrepancy_ids: [],
    },
  }
}

function mount(kind: ArmoryAssignmentRead['kind'] = 'shift', initiallyOpen = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onSaved = vi.fn()

  function Harness() {
    const [open, setOpen] = useState(initiallyOpen)
    const opener = useRef<HTMLButtonElement>(null)
    return <>
      <button ref={opener} onClick={() => setOpen(true)}>Open test return</button>
      <ArmoryReturnDialog open={open} kind={kind} assignmentId={41} onOpenChange={setOpen} onSaved={onSaved} returnFocusRef={opener} />
    </>
  }

  function view() {
    return <QueryClientProvider client={client}><MemoryRouter><I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider></MemoryRouter></QueryClientProvider>
  }

  const rendered = render(view())
  return { onSaved, refreshCapabilities: () => rendered.rerender(view()) }
}

beforeEach(async () => {
  access.view = true
  access.edit = true
  vi.mocked(toast.success).mockClear()
  await i18n.changeLanguage('en')
})
afterEach(() => vi.restoreAllMocks())

const submit = () => screen.getByRole('button', { name: 'Return' })
const helmetsBox = () => screen.getByRole('checkbox', { name: 'Returned: Test Helmet' })
const radioBox = () => screen.getByRole('checkbox', { name: 'Serial checked: TEST-R-001' })

describe('single Armory return', () => {
  it('leaves all outstanding lines unchecked and returns only the confirmed remaining quantity', async () => {
    const user = userEvent.setup()
    const detail = vi.spyOn(api, 'getArmoryIssue').mockResolvedValue(assignment([HELMETS, RADIO, { ...AMMO, remaining_qty: 0 }]))
    const custodyDetail = vi.spyOn(api, 'getArmoryCustody')
    const result = returnResult(assignment([{ ...HELMETS, remaining_qty: 0 }, RADIO]))
    const post = vi.spyOn(api, 'createArmoryReturn').mockResolvedValue(result)
    const { onSaved } = mount()

    await screen.findByText('Test Helmet')
    expect(detail).toHaveBeenCalledWith(41)
    expect(custodyDetail).not.toHaveBeenCalled()
    const helmet = within(screen.getByRole('group', { name: 'Test Helmet' }))
    expect(helmet.getByText('Originally issued:').nextElementSibling).toHaveTextContent('3')
    expect(helmet.getByText('Still outstanding:').nextElementSibling).toHaveTextContent('2')
    expect(helmetsBox()).not.toBeChecked()
    expect(radioBox()).not.toBeChecked()
    expect(screen.queryByText('Test Rounds')).not.toBeInTheDocument()
    expect(screen.getByText('items still out', { exact: false })).toHaveTextContent('2 items still out')
    expect(submit()).toBeDisabled()
    expect(post).not.toHaveBeenCalled()

    await user.click(helmetsBox())
    expect(screen.getByText('item still out', { exact: false })).toHaveTextContent('1 item still out')
    await user.click(submit())
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(result))
    expect(post).toHaveBeenCalledExactlyOnceWith({ assignment_id: 41, witness_employee_id: null, lines: [
      { assignment_line_id: 21, expected_remaining_qty: 2, returned_qty: 2 },
    ] })
    expect(toast.success).toHaveBeenCalledWith('Return recorded.')
  })

  it('requires a real count, and posts zero with validated shortfall evidence and an independent witness', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'getArmoryIssue').mockResolvedValue(assignment([AMMO]))
    const people = vi.spyOn(api, 'listArmoryPeople').mockResolvedValue([ACTOR, HOLDER, WITNESS])
    const result = returnResult(assignment([{ ...AMMO, remaining_qty: 0 }], { state: 'ended' }), WITNESS.person)
    const post = vi.spyOn(api, 'createArmoryReturn').mockResolvedValue(result)
    mount()

    const counted = await screen.findByRole('checkbox', { name: 'I counted the returned rounds' })
    expect(counted).not.toBeChecked()
    expect(screen.queryByLabelText('Rounds returned')).not.toBeInTheDocument()
    await user.click(counted)
    const count = screen.getByLabelText('Rounds returned')
    expect(count).toHaveValue('')
    await user.type(count, '4')
    expect(submit()).toBeDisabled()
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument()
    await user.clear(count)
    await user.type(count, '1.5')
    expect(submit()).toBeDisabled()
    await user.clear(count)
    await user.type(count, '0')

    const witness = await screen.findByRole('button', { name: /Test Witness/ })
    expect(people).toHaveBeenCalledWith({ purpose: 'witness', safe_id: SAFE.id })
    expect(screen.queryByRole('button', { name: /Test Armorer|Test Guard One/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Ammunition shortfall:/)).toHaveTextContent('Ammunition shortfall: 3 rounds')
    await user.selectOptions(screen.getByLabelText('Reason'), 'other')
    await user.click(witness)
    const reference = screen.getByLabelText('Reference')
    await user.type(reference, 'A--')
    expect(submit()).toBeDisabled()
    // Pasting via an input event also exercises validation beyond maxlength.
    fireEvent.change(reference, { target: { value: `AB${'-'.repeat(79)}` } })
    expect(submit()).toBeDisabled()
    fireEvent.change(reference, { target: { value: 'TEST-3A' } })
    expect(submit()).toBeDisabled()
    await user.type(screen.getByLabelText('Describe the reason'), 'Count checked twice')
    await user.click(submit())

    await waitFor(() => expect(post).toHaveBeenCalledExactlyOnceWith({ assignment_id: 41, witness_employee_id: 'T-0004', lines: [
      { assignment_line_id: 23, expected_remaining_qty: 3, returned_qty: 0, shortfall: {
        reason: 'other', reference: 'TEST-3A', note: 'Count checked twice',
      } },
    ] }))
  })

  it('requires a fault note of at least three characters on a serial going to repair', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'getArmoryIssue').mockResolvedValue(assignment([RADIO]))
    const post = vi.spyOn(api, 'createArmoryReturn').mockResolvedValue(returnResult(assignment([{ ...RADIO, remaining_qty: 0 }], { state: 'ended' })))
    mount()
    await user.click(await screen.findByRole('checkbox', { name: 'Serial checked: TEST-R-001' }))
    await user.selectOptions(screen.getByLabelText('Condition'), 'repair')
    expect(submit()).toBeDisabled()
    expect(screen.getByText('Describe the fault before sending the item to repair.')).toBeVisible()
    const fault = screen.getByLabelText('Fault')
    await user.type(fault, ' x ')
    expect(submit()).toBeDisabled()
    await user.clear(fault)
    await user.type(fault, ' Broken latch ')
    await user.click(submit())

    await waitFor(() => expect(post).toHaveBeenCalledExactlyOnceWith({ assignment_id: 41, witness_employee_id: null, lines: [
      { assignment_line_id: 22, expected_remaining_qty: 1, returned_qty: 1, condition: 'repair', fault_note: 'Broken latch' },
    ] }))
  })

  it('requires a witness at the issuing safe for even a plain custody return', async () => {
    const user = userEvent.setup()
    const record = assignment([HELMETS], { kind: 'custody', holder: { kind: 'site', employee: null, site_safe: SITE, supervisor: SUPERVISOR.person } })
    const issue = vi.spyOn(api, 'getArmoryIssue')
    const custody = vi.spyOn(api, 'getArmoryCustody').mockResolvedValue(record)
    const people = vi.spyOn(api, 'listArmoryPeople').mockResolvedValue([ACTOR, SUPERVISOR, WITNESS])
    const result = returnResult({ ...record, state: 'ended', lines: [{ ...HELMETS, remaining_qty: 0 }] }, WITNESS.person)
    const post = vi.spyOn(api, 'createArmoryReturn').mockResolvedValue(result)
    const { onSaved } = mount('custody')
    const dialog = await screen.findByRole('dialog', { name: 'Return custody items' })
    const save = within(dialog).getByRole('button', { name: 'Return custody items' })

    await screen.findByText('Test Helmet')
    await user.click(helmetsBox())
    expect(issue).not.toHaveBeenCalled()
    expect(custody).toHaveBeenCalledWith(41)
    expect(save).toBeDisabled()
    expect(screen.getByText('Test Safe A')).toBeVisible()
    expect(screen.getByText('Test Receiving Site')).toBeVisible()
    const witness = await screen.findByRole('button', { name: /Test Witness/ })
    expect(people).toHaveBeenCalledWith({ purpose: 'witness', safe_id: SAFE.id })
    expect(screen.queryByRole('button', { name: /Test Armorer|Test Supervisor/ })).not.toBeInTheDocument()
    await user.click(witness)
    await user.click(save)

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(result))
    expect(post).toHaveBeenCalledExactlyOnceWith({ assignment_id: 41, witness_employee_id: 'T-0004', lines: [
      { assignment_line_id: 21, expected_remaining_qty: 2, returned_qty: 2 },
    ] })
    expect(toast.success).toHaveBeenCalledWith('Custody ended.')
  })

  it('refetches a stale record, clears changed confirmations, and never resubmits on its own', async () => {
    const user = userEvent.setup()
    // The project's ES2023 lib predates Promise.withResolvers.
    let finishRefresh!: (record: ArmoryAssignmentRead) => void
    const refresh = new Promise<ArmoryAssignmentRead>(resolve => { finishRefresh = resolve })
    const detail = vi.spyOn(api, 'getArmoryIssue').mockResolvedValueOnce(assignment([HELMETS, RADIO])).mockReturnValue(refresh)
    const post = vi.spyOn(api, 'createArmoryReturn').mockRejectedValue(new ApiError(409, 'armory_stale_return', 'Untranslated backend message'))
    const { onSaved } = mount()

    await screen.findByText('Test Helmet')
    await user.click(helmetsBox())
    await user.click(radioBox())
    await user.selectOptions(screen.getByLabelText('Condition'), 'repair')
    await user.type(screen.getByLabelText('Fault'), 'Retain this note')
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent('This record changed since you opened it. Review the current lines and confirm again.')
    expect(detail).toHaveBeenCalledTimes(2)
    expect(submit()).toBeDisabled()
    await act(async () => finishRefresh(assignment([{ ...HELMETS, remaining_qty: 1 }, RADIO])))

    await waitFor(() => expect(helmetsBox()).not.toBeChecked())
    expect(radioBox()).toBeChecked()
    expect(screen.getByLabelText('Condition')).toHaveValue('repair')
    expect(screen.getByLabelText('Fault')).toHaveValue('Retain this note')
    expect(submit()).toBeEnabled()
    expect(post).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it.each([{ view: false, edit: true }, { view: true, edit: false }])('does not open or read without both capabilities (%j)', ({ view, edit }) => {
    access.view = view
    access.edit = edit
    const detail = vi.spyOn(api, 'getArmoryIssue')
    const post = vi.spyOn(api, 'createArmoryReturn')
    mount()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(detail).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('drops the draft and hides protected data when a write returns 403', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'getArmoryIssue').mockResolvedValue(assignment([HELMETS]))
    vi.spyOn(api, 'createArmoryReturn').mockRejectedValue(new ApiError(403, 'forbidden', 'Untranslated backend message'))
    const { onSaved } = mount()
    await screen.findByText('Test Helmet')
    await user.click(helmetsBox())
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission for this")
    expect(screen.queryByText('Test Helmet')).not.toBeInTheDocument()
    expect(screen.queryByText('Test Guard One')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('does not restore a draft after capability revocation and a fresh grant', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'getArmoryIssue').mockResolvedValue(assignment([HELMETS]))
    const { refreshCapabilities } = mount()
    await screen.findByText('Test Helmet')
    await user.click(helmetsBox())

    access.edit = false
    refreshCapabilities()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    access.edit = true
    refreshCapabilities()
    expect(await screen.findByRole('checkbox', { name: 'Returned: Test Helmet' })).not.toBeChecked()
  })

  it('confirms discarding a checked draft and restores focus to the opener', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'getArmoryIssue').mockResolvedValue(assignment([HELMETS]))
    mount('shift', false)
    const opener = screen.getByRole('button', { name: 'Open test return' })
    await user.click(opener)
    await screen.findByText('Test Helmet')
    await user.click(helmetsBox())
    await user.keyboard('{Escape}')
    const confirmation = () => screen.getByRole('dialog', { name: 'Discard this return draft?' })
    await user.click(within(confirmation()).getByRole('button', { name: 'Cancel' }))
    expect(helmetsBox()).toBeChecked()
    await user.keyboard('{Escape}')
    await user.click(within(confirmation()).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(opener).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('uses Arabic names and isolates serials, record references and quantities', async () => {
    await i18n.changeLanguage('ar')
    try {
      vi.spyOn(api, 'getArmoryIssue').mockResolvedValue(assignment([RADIO]))
      mount()
      const sheet = await screen.findByRole('dialog', { name: 'إرجاع' })
      expect(sheet).toHaveAttribute('dir', 'rtl')
      expect(await within(sheet).findByText('جهاز اختبار')).toBeVisible()
      expect(within(sheet).getByText('خزنة اختبار أ')).toBeVisible()
      for (const value of ['TEST-R-001', 'TEST-A-041', 'T-0002']) {
        const identifier = within(sheet).getByText(value, { exact: true })
        expect(identifier.tagName).toBe('BDI')
        expect(identifier).toHaveAttribute('dir', 'ltr')
      }
      const counts = within(sheet).getAllByText('1', { exact: true })
      expect(counts.length).toBeGreaterThan(0)
      for (const count of counts) expect(count).toHaveAttribute('dir', 'ltr')
    } finally {
      await act(async () => { await i18n.changeLanguage('en') })
    }
  })
})
