import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, type ArmoryStockTotals } from '@/lib/api'
import { ARMORY_EDIT_CAP, ARMORY_VIEW_CAP } from '@/lib/armory'
import i18n from '@/lib/i18n'
import { AuditPane } from './AuditPane'
import { DecisionDialog } from './DecisionDialog'
import {
  renderAudit,
  testAccessory,
  testCandidate,
  testCount,
  testDiscrepancy,
  testInvolved,
  testPerson,
  testRecorder,
  testSafe,
  testWitness,
} from './auditTestFixtures'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap === ARMORY_VIEW_CAP || cap === ARMORY_EDIT_CAP }),
}))
vi.mock(import('@/lib/api'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      listArmoryDiscrepancies: vi.fn(),
      getArmoryItem: vi.fn(),
      listArmoryPeople: vi.fn(),
      decideArmoryDiscrepancy: vi.fn(),
    },
  }
})

beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.listArmoryPeople).mockResolvedValue([
    testCandidate(testRecorder),
    testCandidate(testInvolved),
    testCandidate(testPerson('T-0003', 'Test Operator')),
    testCandidate(testWitness),
  ])
})

async function fillDecision(user: UserEvent) {
  await user.click(screen.getByRole('radio', { name: 'Found' }))
  fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: '  Reviewed the test evidence.  ' } })
  const witness = screen.getByRole('searchbox', { name: 'Decision witness' })
  fireEvent.change(witness, { target: { value: 'Test' } })
  await waitFor(() => expect(api.listArmoryPeople).toHaveBeenCalledWith({ purpose: 'witness', safe_id: 7, q: 'Test' }))
  const eligible = await screen.findByRole('button', { name: /Test Witness/ })
  expect(screen.queryByRole('button', { name: /Test Recorder|Test Involved Employee|Test Operator/ })).not.toBeInTheDocument()
  witness.focus()
  await user.keyboard('{ArrowDown}')
  expect(eligible).toHaveFocus()
  await user.keyboard('{Enter}')
}

describe('DecisionDialog', () => {
  it('offers only allowed outcomes and submits the exact witnessed decision payload', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const response = testDiscrepancy({ status: 'resolved', can_decide: false })
    vi.mocked(api.decideArmoryDiscrepancy).mockResolvedValue(response)
    renderAudit(<DecisionDialog discrepancy={testDiscrepancy()} onClose={vi.fn()} onSaved={onSaved} />)

    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByRole('radio', { name: 'Recording error' })).toBeVisible()
    expect(screen.queryByRole('radio', { name: 'Lost' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await fillDecision(user)
    expect(api.listArmoryPeople).toHaveBeenCalledWith({ purpose: 'witness', safe_id: 7, q: 'Test' })
    const note = screen.getByLabelText('Decision note')
    fireEvent.change(note, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(note, { target: { value: '  Reviewed the test evidence.  ' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(response))
    expect(api.decideArmoryDiscrepancy).toHaveBeenCalledExactlyOnceWith(51, {
      outcome: 'found', note: 'Reviewed the test evidence.', witness_employee_id: 'T-0004',
    })
  })

  it('requires a full batch allocation only for a stock-changing expiry decision', async () => {
    const user = userEvent.setup()
    const discrepancy = testDiscrepancy({
      kind: 'monthly_quantity',
      source: testCount.posting,
      item: { ...testAccessory, name_en: 'Test Expiry Item', kind: 'expiry' },
      expected_qty: 3,
      observed_qty: 1,
      serial_id: null,
      serial_code: null,
      person: null,
      allowed_outcomes: ['found', 'lost', 'recording_error'],
    })
    const stock: ArmoryStockTotals = {
      opening_qty: 3, received_qty: 0, known_in_safe: 3, in_safe: 3, available_qty: 3, unrecorded_qty: null,
      out_on_shift: 0, in_custody: 0, in_repair: null, missing: null, lost: null, written_off: null,
      awaiting_rounds_decision: null, expended_rounds: null, lost_rounds: null, settled_rounds: null,
      expired_qty: 0, book_total: 3,
    }
    vi.mocked(api.getArmoryItem).mockResolvedValue({
      ...discrepancy.item, preset_key: null, optional_kit_ids: [], stock: [{ ...stock, safe: testSafe }],
      totals: stock, serials: [], recent_movements: [],
      batches: [{
        batch: { id: 19, batch_ref: 'TEST-LOT-01', expires_on: '2025-12-31' },
        safe: testSafe, on_hand: 3, status: 'valid',
      }],
    })
    vi.mocked(api.listArmoryPeople).mockResolvedValue([testCandidate(testWitness)])
    vi.mocked(api.decideArmoryDiscrepancy).mockResolvedValue({ ...discrepancy, status: 'resolved', can_decide: false })
    renderAudit(<DecisionDialog discrepancy={discrepancy} onClose={vi.fn()} />)

    await fillDecision(user)
    expect(api.getArmoryItem).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    await user.click(screen.getByRole('radio', { name: 'Lost' }))
    const batchQuantity = await screen.findByRole('textbox', { name: /TEST-LOT-01/ })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(batchQuantity, { target: { value: '2' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.decideArmoryDiscrepancy).toHaveBeenCalledExactlyOnceWith(51, {
      outcome: 'lost', note: 'Reviewed the test evidence.', witness_employee_id: 'T-0004',
      batches: [{ batch_id: 19, qty: 2 }],
    }))
  })

  it('shows a translated stale conflict, refreshes the record and cannot replay the attestation', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listArmoryDiscrepancies).mockResolvedValue({
      items: [testDiscrepancy()], page: 1, page_size: 50, total: 1,
    })
    vi.mocked(api.decideArmoryDiscrepancy).mockRejectedValue(
      new ApiError(409, 'armory_stale_decision', 'Test server detail', { discrepancy_id: 51 }),
    )
    renderAudit(<AuditPane safeId={7} />)
    await user.click(await screen.findByRole('button', { name: 'Record decision' }))

    await fillDecision(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This discrepancy changed. Review the current details.')
    await waitFor(() => expect(api.listArmoryDiscrepancies).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Test server detail')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.decideArmoryDiscrepancy).toHaveBeenCalledTimes(1)
  })
})
