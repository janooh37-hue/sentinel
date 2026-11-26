import { screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import { api, ApiError } from '@/lib/api'
import i18n from '@/lib/i18n'
import { ShiftCheckDialog } from './ShiftCheckDialog'
import { candidates, renderArmory, savedCount, serial, testDraft, testSafe } from './shiftFixtures'

const caps = vi.hoisted(() => ({ view: true, edit: true }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({
  has: (cap: string) => cap === 'armory.view' ? caps.view : caps.edit,
  isLoading: false,
}) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, email: 'armorer@example.test', employee_id: 'T-0001' }, status: 'authed' }) }))

beforeEach(async () => {
  vi.restoreAllMocks()
  caps.view = true
  caps.edit = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'getArmoryShiftCheckDraft').mockResolvedValue(testDraft)
  vi.spyOn(api, 'listArmoryPeople').mockResolvedValue(candidates)
})

function mount() {
  const onPausedChange = vi.fn()
  const onSaved = vi.fn()
  function CheckHost() {
    const [open, setOpen] = useState(true)
    const opener = useRef<HTMLButtonElement>(null)
    return <>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>Open test check</button>
      <ShiftCheckDialog open={open} safeId={testSafe.id} onOpenChange={setOpen} onPausedChange={onPausedChange} onSaved={onSaved} returnFocusRef={opener} />
    </>
  }
  renderArmory(<CheckHost />)
  return { onPausedChange, onSaved }
}

async function chooseWitness(user: UserEvent) {
  const witness = await screen.findByRole('button', { name: /Test Witness/ })
  expect(screen.queryByRole('button', { name: /Test Armorer/ })).not.toBeInTheDocument()
  await user.click(witness)
}

it('observes only ticked serials and needs an explicit missing report to post', async () => {
  const post = vi.spyOn(api, 'createArmoryShiftCheck').mockResolvedValue(savedCount)
  const { onSaved } = mount()
  const user = userEvent.setup()
  const first = await screen.findByRole('checkbox', { name: 'TEST-R-0001' })
  expect(first).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'TEST-S-0001' })).not.toBeChecked()
  await user.click(first)
  await user.click(screen.getByRole('button', { name: 'Review check' }))
  expect(screen.getByText('TEST-S-0001', { selector: 'bdi[dir=ltr]' })).toBeVisible()
  await chooseWitness(user)
  const save = screen.getByRole('button', { name: 'Report missing and save' })
  expect(save).toBeDisabled()
  expect(screen.getByText('Confirm the firearms missing to save.')).toBeVisible()
  expect(post).not.toHaveBeenCalled()
  await user.click(screen.getByRole('checkbox', { name: 'I report 1 firearm missing' }))
  expect(save).toBeEnabled()
  await user.click(save)
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedCount))
  expect(post).toHaveBeenCalledExactlyOnceWith(1, {
    snapshot_token: 'test-check-one', observed_serial_ids: [1], confirm_missing: true, witness_employee_id: 'T-0003',
  })
})

it('accepts a unique complete scan but not an ambiguous suffix or an unexpected serial', async () => {
  mount()
  const user = userEvent.setup()
  const scanner = await screen.findByRole('textbox', { name: 'Scan or type a firearm serial' })
  await user.type(scanner, '0001{Enter}')
  expect(screen.getByRole('alert')).toHaveTextContent('More than one match. Enter the full serial.')
  await user.clear(scanner)
  await user.type(scanner, 'TEST-UNEXPECTED{Enter}')
  expect(screen.getByRole('alert')).toHaveTextContent('That serial is not on this safe’s check list.')
  await user.clear(scanner)
  await user.type(scanner, 'test-r-000١{Enter}')
  expect(await screen.findByRole('checkbox', { name: 'TEST-R-0001' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'TEST-S-0001' })).not.toBeChecked()
  expect(screen.getByText('Checked:', { exact: false })).toBeVisible()
})

it('redrafts after stale 409, keeps matching observations and never reposts automatically', async () => {
  const load = vi.mocked(api.getArmoryShiftCheckDraft)
  load.mockResolvedValueOnce(testDraft).mockResolvedValue({ ...testDraft, snapshot_token: 'test-check-fresh', expected: [serial] })
  const post = vi.spyOn(api, 'createArmoryShiftCheck').mockRejectedValueOnce(new ApiError(409, 'armory_stale_check', 'Backend-only message'))
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('checkbox', { name: 'TEST-R-0001' }))
  await user.click(screen.getByRole('checkbox', { name: 'TEST-S-0001' }))
  await user.click(screen.getByRole('button', { name: 'Review check' }))
  await chooseWitness(user)
  await user.click(screen.getByRole('button', { name: 'Save shift check' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('The safe changed since the check started.')
  const keep = await screen.findByRole('button', { name: 'Keep my entries' })
  expect(screen.getByRole('checkbox', { name: 'TEST-R-0001' })).toBeChecked()
  expect(screen.queryByRole('checkbox', { name: 'TEST-S-0001' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Review check' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Discard entries' }))
  expect(keep).not.toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'TEST-R-0001' })).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Review check' })).toBeEnabled()
  expect(load).toHaveBeenCalledTimes(2)
  expect(post).toHaveBeenCalledTimes(1)
})

