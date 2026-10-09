/**
 * StatusDialog reactivation — Radix Select is swapped for a native <select> so
 * the status can be changed in jsdom.
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
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: React.ReactNode
  }) => (
    <select data-testid="status-select" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
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

test.each(['Active', 'Loaned'] as const)('reactivating Transferred to %s: return date defaults to today, sent as effective_date, transfer cleared', async (status) => {
  vi.mocked(api.updateEmployee).mockResolvedValue({} as never)
  renderDialog({
    id: 'G100',
    name_en: 'John',
    status: 'Transferred',
    end_date: '2026-08-15',
    transfer_site: 'Site X',
  })
  fireEvent.change(screen.getByTestId('status-select'), { target: { value: status } })
  const input = screen.getByLabelText(/employees\.fields\.return_date/) as HTMLInputElement
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  expect(input.value).toBe(iso)
  fireEvent.change(input, { target: { value: '2026-09-20' } })
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
  await waitFor(() =>
    expect(api.updateEmployee).toHaveBeenLastCalledWith('G100', {
      status,
      end_date: null,
      effective_date: '2026-09-20',
      transfer_site: null,
      transfer_return_date: null,
    }),
  )
})

test.each(['Active', 'Loaned'] as const)('reactivating Resigned to %s sends the return date as effective_date', async (status) => {
  vi.mocked(api.updateEmployee).mockResolvedValue({} as never)
  renderDialog({ id: 'G100', name_en: 'John', status: 'Resigned', end_date: '2026-08-15' })
  fireEvent.change(screen.getByTestId('status-select'), { target: { value: status } })
  fireEvent.change(screen.getByLabelText(/employees\.fields\.return_date/), {
    target: { value: '2026-09-20' },
  })
  expect(screen.queryByLabelText(/employees\.fields\.(end_date|transfer_site|transfer_return_date)/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
  await waitFor(() =>
    expect(api.updateEmployee).toHaveBeenLastCalledWith('G100', {
      status,
      end_date: null,
      effective_date: '2026-09-20',
    }),
  )
})

test.each([
  ['Active', 'Loaned'],
  ['Loaned', 'Active'],
] as const)('%s → %s sends only status, preserving a pending departure', async (from, to) => {
  vi.mocked(api.updateEmployee).mockResolvedValue({} as never)
  renderDialog({
    id: 'G100',
    name_en: 'John',
    status: from,
    end_date: '2099-08-15',
    pending_status: 'Transferred',
    transfer_site: 'Site X',
    transfer_return_date: '2099-11-15',
  })
  fireEvent.change(screen.getByTestId('status-select'), { target: { value: to } })
  expect(screen.queryByLabelText(/employees\.fields\.(end_date|effective_date|transfer_site|transfer_return_date|return_date)/)).not.toBeInTheDocument()
  expect(screen.queryByText('employees.validation.endDateRequired')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'common.save' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
  await waitFor(() =>
    expect(api.updateEmployee).toHaveBeenLastCalledWith('G100', { status: to }),
  )
})

test('switching to Transferred shows the required site field and expected return', () => {
  renderDialog({ id: 'G100', name_en: 'John', status: 'Active', end_date: null })
  fireEvent.change(screen.getByTestId('status-select'), { target: { value: 'Transferred' } })
  expect(screen.getByLabelText(/employees\.fields\.transfer_site/)).toBeInTheDocument()
  expect(screen.getByLabelText(/employees\.fields\.transfer_return_date/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled()
})
