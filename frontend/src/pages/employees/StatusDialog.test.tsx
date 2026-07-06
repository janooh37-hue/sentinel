/**
 * StatusDialog invariant tests. Radix Select is not driven in jsdom — the
 * end-date rule is exercised by mounting with a non-Active employee instead.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, test, expect } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: { updateEmployee: vi.fn() },
  apiErrorMessage: (e: unknown) => String(e),
}))

import { api } from '@/lib/api'
import type { EmployeeRead } from '@/lib/api'
import { StatusDialog } from './StatusDialog'

function renderDialog(employee: Partial<EmployeeRead>): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <StatusDialog open employee={employee as EmployeeRead} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

test('non-Active without end date: save disabled and requirement shown', () => {
  renderDialog({ id: 'G100', name_en: 'John', status: 'Resigned', end_date: null })
  expect(screen.getByText('employees.validation.endDateRequired')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled()
})

test('non-Active with end date: saves status + end_date', async () => {
  vi.mocked(api.updateEmployee).mockResolvedValue({} as never)
  renderDialog({ id: 'G100', name_en: 'John', status: 'Resigned', end_date: null })
  // Label text is "employees.fields.end_date *" (required asterisk) — match loosely.
  fireEvent.change(screen.getByLabelText(/employees\.fields\.end_date/), {
    target: { value: '2026-07-31' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
  await waitFor(() =>
    expect(api.updateEmployee).toHaveBeenCalledWith('G100', {
      status: 'Resigned',
      end_date: '2026-07-31',
    }),
  )
})

test('Active: saves with end_date null (clears stale end date)', async () => {
  vi.mocked(api.updateEmployee).mockResolvedValue({} as never)
  renderDialog({ id: 'G100', name_en: 'John', status: 'Active', end_date: '2026-01-01' })
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
  await waitFor(() =>
    expect(api.updateEmployee).toHaveBeenCalledWith('G100', {
      status: 'Active',
      end_date: null,
    }),
  )
})