it('refreshes a concurrently completed check and will not offer another save for that window', async () => {
  const post = vi.spyOn(api, 'createArmoryShiftCheck').mockRejectedValueOnce(new ApiError(409, 'armory_period_already_recorded', 'Backend-only message'))
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('checkbox', { name: 'TEST-R-0001' }))
  await user.click(screen.getByRole('checkbox', { name: 'TEST-S-0001' }))
  await user.click(screen.getByRole('button', { name: 'Review check' }))
  await chooseWitness(user)
  await user.click(screen.getByRole('button', { name: 'Save shift check' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('This period already has a recorded check or count.')
  expect(api.getArmoryShiftCheckDraft).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('checkbox', { name: 'TEST-R-0001' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save shift check' })).not.toBeInTheDocument()
  expect(post).toHaveBeenCalledTimes(1)
})

it('keeps observations while paused, then prompts and clears them on explicit discard', async () => {
  const { onPausedChange } = mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('checkbox', { name: 'TEST-R-0001' }))
  await user.click(screen.getByRole('button', { name: 'Pause' }))
  expect(onPausedChange).toHaveBeenCalledExactlyOnceWith(true)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Open test check' }))
  const resumed = await screen.findByRole('checkbox', { name: 'TEST-R-0001' })
  await waitFor(() => expect(resumed).toBeEnabled())
  expect(resumed).toBeChecked()
  await user.keyboard('{Escape}')
  const confirm = screen.getByRole('dialog', { name: 'Discard this shift check?' })
  await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }))
  expect(screen.getByRole('checkbox', { name: 'TEST-R-0001' })).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  await user.click(screen.getByRole('button', { name: 'Discard' }))
  expect(onPausedChange).toHaveBeenLastCalledWith(false)
  await user.click(screen.getByRole('button', { name: 'Open test check' }))
  expect(await screen.findByRole('checkbox', { name: 'TEST-R-0001' })).not.toBeChecked()
})

it('preserves observations and the witness when a firearm returns during a pause', async () => {
  const load = vi.mocked(api.getArmoryShiftCheckDraft)
  const post = vi.spyOn(api, 'createArmoryShiftCheck').mockResolvedValue(savedCount)
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('checkbox', { name: 'TEST-R-0001' }))
  await user.click(screen.getByRole('button', { name: 'Review check' }))
  await chooseWitness(user)
  await user.click(screen.getByRole('checkbox', { name: 'I report 1 firearm missing' }))
  await user.click(screen.getByRole('button', { name: 'Pause' }))
  const returned = { ...serial, id: 3, serial_code: 'TEST-R-0003' }
  load.mockResolvedValue({ ...testDraft, snapshot_token: 'test-check-returned', expected: [...testDraft.expected, returned] })
  await user.click(screen.getByRole('button', { name: 'Open test check' }))

  const newlyExpected = await screen.findByRole('checkbox', { name: 'TEST-R-0003' })
  expect(screen.getByRole('checkbox', { name: 'TEST-R-0001' })).toBeChecked()
  expect(newlyExpected).not.toBeChecked()
  expect(screen.getByText('The safe changed since the check started. Review the refreshed list, then keep or discard your entries.')).toBeVisible()
  const review = screen.getByRole('button', { name: 'Review check' })
  expect(review).toBeDisabled()
  expect(post).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Keep my entries' }))
  await user.click(review)
  expect(screen.getByText('Test Witness', { selector: 'bdi' })).toBeVisible()
  const confirmation = screen.getByRole('checkbox', { name: 'I report 2 firearms missing' })
  const save = screen.getByRole('button', { name: 'Report missing and save' })
  expect(confirmation).not.toBeChecked()
  expect(save).toBeDisabled()
  await user.click(confirmation)
  await user.click(save)
  await waitFor(() => expect(post).toHaveBeenCalledExactlyOnceWith(1, {
    snapshot_token: 'test-check-returned', observed_serial_ids: [1], confirm_missing: true, witness_employee_id: 'T-0003',
  }))
})

it('requires fresh observations when the organization shift changes during a pause', async () => {
  const load = vi.mocked(api.getArmoryShiftCheckDraft)
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('checkbox', { name: 'TEST-R-0001' }))
  await user.click(screen.getByRole('button', { name: 'Pause' }))
  load.mockResolvedValue({ ...testDraft, window: { ...testDraft.window, shift_kind: 'night' }, snapshot_token: 'new-shift' })
  await user.click(screen.getByRole('button', { name: 'Open test check' }))
  expect(await screen.findByText('A new shift has started. Start a fresh check.')).toBeVisible()
  expect(screen.getByRole('checkbox', { name: 'TEST-R-0001' })).not.toBeChecked()
})

it('does not request a check draft without edit', () => {
  caps.edit = false
  mount()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.getArmoryShiftCheckDraft).not.toHaveBeenCalled()
})
