import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { VehicleFineRead, VehicleRead } from '@/lib/api'
import { FineDialog } from './FineDialog'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<{ api: typeof api }>()
  return {
    ...mod,
    api: {
      ...mod.api,
      getEmployee: vi.fn(),
      listEmployees: vi.fn(),
      updateVehicleFine: vi.fn(),
    },
  }
})

const fine: VehicleFineRead = {
  id: 42,
  vehicle_id: 17,
  employee_id: 'G1001',
  employee_name_ar: null,
  employee_name_en: 'Ahmed Ali',
  date: '2026-08-14',
  time: '09:45:00',
  amount: 650,
  amount_after_discount: null,
  black_points: 6,
  source: 'manual',
  evg_ticket_no: null,
  location: 'Al Raha',
  description: 'Speeding',
  fine_type: null,
  created_at: '2026-08-14T10:00:00Z',
  vehicle_plate_label: '10 \\ 36348',
  vehicle_type_ar: 'مركبة خفيفة',
  vehicle_type_en: 'Light vehicle',
  vehicle_site_id: 3,
}

const currentEmployee = {
  id: 'G1001',
  name_en: 'Ahmed Ali',
  name_ar: null,
  status: 'Active',
  department: 'Transport',
  position: null,
  has_photo: false,
}

const replacementEmployee = {
  id: 'G2002',
  name_en: 'Fatima Noor',
  name_ar: null,
  status: 'Active',
  department: 'Operations',
  position: null,
  has_photo: false,
}

const updatedVehicle = { id: 17 } as VehicleRead

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const onOpenChange = vi.fn()

  render(
    <QueryClientProvider client={queryClient}>
      <FineDialog
        open
        onOpenChange={onOpenChange}
        vehicle={{ id: 17, plate_code: '10', plate_number: '36348' }}
        fine={fine}
      />
    </QueryClientProvider>,
  )

  return { onOpenChange }
}

describe('FineDialog edit mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getEmployee).mockImplementation(async (employeeId) => {
      return (employeeId === currentEmployee.id ? currentEmployee : replacementEmployee) as never
    })
    vi.mocked(api.listEmployees).mockResolvedValue({
      items: [replacementEmployee],
      total: 1,
      limit: 50,
      offset: 0,
    } as never)
    vi.mocked(api.updateVehicleFine).mockResolvedValue(updatedVehicle)
  })

  it('pre-fills the fine and submits the edited employee and fields to the update endpoint', async () => {
    const user = userEvent.setup()
    renderDialog()

    expect(screen.getByRole('dialog', { name: 'Edit fine' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Date/)).toHaveValue('2026-08-14')
    expect(screen.getByLabelText('Time')).toHaveValue('09:45')
    expect(screen.getByLabelText(/^Amount/)).toHaveValue(650)
    expect(screen.getByLabelText(/^Black points/)).toHaveValue(6)
    expect(screen.getByLabelText('Location')).toHaveValue('Al Raha')
    expect(screen.getByLabelText('Description')).toHaveValue('Speeding')

    const employeePicker = screen.getByRole('combobox')
    await waitFor(() => expect(employeePicker).toHaveValue('Ahmed Ali — G1001'))
    await user.click(employeePicker)
    await user.click(await screen.findByRole('option', { name: /Fatima Noor.*G2002/ }))
    await waitFor(() => expect(employeePicker).toHaveValue('Fatima Noor — G2002'))

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(api.updateVehicleFine).toHaveBeenCalledWith(17, 42, {
        employee_id: 'G2002',
        date: '2026-08-14',
        time: '09:45',
        amount: 650,
        black_points: 6,
        location: 'Al Raha',
        description: 'Speeding',
      }),
    )
    expect(api.updateVehicleFine).toHaveBeenCalledTimes(1)
  })

  it('submits a cleared employee assignment as null', async () => {
    const user = userEvent.setup()
    renderDialog()

    await waitFor(() =>
      expect(screen.getByRole('combobox')).toHaveValue('Ahmed Ali — G1001'),
    )
    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByRole('combobox')).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(api.updateVehicleFine).toHaveBeenCalledWith(
        17,
        42,
        expect.objectContaining({ employee_id: null }),
      ),
    )
  })
})
