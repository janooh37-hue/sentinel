/**
 * EmployeesTableField — passport list picker tests.
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

function Host() {
  const methods = useForm({ defaultValues: { items: [] } })
  return (
    <QueryClientProvider client={makeClient()}>
      <FormProvider {...methods}>
        <EmployeesTableField
          name="items"
          label_en="Employees"
          label_ar="الموظفون"
          required
        />
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
})
