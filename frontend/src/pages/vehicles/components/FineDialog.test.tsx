import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { VehicleFineRead, VehicleRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { FineDialog } from './FineDialog'

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<{ api: typeof api }>()
  return {
    ...mod,
    api: {
      ...mod.api,
      getEmployeeLookup: vi.fn(),
      lookupEmployees: vi.fn(),
      updateVehicleFine: vi.fn(),
      addVehicleFine: vi.fn(),
      getVehicle: vi.fn(),
      listVehicles: vi.fn(),
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
  amount_fils: 65000,
  amount_after_discount_fils: null,
  black_points: 6,
  source: 'manual',
  evg_ticket_no: null,
  location: 'Al Raha',
  description: 'Speeding',
  fine_type: null,
  created_at: '2026-08-14T10:00:00Z',
  payment_status: 'unpaid',
  receipt: null,
  archived_at: null,
  version: '"fine-v1"',
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

function renderDialog(edit = true, picker = false) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const onOpenChange = vi.fn()
  const onSaved = vi.fn()

  render(
    <QueryClientProvider client={queryClient}>
      <FineDialog
        open
        onOpenChange={onOpenChange}
        vehicle={picker ? null : { id: 17, plate_code: '10', plate_number: '36348' }}
        initialVehicleId={23}
        fine={edit ? fine : null}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  )

  return { onOpenChange, onSaved }
}

describe('FineDialog edit mode', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
    vi.mocked(api.getVehicle).mockImplementation(async (id) => ({ id, fines: id === 17 ? [fine] : [] }) as VehicleRead)
    vi.mocked(api.listVehicles).mockResolvedValue([
      { id: 17, plate_code: '10', plate_number: '36348', type_ar: 'مركبة', type_en: 'Light vehicle' },
      { id: 23, plate_code: '14', plate_number: '58216', type_ar: 'حافلة', type_en: 'Bus' },
    ] as never)
    vi.mocked(api.addVehicleFine).mockResolvedValue(fine)
    vi.mocked(api.getEmployeeLookup).mockImplementation(async (employeeId) => {
      return (employeeId === currentEmployee.id ? currentEmployee : replacementEmployee) as never
    })
    vi.mocked(api.lookupEmployees).mockResolvedValue({
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
    expect(screen.getByLabelText(/^Amount/)).toHaveValue('650')
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
      expect(api.updateVehicleFine).toHaveBeenCalledWith(
        17,
        42,
        {
          employee_id: 'G2002',
          date: '2026-08-14',
          time: '09:45',
          amount_fils: 65000,
          black_points: 6,
          location: 'Al Raha',
          description: 'Speeding',
        },
        '"fine-v1"',
      ),
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
        '"fine-v1"',
      ),
    )
  })

  it('creates an unpaid fine with exact fils and reports the saved row', async () => {
    const user = userEvent.setup()
    const { onSaved } = renderDialog(false)
    const amount = screen.getByLabelText(/^Amount/)
    await user.clear(amount)
    await user.type(amount, '349.50')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.addVehicleFine).toHaveBeenCalledWith(17, expect.objectContaining({ amount_fils: 34950, black_points: 0 })))
    expect(api.updateVehicleFine).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ payment_status: 'unpaid' }))
  })

  it.each(['en', 'ar'])('starts on the counter vehicle and changes the records with the picker (%s)', async (language) => {
    await i18n.changeLanguage(language)
    const user = userEvent.setup()
    renderDialog(false, true)
    const picker = await screen.findByRole('combobox', { name: new RegExp(i18n.t('vehicles.selectedVehicle')) })
    expect(picker).toHaveTextContent('58216')
    const aside = within(screen.getByRole('complementary', { name: i18n.t('vehicles.finesOnVehicle') }))
    expect(await aside.findByText(i18n.t('vehicles.noFines'))).toBeInTheDocument()
    await user.click(picker)
    await user.click(screen.getByRole('option', { name: /36348/ }))
    await waitFor(() => expect(api.getVehicle).toHaveBeenCalledWith(17))
    expect(await aside.findByText(i18n.t('vehicles.fines.status.unpaid'))).toBeInTheDocument()
    expect(aside.getByText('6')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: new RegExp(i18n.t('vehicles.request.driverDetails')) })).toBeInTheDocument()
  })

  it('shows only the latest five fines and totals every open fine', async () => {
    const history: VehicleFineRead[] = Array.from({ length: 6 }, (_, index) => ({
      ...fine, id: index + 1, date: `2026-08-0${index + 1}`, black_points: 2,
      payment_status: index === 0 ? 'paid' : index === 1 ? 'unknown' : 'unpaid',
    }))
    vi.mocked(api.getVehicle).mockResolvedValue({ id: 17, fines: history } as VehicleRead)
    renderDialog(false)
    const aside = within(screen.getByRole('complementary', { name: i18n.t('vehicles.finesOnVehicle') }))
    await waitFor(() => expect(aside.getAllByRole('listitem')).toHaveLength(5))
    expect(aside.getByText('5')).toBeInTheDocument()
    expect(aside.getByText('10')).toBeInTheDocument()
    expect(aside.getByText('3,250')).toBeInTheDocument()
  })
})
