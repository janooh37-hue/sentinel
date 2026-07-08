/**
 * ProfileTab section cards tests — Task 9 redesign + inline gap editor.
 *
 * Covers:
 *  - duty unit/post rows render with new field keys
 *  - Transfer button renders for editors
 *  - nationality row shows notSetF + addNow button when missing
 *  - nationality row shows value when not missing
 *  - section pill shows sectionMissing / sectionComplete
 *  - near-expiry chip when uae_id_expiry within 90 days / absent when far
 *  - addNow opens a type-aware inline editor in the row (text vs date input)
 *  - saving the inline editor PATCHes the single field
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi, test, expect, beforeEach } from 'vitest'

const updateEmployee = vi.fn().mockResolvedValue({})

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isError: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: (opts: {
    mutationFn: () => Promise<unknown>
    onSuccess?: () => void
    onError?: (e: unknown) => void
  }) => ({
    isPending: false,
    mutate: () => {
      opts
        .mutationFn()
        .then(() => opts.onSuccess?.())
        .catch((e: unknown) => opts.onError?.(e))
    },
  }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: { updateEmployee: (...args: unknown[]) => updateEmployee(...args), getVault: vi.fn() },
  apiErrorMessage: (e: unknown) => String(e),
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => true }),
}))
vi.mock('@/components/employees/SignaturePad', () => ({ SignaturePad: () => null }))
// ProfileTab imports './PassportField' — mock the same specifier (test lives in the same dir).
vi.mock('./PassportField', () => ({ PassportField: () => null }))
vi.mock('@/components/employees/IdentityDocCard', () => ({ IdentityDocCard: () => null }))
vi.mock('../TransferEmployeeDialog', () => ({ TransferEmployeeDialog: () => null }))

import { ProfileTab } from './ProfileTab'
import type { EmployeeRead } from '@/lib/api'

beforeEach(() => {
  updateEmployee.mockClear()
})

const baseEmployee = {
  id: 'G100',
  name_en: 'John',
  name_ar: 'جون',
  status: 'Active',
  nationality: 'Emirati',
  dob: '1990-01-15',
  contact: '0501234567',
  msg_language: 'en',
  position: 'Guard',
  department: 'Operations',
  duty_unit: 'Unit 1',
  duty_post: 'Post A',
  doj: '2020-01-01',
  doj_company: '2018-01-01',
  uae_id_no: '784-1990-1234567-1',
  uae_id_expiry: null,
  passport_no: 'A1234567',
  passport_expiry: null,
  iban: null,
} as unknown as EmployeeRead

test('renders duty unit and post values', () => {
  const employee = {
    id: 'G100',
    name_en: 'John',
    status: 'Active',
    duty_unit: 'السرية الأولى',
    duty_post: 'البوابة الرئيسية',
  } as unknown as EmployeeRead
  render(<ProfileTab employee={employee} missing={[]} />)
  expect(screen.getByText('employee.field.duty_unit')).toBeInTheDocument()
  expect(screen.getByText('السرية الأولى')).toBeInTheDocument()
  expect(screen.getByText('employee.field.duty_post')).toBeInTheDocument()
  expect(screen.getByText('البوابة الرئيسية')).toBeInTheDocument()
})

test('shows Transfer button for editors', () => {
  const employee = { id: 'G100', name_en: 'John', status: 'Active' } as unknown as EmployeeRead
  render(<ProfileTab employee={employee} missing={[]} />)
  expect(screen.getByText('employee.profile.transfer')).toBeInTheDocument()
})

test('nationality row shows notSetF text and add button when nationality is missing', () => {
  render(<ProfileTab employee={baseEmployee} missing={['nationality']} />)
  expect(screen.getByText('employee.gaps.notSetF')).toBeInTheDocument()
  expect(screen.getByText('employee.gaps.addNow')).toBeInTheDocument()
})

test('nationality row shows value when not in missing list', () => {
  render(<ProfileTab employee={baseEmployee} missing={[]} />)
  expect(screen.getByText('Emirati')).toBeInTheDocument()
  expect(screen.queryByText('employee.gaps.notSetF')).not.toBeInTheDocument()
})

test('section pill shows sectionMissing when fields are missing', () => {
  render(<ProfileTab employee={baseEmployee} missing={['nationality']} />)
  expect(screen.getAllByText('employee.gaps.sectionMissing').length).toBeGreaterThan(0)
})

test('section pill shows sectionComplete for all sections when no fields are missing', () => {
  render(<ProfileTab employee={baseEmployee} missing={[]} />)
  expect(screen.queryByText('employee.gaps.sectionMissing')).not.toBeInTheDocument()
  expect(screen.getAllByText('employee.gaps.sectionComplete').length).toBe(4)
})

test('near-expiry chip renders when uae_id_expiry is within 90 days', () => {
  const near = new Date()
  near.setDate(near.getDate() + 60)
  const expiry = near.toISOString().split('T')[0]
  const employee = { ...baseEmployee, uae_id_expiry: expiry } as unknown as EmployeeRead
  render(<ProfileTab employee={employee} missing={[]} />)
  expect(screen.getByText(/employees\.lookup\.daysLeft/)).toBeInTheDocument()
})

test('near-expiry chip is absent when uae_id_expiry is far away', () => {
  const far = new Date()
  far.setFullYear(far.getFullYear() + 2)
  const expiry = far.toISOString().split('T')[0]
  const employee = { ...baseEmployee, uae_id_expiry: expiry } as unknown as EmployeeRead
  render(<ProfileTab employee={employee} missing={[]} />)
  expect(screen.queryByText(/employees\.lookup\.daysLeft/)).not.toBeInTheDocument()
})

test('addNow opens an inline text editor and saving PATCHes the single field', async () => {
  render(<ProfileTab employee={baseEmployee} missing={['nationality']} />)
  fireEvent.click(screen.getByText('employee.gaps.addNow'))
  const input = screen.getByLabelText('employee.field.nationality')
  expect(input).toHaveAttribute('type', 'text')
  fireEvent.change(input, { target: { value: 'Mauritanian' } })
  fireEvent.click(screen.getByText('common.save'))
  await waitFor(() =>
    expect(updateEmployee).toHaveBeenCalledWith('G100', { nationality: 'Mauritanian' }),
  )
})

test('date fields get a date input in the inline editor', () => {
  render(<ProfileTab employee={{ ...baseEmployee, dob: null } as unknown as EmployeeRead} missing={['dob']} />)
  fireEvent.click(screen.getByText('employee.gaps.addNow'))
  expect(screen.getByLabelText('employee.field.dob')).toHaveAttribute('type', 'date')
})

test('cancel closes the inline editor without saving', () => {
  render(<ProfileTab employee={baseEmployee} missing={['nationality']} />)
  fireEvent.click(screen.getByText('employee.gaps.addNow'))
  fireEvent.click(screen.getByText('common.cancel'))
  expect(screen.queryByLabelText('employee.field.nationality')).not.toBeInTheDocument()
  expect(updateEmployee).not.toHaveBeenCalled()
})

test('requestedFixField opens the editor for that field and reports handled', () => {
  const onFixHandled = vi.fn()
  render(
    <ProfileTab
      employee={baseEmployee}
      missing={['nationality']}
      requestedFixField="nationality"
      onFixHandled={onFixHandled}
    />,
  )
  expect(screen.getByLabelText('employee.field.nationality')).toBeInTheDocument()
  expect(onFixHandled).toHaveBeenCalled()
})
