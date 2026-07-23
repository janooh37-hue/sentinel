/**
 * EmployeePickerField — single-employee picker field tests.
 *
 * Mocks `@/lib/api`; i18n comes from the global test/setup.ts (lng=en).
 * The Arabic-label test switches language to ar to confirm the AR string
 * renders (not the EN fallback), per i18n-tests-must-assert-arabic memory.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useForm, FormProvider } from 'react-hook-form'
import i18n from 'i18next'

vi.mock('@/lib/api', () => ({
  api: {
    listEmployees: vi.fn(),
    getEmployee: vi.fn(),
  },
}))

import { EmployeePickerField } from './EmployeePickerField'
import { api } from '@/lib/api'

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function Host({ defaultValues = {} }: { defaultValues?: Record<string, unknown> }) {
  const methods = useForm({ defaultValues })
  return (
    <QueryClientProvider client={makeClient()}>
      <FormProvider {...methods}>
        <EmployeePickerField
          name="signer_id"
          label_en="Signer"
          label_ar="الموقّع"
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
  department: 'Ops',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listEmployees).mockResolvedValue({ items: [EMP] } as never)
  vi.mocked(api.getEmployee).mockResolvedValue(EMP as never)
})

describe('EmployeePickerField (English)', () => {
  it('renders the English label', () => {
    render(<Host />)
    expect(screen.getByText('Signer')).toBeInTheDocument()
  })

  it('renders the required marker', () => {
    render(<Host />)
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  it('sets the field value to the employee id on selection', async () => {
    render(<Host />)
    const combo = screen.getByRole('combobox')
    fireEvent.focus(combo)
    const option = await screen.findByRole('option')
    fireEvent.mouseDown(option)
    // The EmployeePicker fetches the selected employee to display its name.
    // We verify getEmployee was called with the picked id (i.e. the id was stored).
    await waitFor(() =>
      expect(vi.mocked(api.getEmployee)).toHaveBeenCalledWith('G1234'),
    )
  })
})

describe('EmployeePickerField (Arabic label)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders the Arabic label under lng=ar', () => {
    render(<Host />)
    expect(screen.getByText('الموقّع')).toBeInTheDocument()
  })
})
