/**
 * ProfileTab info-grid tests — duty unit/post rows must render (em dash when
 * unassigned). Vault query is stubbed to undefined so the identity section
 * stays un-rendered; SignaturePad is stubbed out.
 */
import { render, screen } from '@testing-library/react'
import { vi, test, expect } from 'vitest'

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isError: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => true }),
}))
vi.mock('@/components/employees/SignaturePad', () => ({ SignaturePad: () => null }))
// ProfileTab imports './PassportField' — mock the same specifier (test lives in the same dir).
vi.mock('./PassportField', () => ({ PassportField: () => null }))
vi.mock('@/components/employees/IdentityDocCard', () => ({ IdentityDocCard: () => null }))

import { ProfileTab } from './ProfileTab'
import type { EmployeeRead } from '@/lib/api'

test('renders duty unit and post values', () => {
  const employee = {
    id: 'G100',
    name_en: 'John',
    status: 'Active',
    duty_unit: 'السرية الأولى',
    duty_post: 'البوابة الرئيسية',
  } as unknown as EmployeeRead
  render(<ProfileTab employee={employee} />)
  expect(screen.getByText('employee.profile.dutyUnit')).toBeInTheDocument()
  expect(screen.getByText('السرية الأولى')).toBeInTheDocument()
  expect(screen.getByText('employee.profile.dutyPost')).toBeInTheDocument()
  expect(screen.getByText('البوابة الرئيسية')).toBeInTheDocument()
})
