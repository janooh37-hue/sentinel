import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import { api, ApiError } from '@/lib/api'
import i18n from '@/lib/i18n'
import { BulkReturnDialog } from './BulkReturnDialog'
import { candidates, firearmLine, issue, otherSafe, renderArmory, returnPosting, roundsLine, slingLine, testSafe, testShift } from './shiftFixtures'

const caps = vi.hoisted(() => ({ view: true, edit: true }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({
  has: (cap: string) => cap === 'armory.view' ? caps.view : caps.edit,
  isLoading: false,
}) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, email: 'armorer@example.test', employee_id: 'T-0001' }, status: 'authed' }) }))

const saved = [{ posting: returnPosting, assignment: issue }]

beforeEach(async () => {
  vi.restoreAllMocks()
  caps.view = true
  caps.edit = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'getArmoryShift').mockResolvedValue(testShift)
  vi.spyOn(api, 'listArmoryPeople').mockResolvedValue(candidates)
})

function mount() {
  const onSaved = vi.fn()
  function ReturnHost() {
    const [open, setOpen] = useState(true)
    const opener = useRef<HTMLButtonElement>(null)
    return <>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>Open test return</button>
      <BulkReturnDialog open={open} safeId={testSafe.id} onOpenChange={setOpen} onSaved={onSaved} returnFocusRef={opener} />
    </>
  }
  renderArmory(<ReturnHost />)
  return onSaved
}

