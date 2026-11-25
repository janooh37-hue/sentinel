/**
 * EmployeesTableField — release-list picker tests.
 *
 * Drives the shared EmployeePicker combobox: focus opens the list (lookupEmployees),
 * clicking a row resolves the employee (getEmployeeLookup) and appends a table row.
 * Mocks `@/lib/api`; i18n comes from the global test/setup.ts.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useForm, FormProvider } from 'react-hook-form'

vi.mock('@/lib/api', () => ({
  api: {
    lookupEmployees: vi.fn(),
    getEmployeeLookup: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    code?: string
  },
}))

import { EmployeesTableField } from './EmployeesTableField'
import { api } from '@/lib/api'

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

type Columns = { key: string; label_en: string; label_ar: string }[]

const PASSPORT_COLUMNS: Columns = [
  { key: 'nationality', label_en: 'Nationality', label_ar: 'الجنسية' },
  { key: 'passport_no', label_en: 'Passport No', label_ar: 'رقم جواز السفر' },
]

const onItems = vi.fn()

function Host({ columns = PASSPORT_COLUMNS }: { columns?: Columns }) {
  const methods = useForm({ defaultValues: { items: [] } })
  return (
    <QueryClientProvider client={makeClient()}>
      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit((v) => onItems(v.items))}>
          <EmployeesTableField
            name="items"
            label_en="Employees"
            label_ar="الموظفون"
            required
            columns={columns}
          />
          <button type="submit">submit</button>
        </form>
      </FormProvider>
    </QueryClientProvider>
  )
}

const EMP = {
  id: 'G1234',
  name_en: 'Ali Hassan',
  name_ar: 'علي حسن',
  nationality: 'Egyptian',
  passport_no: 'A1112223',
  position: 'Security Guard',
  position_ar: 'حارس أمن',
  uae_id_no: '784-1990-1234567-1',
  uae_id_expiry: '2028-03-14',
  department: 'Ops',
}

async function pickFirstEmployee() {
  const combo = screen.getByRole('combobox')
  fireEvent.focus(combo)
  const option = await screen.findByRole('option')
  fireEvent.mouseDown(option)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.lookupEmployees).mockResolvedValue({ items: [EMP] } as never)
  vi.mocked(api.getEmployeeLookup).mockResolvedValue(EMP as never)
})

describe('EmployeesTableField', () => {
  it('appends a row filled from the picked employee (Arabic name)', async () => {
    render(<Host />)
    await pickFirstEmployee()
    await waitFor(() => expect(screen.getByText('G1234')).toBeInTheDocument())
    expect(screen.getByText('علي حسن')).toBeInTheDocument()
    expect(screen.getByDisplayValue('A1112223')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Egyptian')).toBeInTheDocument()
    expect(api.getEmployeeLookup).toHaveBeenCalledWith('G1234')
  })

  it('rejects a duplicate employee (no second row)', async () => {
    render(<Host />)
    await pickFirstEmployee()
    await waitFor(() => expect(screen.getByText('G1234')).toBeInTheDocument())
    await pickFirstEmployee()
    await waitFor(() => {
      expect(screen.getAllByText('G1234')).toHaveLength(1)
    })
  })

  it('prefills the UAE ID columns, with the expiry in the paper date format', async () => {
    render(
      <Host
        columns={[
          { key: 'nationality', label_en: 'Nationality', label_ar: 'الجنسية' },
          { key: 'uae_id_no', label_en: 'Emirates ID No', label_ar: 'رقم الهوية' },
          { key: 'uae_id_expiry', label_en: 'ID Expiry', label_ar: 'تاريخ انتهاء الهوية' },
        ]}
      />,
    )
    await pickFirstEmployee()
    await waitFor(() => expect(screen.getByText('G1234')).toBeInTheDocument())
    expect(screen.getByRole('columnheader', { name: 'Emirates ID No' })).toBeInTheDocument()
    expect(screen.queryByDisplayValue('A1112223')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    await waitFor(() =>
      expect(onItems).toHaveBeenCalledWith([
        {
          employee_id: 'G1234',
          name: 'علي حسن',
          nationality: 'Egyptian',
          uae_id_no: '784-1990-1234567-1',
          uae_id_expiry: '14/03/2028',
        },
      ]),
    )
  })

  it('prefills the Work ID job title in Arabic', async () => {
    render(
      <Host
        columns={[{ key: 'position', label_en: 'Job Title', label_ar: 'المسمى الوظيفي' }]}
      />,
    )
    await pickFirstEmployee()
    await waitFor(() => expect(screen.getByDisplayValue('حارس أمن')).toBeInTheDocument())
  })
})
