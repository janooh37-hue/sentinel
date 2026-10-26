import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type VehicleMaintenanceRead, type VehicleMaintenanceRequestRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { MaintenanceRequestDialog } from './MaintenanceRequestDialog'

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<{ api: typeof api }>()
  return {
    ...mod,
    api: {
      ...mod.api,
      createVehicleMaintenanceRequest: vi.fn(),
      lookupEmployees: vi.fn(),
      getEmployeeLookup: vi.fn(),
    },
  }
})

const employee = {
  id: 'G1001', name_en: 'Ahmed Ali', name_ar: null, status: 'Active',
  department: 'Transport', position: null, has_photo: false,
}
const request: VehicleMaintenanceRequestRead = {
  id: 42, vehicle_id: 17, type: 'repair', description: 'Replace brake pads',
  employee_id: employee.id, odometer_km: 12550, book_id: 501, status: 'open',
  maintenance_id: null, created_by_user_id: 1, created_at: '2026-10-15T09:00:00Z',
  completed_at: null, ref_number: '11/1/GSSG/501',
}
const previousMaintenance: VehicleMaintenanceRead = {
  id: 7, vehicle_id: 17, date: '2026-09-01', type: 'service', odometer_km: 12000,
  cost: 300, vendor_ar: null, vendor_en: null, next_due: null, receipt_file_id: null,
  created_at: '2026-09-01T09:00:00Z', vehicle_plate_label: '10 \\ 36348',
  vehicle_type_ar: '', vehicle_type_en: '',
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.lookupEmployees).mockResolvedValue({ items: [employee], total: 1, limit: 50, offset: 0 } as never)
  vi.mocked(api.getEmployeeLookup).mockResolvedValue(employee as never)
  vi.mocked(api.createVehicleMaintenanceRequest).mockResolvedValue({
    request,
    letter: { book_id: 501, document_id: 701, ref_number: '11/1/GSSG/501', pdf_available: true },
  })
})

describe('MaintenanceRequestDialog', () => {
  it('submits the chosen work, optional driver and edited current odometer, then opens the book', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/request']}>
          <Routes>
            <Route path="/request" element={<MaintenanceRequestDialog open onOpenChange={vi.fn()} vehicle={{ id: 17, plate_code: '10', plate_number: '36348', current_odometer_km: 12500 }} lastMaintenance={previousMaintenance} />} />
            <Route path="/books/501" element={<h1>Generated book</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText('Current odometer (km)')).toHaveValue('12500')
    expect(screen.getByRole('heading', { name: 'Last maintenance' })).toBeInTheDocument()
    expect(screen.getByText('2026-09-01')).toBeInTheDocument()
    await user.click(screen.getByLabelText(/^Maintenance type/))
    await user.click(screen.getByRole('option', { name: 'Repair' }))
    await user.type(screen.getByLabelText(/^Requested work/), '  Replace brake pads  ')
    await user.clear(screen.getByLabelText('Current odometer (km)'))
    await user.type(screen.getByLabelText('Current odometer (km)'), '12550')
    await user.click(screen.getByRole('combobox', { name: 'Employee' }))
    await user.click(await screen.findByRole('option', { name: /Ahmed Ali.*G1001/ }))
    await user.click(screen.getByRole('button', { name: 'Save document' }))

    await waitFor(() => expect(api.createVehicleMaintenanceRequest).toHaveBeenCalledWith(17, {
      type: 'repair', description: 'Replace brake pads', employee_id: 'G1001', odometer_km: 12550,
    }))
    expect(api.createVehicleMaintenanceRequest).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { name: 'Generated book' })).toBeInTheDocument()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['vehicle-maintenance-requests', 17] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books'] })
  })
})
