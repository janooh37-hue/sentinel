/**
 * EmployeeHero capability-gating tests: the Edit action must only render for
 * users holding `employees.edit`.
 */
import { render, screen } from '@testing-library/react'
import { vi, test, expect } from 'vitest'

let allowed = true
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => allowed }),
}))
vi.mock('@/components/employees/useEmployeePhoto', () => ({
  useEmployeePhoto: () => ({ upload: { mutate: vi.fn(), isPending: false } }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en' },
  }),
}))

import { EmployeeHero } from './EmployeeHero'
import type { EmployeeRead } from '@/lib/api'

const employee = {
  id: 'G100',
  name_en: 'John Doe',
  name_ar: 'جون دو',
  status: 'Active',
  has_photo: false,
} as unknown as EmployeeRead

test('shows Edit button when user has employees.edit', () => {
  allowed = true
  render(<EmployeeHero employee={employee} onEdit={vi.fn()} onAddLeave={vi.fn()} onGenerate={vi.fn()} />)
  expect(screen.getByText('actions.edit')).toBeInTheDocument()
})

test('hides Edit button without employees.edit', () => {
  allowed = false
  render(<EmployeeHero employee={employee} onEdit={vi.fn()} onAddLeave={vi.fn()} onGenerate={vi.fn()} />)
  expect(screen.queryByText('actions.edit')).not.toBeInTheDocument()
})
