/**
 * TransferEmployeeDialog endpoint-selection tests: the "issue transfer letter"
 * checkbox (default ON) decides POST /duty/transfer vs plain PATCH.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { vi, test, expect, beforeEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: {
    updateEmployee: vi.fn(),
    transferDuty: vi.fn(),
    listEmployees: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  },
  apiErrorMessage: (e: unknown) => String(e),
}))
vi.mock('@/pages/dutyLocations/transferDefaults', () => ({
  loadTransferDefaults: () => ({ recipientId: null, managerId: null, cc: [] }),
  saveTransferDefaults: vi.fn(),
}))
vi.mock('@/components/application/fields/RecipientPickerField', () => ({ RecipientPickerField: () => null }))
vi.mock('@/components/application/fields/ManagerPickerField', () => ({ ManagerPickerField: () => null }))
vi.mock('@/components/application/fields/MultiRecipientPickerField', () => ({ MultiRecipientPickerField: () => null }))

beforeEach(() => { vi.clearAllMocks() })

import { api } from '@/lib/api'
import type { EmployeeRead } from '@/lib/api'
import { TransferEmployeeDialog } from './TransferEmployeeDialog'

const employee = {
  id: 'G100',
  name_en: 'John',
  duty_unit: 'السرية الأولى',
  duty_post: null,
} as unknown as EmployeeRead

function renderDialog(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <TransferEmployeeDialog open employee={employee} onOpenChange={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

test('checkbox on (default): confirms via POST /duty/transfer', async () => {
  vi.mocked(api.transferDuty).mockResolvedValue({ moved: ['G100'], book_id: 7, ref: 'GB-1' } as never)
  renderDialog()
  fireEvent.change(screen.getByLabelText('dutyLocations.transfer.destUnit'), {
    target: { value: 'السرية الثانية' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'dutyLocations.transfer.generate' }))
  await waitFor(() => expect(api.transferDuty).toHaveBeenCalled())
  expect(vi.mocked(api.transferDuty).mock.calls[0][0]).toMatchObject({
    employee_ids: ['G100'],
    to_unit: 'السرية الثانية',
  })
  expect(api.updateEmployee).not.toHaveBeenCalled()
})

test('checkbox off: confirms via plain PATCH', async () => {
  vi.mocked(api.updateEmployee).mockResolvedValue({} as never)
  renderDialog()
  fireEvent.click(screen.getByLabelText('dutyLocations.transfer.issueLetter'))
  fireEvent.change(screen.getByLabelText('dutyLocations.transfer.destUnit'), {
    target: { value: 'السرية الثانية' },
  })
  fireEvent.change(screen.getByLabelText('dutyLocations.transfer.destPost'), {
    target: { value: 'البوابة' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
  await waitFor(() =>
    expect(api.updateEmployee).toHaveBeenCalledWith('G100', {
      duty_unit: 'السرية الثانية',
      duty_post: 'البوابة',
    }),
  )
  expect(api.transferDuty).not.toHaveBeenCalled()
})