it('rejects ambiguous suffixes and posts just the explicitly scanned line in a ready record', async () => {
  const post = vi.spyOn(api, 'createArmoryBulkReturn').mockResolvedValue(saved)
  const onSaved = mount()
  const user = userEvent.setup()
  const scanner = await screen.findByRole('textbox', { name: 'Scan or type a return serial' })
  const first = screen.getByRole('checkbox', { name: /TEST-R-0001/ })
  const second = screen.getByRole('checkbox', { name: /TEST-S-0001/ })
  expect(first).not.toBeChecked()
  expect(second).not.toBeChecked()
  expect(screen.getByRole('spinbutton', { name: 'Rounds returned' })).toHaveValue(null)
  await user.type(scanner, '0001{Enter}')
  expect(screen.getByRole('alert')).toHaveTextContent('More than one match. Enter the full serial.')
  expect(first).not.toBeChecked()
  expect(second).not.toBeChecked()
  expect(post).not.toHaveBeenCalled()
  await user.clear(scanner)
  await user.type(scanner, 'test-r-0001{Enter}')
  expect(first).toBeChecked()
  expect(second).not.toBeChecked()
  expect(screen.getByText('of', { exact: false, selector: 'p[role=status]' })).toHaveTextContent('1 of 2 records ready. Unconfirmed items stay out.')
  await user.click(screen.getByRole('button', { name: 'Record 1 return' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
  expect(post).toHaveBeenCalledExactlyOnceWith({ safe_id: 1, records: [{
    assignment_id: 10, witness_employee_id: null,
    lines: [{ assignment_line_id: 101, expected_remaining_qty: 1, returned_qty: 1, condition: 'ok', shortfall: null }],
  }] })
})

it('holds zero rounds until the shortfall and independent witness are fully recorded', async () => {
  const post = vi.spyOn(api, 'createArmoryBulkReturn').mockResolvedValue(saved)
  mount()
  const user = userEvent.setup()
  const amount = await screen.findByRole('spinbutton', { name: 'Rounds returned' })
  await user.type(amount, '0')
  expect(amount).toHaveValue(0)
  expect(screen.getByRole('button', { name: 'Record returns' })).toBeDisabled()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Reason' }), 'other')
  const reference = screen.getByRole('textbox', { name: 'Reference' })
  await user.type(reference, 'A--')
  await user.type(screen.getByRole('textbox', { name: 'Describe the reason' }), 'Test note')
  const witness = await screen.findByRole('button', { name: /Test Witness/ })
  expect(screen.queryByRole('button', { name: /Test Armorer|Test Guard One/ })).not.toBeInTheDocument()
  await user.click(witness)
  expect(screen.getByRole('button', { name: 'Record returns' })).toBeDisabled()
  expect(post).not.toHaveBeenCalled()
  await user.clear(reference)
  await user.type(reference, 'TEST-A1')
  await user.click(screen.getByRole('button', { name: 'Record 1 return' }))
  await waitFor(() => expect(post).toHaveBeenCalledExactlyOnceWith({ safe_id: 1, records: [{
    assignment_id: 10, witness_employee_id: 'T-0003', lines: [{
      assignment_line_id: 102, expected_remaining_qty: 9, returned_qty: 0, condition: null,
      shortfall: { reason: 'other', reference: 'TEST-A1', note: 'Test note' },
    }],
  }] }))
})

it('leaves an unfinished record out of the batch even when one of its lines was ticked', async () => {
  const post = vi.spyOn(api, 'createArmoryBulkReturn').mockResolvedValue(saved)
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('checkbox', { name: /TEST-R-0001/ }))
  await user.type(screen.getByRole('spinbutton', { name: 'Rounds returned' }), '0')
  await user.click(screen.getByRole('checkbox', { name: /TEST-S-0001/ }))
  await user.click(screen.getByRole('button', { name: 'Record 1 return' }))
  await waitFor(() => expect(post).toHaveBeenCalledExactlyOnceWith({ safe_id: 1, records: [{
    assignment_id: 11, witness_employee_id: null,
    lines: [{ assignment_line_id: 111, expected_remaining_qty: 1, returned_qty: 1, condition: 'ok', shortfall: null }],
  }] }))
})

it('refetches on 409 and retains only the still-matching confirmation without auto retry', async () => {
  const load = vi.mocked(api.getArmoryShift)
  load.mockResolvedValueOnce(testShift).mockResolvedValue({ ...testShift, safes: [{
    ...testShift.safes[0],
    out: [{ ...issue, lines: [firearmLine, { ...roundsLine, remaining_qty: 0 }, slingLine] }],
  }] })
  const post = vi.spyOn(api, 'createArmoryBulkReturn')
    .mockRejectedValueOnce(new ApiError(409, 'armory_stale_return', 'Backend-only message'))
    .mockResolvedValueOnce(saved)
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('checkbox', { name: /TEST-R-0001/ }))
  await user.click(screen.getByRole('button', { name: 'All 9' }))
  await user.click(screen.getByRole('button', { name: 'Record 1 return' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('This record changed since you opened it.')
  await waitFor(() => expect(screen.queryByRole('spinbutton', { name: 'Rounds returned' })).not.toBeInTheDocument())
  expect(load).toHaveBeenCalledTimes(2)
  expect(post).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('checkbox', { name: /TEST-R-0001/ })).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Record 1 return' }))
  await waitFor(() => expect(post).toHaveBeenLastCalledWith({ safe_id: 1, records: [{
    assignment_id: 10, witness_employee_id: null,
    lines: [{ assignment_line_id: 101, expected_remaining_qty: 1, returned_qty: 1, condition: 'ok', shortfall: null }],
  }] }))
})

it('cannot scan active returns from a different safe', async () => {
  vi.mocked(api.getArmoryShift).mockResolvedValue({ ...testShift, safes: [testShift.safes[0], {
    ...testShift.safes[0], safe: otherSafe, out: [{ ...issue, id: 12, safe: otherSafe, lines: [{ ...firearmLine, id: 112, serial_id: 3, serial_code: 'TEST-B-0001' }] }],
  }] })
  mount()
  const user = userEvent.setup()
  const scanner = await screen.findByRole('textbox', { name: 'Scan or type a return serial' })
  await user.type(scanner, 'TEST-B-0001{Enter}')
  expect(screen.getByRole('alert')).toHaveTextContent('That serial is not in these return records.')
  expect(screen.queryByRole('checkbox', { name: /TEST-B-0001/ })).not.toBeInTheDocument()
  expect(api.getArmoryShift).toHaveBeenCalledWith(1)
})

it('does not open or fetch for an edit-only principal', () => {
  caps.view = false
  mount()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.getArmoryShift).not.toHaveBeenCalled()
})
