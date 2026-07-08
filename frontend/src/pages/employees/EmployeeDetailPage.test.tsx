/**
 * EmployeeDetailPage — structural tests for the profile-as-file layout.
 *
 * Covers:
 *  - Edit wiring: clicking the ID-card edit button renders EmployeeForm
 *  - Default tab: the chip row starts on 'profile'
 *  - Mini search focus: focusing the mini search input navigates to /employees
 *  - Gaps card: missing_fields from the detail response are passed through
 *
 * Children are stubbed — component internals are covered by their own suites.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi, test, expect } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: {
    getEmployeeDetail: vi.fn(),
    updateEmployee: vi.fn(),
  },
}))
vi.mock('@/lib/employeeRecents', () => ({
  recordRecentEmployee: vi.fn(),
}))
/* eslint-disable @typescript-eslint/no-explicit-any */
vi.mock('./EmployeeIdCard', () => ({
  EmployeeIdCard: ({ onEdit }: any) => (
    <button onClick={onEdit}>employee.card.edit</button>
  ),
}))
vi.mock('./EmployeeGapsCard', () => ({
  EmployeeGapsCard: ({ missing }: any) => (
    <ul>{missing.map((f: string) => <li key={f}>employee.field.{f}</li>)}</ul>
  ),
}))
vi.mock('./EmployeeTabChips', () => ({
  EmployeeTabChips: ({ active }: any) => (
    <div data-testid="tab-chips" data-active={active} />
  ),
}))
vi.mock('./tabs/DocumentsTab', () => ({ DocumentsTab: () => null }))
vi.mock('./tabs/ProfileTab', () => ({ ProfileTab: () => null }))
vi.mock('./tabs/LeavesTab', () => ({ LeavesTab: () => null }))
vi.mock('./tabs/ViolationsTab', () => ({ ViolationsTab: () => null }))
vi.mock('./tabs/ActivityTab', () => ({ ActivityTab: () => null }))
vi.mock('./tabs/MessagesTab', () => ({ MessagesTab: () => null }))
vi.mock('@/components/employees/EmployeeForm', () => ({
  EmployeeForm: ({ mode }: any) => <div data-testid="employee-form" data-mode={mode} />,
}))
/* eslint-enable @typescript-eslint/no-explicit-any */

import { api } from '@/lib/api'
import { EmployeeDetailPage } from './EmployeeDetailPage'

const detail = {
  employee: { id: 'G100', name_en: 'John Doe', name_ar: 'جون دو', status: 'Active', has_photo: false },
  stats: { documents: 3, leaves_taken_days: 5, violations: 0, ledger_count: 2 },
  recent_documents: [],
  recent_leaves: [],
  recent_violations: [],
  recent_activity: [],
  recent_sms: [],
  missing_fields: [],
  completeness: { filled: 10, tracked: 14 },
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/employees/G100']}>
        <Routes>
          <Route path="/employees/:id" element={<EmployeeDetailPage />} />
          <Route path="/employees" element={<div>lookup-page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

test('clicking Edit renders EmployeeForm in edit mode', async () => {
  vi.mocked(api.getEmployeeDetail).mockResolvedValue(detail as never)
  renderPage()
  fireEvent.click(await screen.findByText('employee.card.edit'))
  const form = screen.getByTestId('employee-form')
  expect(form).toBeInTheDocument()
  expect(form.dataset.mode).toBe('edit')
})

test('default tab is profile', async () => {
  vi.mocked(api.getEmployeeDetail).mockResolvedValue(detail as never)
  renderPage()
  await screen.findByTestId('tab-chips')
  expect(screen.getByTestId('tab-chips').dataset.active).toBe('profile')
})

test('mini search focus navigates to /employees', async () => {
  vi.mocked(api.getEmployeeDetail).mockResolvedValue(detail as never)
  renderPage()
  const input = await screen.findByPlaceholderText('employees.lookup.miniPlaceholder')
  fireEvent.focus(input)
  expect(screen.getByText('lookup-page')).toBeInTheDocument()
})

test('gaps card lists missing_fields labels', async () => {
  vi.mocked(api.getEmployeeDetail).mockResolvedValue({
    ...detail,
    missing_fields: ['nationality'],
    completeness: { filled: 9, tracked: 14 },
  } as never)
  renderPage()
  expect(await screen.findByText('employee.field.nationality')).toBeInTheDocument()
})
