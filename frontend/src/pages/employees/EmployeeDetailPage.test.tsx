/**
 * EmployeeDetailPage edit wiring: clicking the hero Edit action must render
 * the EmployeeForm in edit mode (it previously just switched tabs).
 * Children are stubbed — hero internals are covered by EmployeeHero.test.tsx.
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
/* eslint-disable @typescript-eslint/no-explicit-any */
vi.mock('./EmployeeHero', () => ({
  EmployeeHero: ({ onEdit }: any) => (
    <button onClick={onEdit}>hero-edit</button>
  ),
}))
vi.mock('./EmployeeQuickStats', () => ({ EmployeeQuickStats: () => null }))
vi.mock('./EmployeeDetailTabs', () => ({ EmployeeDetailTabs: () => null }))
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
  stats: { documents: 0, leaves_taken_days: 0, violations: 0, ledger_count: 0 },
  recent_documents: [],
  recent_leaves: [],
  recent_violations: [],
  recent_activity: [],
  recent_sms: [],
}

test('clicking Edit renders EmployeeForm in edit mode', async () => {
  vi.mocked(api.getEmployeeDetail).mockResolvedValue(detail as never)
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/employees/G100']}>
        <Routes>
          <Route path="/employees/:id" element={<EmployeeDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByText('hero-edit'))
  const form = screen.getByTestId('employee-form')
  expect(form).toBeInTheDocument()
  expect(form.dataset.mode).toBe('edit')
})
