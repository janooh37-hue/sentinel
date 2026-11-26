import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, type ArmoryPersonCandidateRead, type ArmoryPostingRead, type ArmorySafeRead, type ArmorySerialDetailRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { useArmorySerial } from '../armoryQueries'
import { SerialMovementDialog } from './SerialMovementDialog'

vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => cap === 'armory.view' || cap === 'armory.edit' }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, email: 'armorer@example.test', employee_id: 'T-0001' }, status: 'authed' }) }))

const timestamp = '2026-11-01T09:00:00Z'
const first: ArmorySafeRead = { id: 11, name_en: 'Test Safe A', name_ar: 'خزنة اختبار أ', created_at: timestamp, vehicle_site: null, duty_post: null }
const second: ArmorySafeRead = { ...first, id: 12, name_en: 'Test Safe B', name_ar: 'خزنة اختبار ب' }
const witness: ArmoryPersonCandidateRead = {
  person: { employee_id: 'T-0002', name_en: 'Test Witness', name_ar: 'شاهد اختبار', employee_status: 'Active', is_former: false },
  on_duty_here: true, course_round: null, licence_status: 'missing', licence_expires_on: null, open_firearm: null,
}
const serial: ArmorySerialDetailRead = {
  id: 51, item: { id: 31, name_en: 'Test radio', name_ar: 'جهاز اختبار', kind: 'serial', drawing: 'radio', category: 'comms' },
  serial_code: 'TEST-S-001', safe: first, state: 'in_safe', state_at: timestamp, last_posting_id: 41,
  assignment_id: null, holder: null, overdue_minutes: null, recent_movements: [],
}
const movement: ArmoryPostingRead = {
  id: 42, record_ref: 'TEST-M-002', kind: 'serial_state', safe_id: 11, occurred_on: '2026-11-01', occurred_at: timestamp,
  voided_at: null, safe: first, destination_safe: second, related_posting_id: null, created_at: timestamp,
  actor: { user_id: 1, employee: null, display_name: null }, witness: witness.person, person: null, reference: null,
  source: null, reason: 'Test transfer', note: null, serial_action: 'transfer', decision_outcome: null, voided_by: null, void_reason: null,
  void_witness: null, lines: [], discrepancy_ids: [],
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const saved = vi.fn()
  function Harness() {
    const current = useArmorySerial(51)
    const opener = useRef<HTMLElement>(null)
    return current.data ? <SerialMovementDialog open serial={current.data} safes={[first, second]} returnFocusRef={opener}
      onOpenChange={vi.fn()} onSaved={saved} /> : null
  }
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><Harness /></I18nextProvider></QueryClientProvider>)
  return { saved }
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'getArmorySerial').mockResolvedValue(serial)
  vi.spyOn(api, 'listArmoryPeople').mockResolvedValue([witness])
  vi.spyOn(api, 'moveArmorySerial').mockResolvedValue(movement)
})

describe('serial state records', () => {
  it.each([
    ['in_safe', ['Send to repair', 'Mark lost', 'Write off', 'Move to another safe']],
    ['in_repair', ['Back from repair', 'Mark lost', 'Write off']],
    ['lost', ['Write off']],
  ] as const)('offers exactly the allowed actions from %s', async (state, options) => {
    vi.mocked(api.getArmorySerial).mockResolvedValue({ ...serial, state })
    mount()
    const dialog = within(await screen.findByRole('dialog', { name: 'Change state' }))
    expect(dialog.getAllByRole('option').map(option => option.textContent)).toEqual(['Choose a state change', ...options])
  })

  it.each(['signed_out', 'in_custody', 'missing', 'written_off'] as const)('does not offer a mutation when the serial is %s', async state => {
    vi.mocked(api.getArmorySerial).mockResolvedValue({ ...serial, state })
    mount()
    const dialog = within(await screen.findByRole('dialog', { name: 'Change state' }))
    expect(dialog.getByText('No state changes are available for this serial.')).toBeVisible()
    expect(dialog.queryByRole('combobox')).not.toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(api.listArmoryPeople).not.toHaveBeenCalled()
  })

  it('requires a different safe, a reason and a witness, and posts exact serial preconditions', async () => {
    const user = userEvent.setup()
    const { saved } = mount()
    const dialog = within(await screen.findByRole('dialog', { name: 'Change state' }))
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Status' }), 'transfer')
    const destination = dialog.getByRole('combobox', { name: 'Destination safe' })
    expect(within(destination).queryByRole('option', { name: 'Test Safe A' })).not.toBeInTheDocument()
    const save = dialog.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.selectOptions(destination, '12')
    await user.click(await dialog.findByRole('button', { name: /Test Witness/ }))
    const reason = dialog.getByRole('textbox', { name: 'Reason' })
    fireEvent.change(reason, { target: { value: ' a ' } })
    expect(save).toBeDisabled()
    fireEvent.change(reason, { target: { value: '  Test transfer  ' } })
    await user.click(save)
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect(api.moveArmorySerial).toHaveBeenCalledWith(51, {
      action: 'transfer', expected_state: 'in_safe', expected_safe_id: 11, expected_posting_id: 41,
      destination_safe_id: 12, reason: 'Test transfer', witness_employee_id: 'T-0002',
    })
  })

  it('refreshes a stale serial after 409, shows the translated error and requires fresh choices', async () => {
    const user = userEvent.setup()
    vi.mocked(api.moveArmorySerial).mockImplementationOnce(async () => {
      vi.mocked(api.getArmorySerial).mockResolvedValue({ ...serial, state: 'in_repair', last_posting_id: 42 })
      throw new ApiError(409, 'armory_serial_unavailable', 'Untranslated internal text')
    })
    mount()
    const dialog = within(await screen.findByRole('dialog', { name: 'Change state' }))
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Status' }), 'send_repair')
    fireEvent.change(dialog.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Test repair' } })
    await user.click(await dialog.findByRole('button', { name: /Test Witness/ }))
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('This serial is no longer available. Review the refreshed list.')
    await dialog.findByRole('option', { name: 'Back from repair' })
    expect(dialog.getByRole('combobox', { name: 'Status' })).toHaveValue('')
    expect(dialog.getByRole('textbox', { name: 'Reason' })).toHaveValue('')
    expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(api.getArmorySerial).toHaveBeenCalledTimes(2)
    expect(api.moveArmorySerial).toHaveBeenCalledOnce()
  })

  it('hides the protected draft and shows the generic error when the write is refused', async () => {
    const user = userEvent.setup()
    vi.mocked(api.moveArmorySerial).mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Untranslated private text'))
    const { saved } = mount()
    const dialog = within(await screen.findByRole('dialog', { name: 'Change state' }))
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Status' }), 'send_repair')
    fireEvent.change(dialog.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Test repair' } })
    await user.click(await dialog.findByRole('button', { name: /Test Witness/ }))
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent(i18n.t('errors.generic'))
    expect(dialog.queryByText('TEST-S-001')).not.toBeInTheDocument()
    expect(dialog.queryByRole('textbox')).not.toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(saved).not.toHaveBeenCalled()
  })
})
