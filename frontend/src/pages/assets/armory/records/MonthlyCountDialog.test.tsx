import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, type ArmoryCountRead, type ArmoryMonthlyCountDraftRead } from '@/lib/api'
import { ARMORY_EDIT_CAP, ARMORY_VIEW_CAP } from '@/lib/armory'
import i18n from '@/lib/i18n'
import { MonthlyCountDialog } from './MonthlyCountDialog'
import { renderAudit, testAccessory, testCandidate, testCount, testSafe, testSerialItem, testWitness } from './auditTestFixtures'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap === ARMORY_VIEW_CAP || cap === ARMORY_EDIT_CAP }),
}))
vi.mock(import('@/lib/api'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      listArmoryPeople: vi.fn(),
      getArmoryMonthlyCountDraft: vi.fn(),
      createArmoryMonthlyCount: vi.fn(),
    },
  }
})

const draft: ArmoryMonthlyCountDraftRead = {
  safe: testSafe,
  month: '2025-02',
  snapshot_token: 'test-draft-token',
  items: [testAccessory, testSerialItem],
}

beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.getArmoryMonthlyCountDraft).mockResolvedValue(draft)
  vi.mocked(api.listArmoryPeople).mockResolvedValue([testCandidate(testWitness)])
})

async function chooseWitness(user: UserEvent) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Count witness' }), { target: { value: 'Test' } })
  await user.click(await screen.findByRole('button', { name: /Test Witness/ }))
}

describe('MonthlyCountDialog', () => {
  it('keeps the draft blind, requires explicit counts, and reveals the comparison only after save', async () => {
    const user = userEvent.setup()
    const pending: { complete?: (result: ArmoryCountRead) => void } = {}
    vi.mocked(api.createArmoryMonthlyCount).mockImplementation(() => new Promise((resolve) => {
      pending.complete = resolve
    }))
    renderAudit(<MonthlyCountDialog safeId={7} open onClose={vi.fn()} />)

    const counted = await screen.findByLabelText('Counted quantity')
    expect(counted).toHaveValue('')
    expect(screen.queryByText('Expected', { exact: true })).not.toBeInTheDocument()
    await chooseWitness(user)
    const save = screen.getByRole('button', { name: 'Save monthly count' })
    fireEvent.change(counted, { target: { value: '0' } })
    expect(save).toBeDisabled()

    const radio = within(screen.getByRole('group', { name: 'Test Radio' }))
    fireEvent.paste(radio.getByLabelText('Serial numbers counted'), {
      clipboardData: { getData: () => ' test-a-٠١\nTEST-A-۰۱\n test-a-٠٢ ' },
    })
    expect(radio.getAllByText('TEST-A-01')).toHaveLength(1)
    await user.click(radio.getByRole('button', { name: 'Remove serial TEST-A-02' }))
    fireEvent.change(radio.getByLabelText('Units without a serial number'), { target: { value: '۰' } })
    expect(save).toBeDisabled()
    await user.click(radio.getByRole('checkbox', { name: 'Serial count complete' }))
    expect(save).toBeEnabled()
    await user.click(save)

    await waitFor(() => expect(api.createArmoryMonthlyCount).toHaveBeenCalledExactlyOnceWith(7, {
      snapshot_token: 'test-draft-token',
      witness_employee_id: 'T-0004',
      lines: [
        { item_id: 11, observed_qty: 0, serials_complete: false },
        { item_id: 12, observed_qty: 0, observed_serial_codes: ['TEST-A-01'], serials_complete: true },
      ],
    }))
    expect(screen.queryByText('Expected', { exact: true })).not.toBeInTheDocument()
    await act(async () => { pending.complete?.(testCount) })

    expect(await screen.findByText('Monthly count recorded. Differences appear below.')).toBeVisible()
    expect(screen.getByText('Expected', { exact: true })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Discrepancy 51' })).toBeVisible()
  })

  it('asks before discarding an explicit zero and allows editing to continue', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderAudit(<MonthlyCountDialog safeId={7} open onClose={onClose} />)

    fireEvent.change(await screen.findByLabelText('Counted quantity'), { target: { value: '0' } })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('alertdialog', { name: 'Discard this count?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Counted quantity')).toHaveValue('0')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(api.createArmoryMonthlyCount).not.toHaveBeenCalled()
  })

  it('refreshes a stale draft and retains observations only after a choice, without replaying the write', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getArmoryMonthlyCountDraft)
      .mockResolvedValueOnce({ ...draft, items: [testAccessory] })
      .mockResolvedValue({ ...draft, snapshot_token: 'test-new-token', items: [testAccessory] })
    vi.mocked(api.createArmoryMonthlyCount).mockRejectedValueOnce(
      new ApiError(409, 'armory_stale_count', 'Test server detail'),
    )
    renderAudit(<MonthlyCountDialog safeId={7} open onClose={vi.fn()} />)

    fireEvent.change(await screen.findByLabelText('Counted quantity'), { target: { value: '0' } })
    await chooseWitness(user)
    await user.click(screen.getByRole('button', { name: 'Save monthly count' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The safe changed since the count started.')
    const keep = await screen.findByRole('button', { name: 'Keep observations' })
    await waitFor(() => expect(keep).toBeEnabled())
    expect(api.getArmoryMonthlyCountDraft).toHaveBeenCalledTimes(2)
    await user.click(keep)
    expect(screen.getByLabelText('Counted quantity')).toHaveValue('0')
    expect(screen.getByRole('button', { name: 'Save monthly count' })).toBeDisabled()
    expect(api.createArmoryMonthlyCount).toHaveBeenCalledTimes(1)
  })

  it('links to an already recorded period after observations are discarded and does not offer another save', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getArmoryMonthlyCountDraft).mockResolvedValue({ ...draft, items: [testAccessory] })
    vi.mocked(api.createArmoryMonthlyCount).mockRejectedValueOnce(
      new ApiError(409, 'armory_period_already_recorded', 'Test server detail', { count_id: 43 }),
    )
    renderAudit(<MonthlyCountDialog safeId={7} open onClose={vi.fn()} />)

    fireEvent.change(await screen.findByLabelText('Counted quantity'), { target: { value: '1' } })
    await chooseWitness(user)
    await user.click(screen.getByRole('button', { name: 'Save monthly count' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This period already has a recorded check or count.')
    const restart = screen.getByRole('button', { name: 'Start over' })
    await waitFor(() => expect(restart).toBeEnabled())
    await user.click(restart)

    expect(screen.getByLabelText('Counted quantity')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Save monthly count' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View record' })).toHaveAttribute(
      'href', '/holdings/armory?tab=audit&pane=counts&count=43',
    )
    expect(api.createArmoryMonthlyCount).toHaveBeenCalledTimes(1)
  })
})
