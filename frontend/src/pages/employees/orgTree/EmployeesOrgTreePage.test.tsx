/**
 * The org-tree rail counts working staff only: a Resigned, Terminated or
 * Transferred employee is out of the unit structure, so neither a unit count nor
 * the "Assigned x / total" line includes them.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import i18n from 'i18next'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { EmployeesOrgTreePage } from './EmployeesOrgTreePage'

vi.mock('@/lib/api', () => ({ api: { listEmployees: vi.fn() } }))
vi.mock('./OrgTreeView', () => ({ OrgTreeView: () => null }))
vi.mock('@/components/employees/EmployeesSectionTabs', () => ({ EmployeesSectionTabs: () => null }))
vi.mock('@/components/employees/useAttendanceAttention', () => ({
  useAttendanceAttention: () => ({ attention: 0 }),
}))

const UNIT = 'السرية الأولى'
const ROSTER = [
  { id: 'G1', name_en: 'Working One', name_ar: null, duty_unit: UNIT, duty_post: 'Gate', status: 'Active' },
  { id: 'G2', name_en: 'Loaned Two', name_ar: null, duty_unit: null, duty_post: null, status: 'Loaned' },
  // Still holding a unit: the status alone keeps them out of the count.
  { id: 'G3', name_en: 'Resigned Three', name_ar: null, duty_unit: UNIT, duty_post: 'Gate', status: 'Resigned' },
  { id: 'G4', name_en: 'Transferred Four', name_ar: null, duty_unit: null, duty_post: null, status: 'Transferred' },
]

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(api.listEmployees).mockResolvedValue({ items: ROSTER, total: ROSTER.length } as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test('a departed employee counts in neither the unit nor the total', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/employees/org-tree']}>
        <EmployeesOrgTreePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  expect(await screen.findByText('Assigned: 1 / 2')).toBeInTheDocument()
  const rail = screen.getByRole('navigation')
  expect(within(rail).getByRole('button', { name: new RegExp(UNIT) })).toHaveTextContent(`${UNIT}1`)
})
