/**
 * TransferDialog destination tests: the operator sets a destination per
 * employee, "apply to all" is a shortcut for the common mass move, and a row
 * without a unit blocks the whole letter.
 *
 * Uses the real English bundle so each row's inputs are labelled
 * "Destination unit for <name>" — unambiguous without index juggling. Note
 * getByLabelText does an exact match, so the bulk row's plain
 * "Destination unit" never collides with a row's longer label.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { TransferDialog } from './TransferDialog'

vi.mock('@/lib/api', () => ({
  api: { transferDuty: vi.fn() },
  apiErrorMessage: (e: unknown) => String(e),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('./transferDefaults', () => ({
  loadTransferDefaults: () => ({ recipientId: null, managerId: null, cc: [] }),
  saveTransferDefaults: vi.fn(),
}))
vi.mock('@/components/application/fields/RecipientPickerField', () => ({ RecipientPickerField: () => null }))
vi.mock('@/components/application/fields/ManagerPickerField', () => ({ ManagerPickerField: () => null }))
vi.mock('@/components/application/fields/MultiRecipientPickerField', () => ({ MultiRecipientPickerField: () => null }))

const A = { id: 'G3309', name_en: 'Mohammed Saeed', name_ar: null, duty_unit: 'السرية الأولى', duty_post: 'البوابة الرئيسية' }
const B = { id: 'G4030', name_en: 'Saif Mubarak', name_ar: null, duty_unit: 'السرية الثانية', duty_post: 'التفتيش' }

beforeEach(() => {
  vi.mocked(api.transferDuty).mockResolvedValue({
    moved: ['G3309', 'G4030'], book_id: 7, ref: 'GB-1', document_id: 9,
  } as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <TransferDialog
        open
        employees={[A, B] as never}
        allEmployees={[A, B] as never}
        onOpenChange={() => {}}
        onTransferred={() => {}}
      />
    </QueryClientProvider>,
  )
}

const generateBtn = () => screen.getByRole('button', { name: /Generate General Book letter/ })

test('a row without a destination unit blocks the letter', async () => {
  const user = userEvent.setup()
  renderDialog()
  expect(generateBtn()).toBeDisabled()
  expect(
    screen.getByText('Choose a destination unit for every employee.'),
  ).toBeInTheDocument()

  // Fill only the first row — still blocked by the second.
  await user.type(screen.getByLabelText('Destination unit for Mohammed Saeed'), 'السرية الرابعة')
  expect(generateBtn()).toBeDisabled()
})

test('apply to all fills every row and a per-row edit overrides it', async () => {
  const user = userEvent.setup()
  renderDialog()

  await user.type(screen.getByLabelText('Destination unit'), 'السرية الرابعة')
  await user.type(screen.getByLabelText('Destination post'), 'البوابة الرئيسية')
  await user.click(screen.getByRole('button', { name: 'Apply to all' }))

  const rowA = screen.getByLabelText('Destination unit for Mohammed Saeed') as HTMLInputElement
  const rowB = screen.getByLabelText('Destination unit for Saif Mubarak') as HTMLInputElement
  expect(rowA.value).toBe('السرية الرابعة')
  expect(rowB.value).toBe('السرية الرابعة')
  expect(generateBtn()).toBeEnabled()

  // Override the second row — a swap into the first employee's old unit.
  await user.clear(rowB)
  await user.type(rowB, 'السرية الأولى')
  await user.type(screen.getByLabelText('Destination post for Saif Mubarak'), 'برج المراقبة')

  await user.click(generateBtn())
  await waitFor(() => expect(api.transferDuty).toHaveBeenCalled())
  expect(vi.mocked(api.transferDuty).mock.calls[0][0]).toEqual({
    moves: [
      { employee_id: 'G3309', to_unit: 'السرية الرابعة', to_post: 'البوابة الرئيسية' },
      { employee_id: 'G4030', to_unit: 'السرية الأولى', to_post: 'برج المراقبة' },
    ],
    recipient_id: null,
    manager_id: null,
    cc: null,
  })
})

test('changing a row unit clears that row post', async () => {
  const user = userEvent.setup()
  renderDialog()
  const rowA = screen.getByLabelText('Destination unit for Mohammed Saeed')
  await user.type(rowA, 'السرية الرابعة')
  await user.type(screen.getByLabelText('Destination post for Mohammed Saeed'), 'البوابة الرئيسية')
  await user.clear(rowA)
  await user.type(rowA, 'السرية الثالثة')
  expect(
    (screen.getByLabelText('Destination post for Mohammed Saeed') as HTMLInputElement).value,
  ).toBe('')
})
