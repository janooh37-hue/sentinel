import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/lib/toast'

import { api, type OdometerMonthRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { VehicleMaintenancePage } from './VehicleMaintenancePage'
import { MaintenanceDialog } from './components/MaintenanceDialog'

const state = vi.hoisted(() => ({ mobile: false, editable: true }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap === 'vehicles.view' || state.editable }),
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const MONTH: OdometerMonthRead = {
  month: '2026-10',
  rows: [
    {
      vehicle_id: 42, plate_label: '14 \\ 58216', vehicle_type_en: 'Bus', vehicle_type_ar: 'حافلة',
      month: '2026-10', opening_km: 1000, opening_from_previous: false, closing_km: 1200,
      km_driven: 200, maintenance_count: 1, maintenance_cost: 300, maintenance: [],
    },
    {
      vehicle_id: 43, plate_label: '10 \\ 36348', vehicle_type_en: 'Truck', vehicle_type_ar: 'شاحنة',
      month: '2026-10', opening_km: 2000, opening_from_previous: true, closing_km: null,
      km_driven: null, maintenance_count: 0, maintenance_cost: 0, maintenance: [],
    },
  ],
  total_km_driven: 200,
  total_maintenance_cost: 300,
}

function LocationProbe() {
  const location = useLocation()
  return <output>{location.pathname}{location.search}</output>
}

function renderPage(entry = '/vehicles/maintenance?month=2026-10') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[entry]}>
          <VehicleMaintenancePage />
          <LocationProbe />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return client
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state.mobile = false
  state.editable = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'getVehicleOdometer').mockResolvedValue(MONTH)
  vi.spyOn(api, 'listVehicleMaintenance').mockResolvedValue([])
  vi.spyOn(api, 'listVehicles').mockResolvedValue([])
  vi.spyOn(api, 'getVehicle').mockResolvedValue({ id: 42, maintenance: [], current_odometer_km: 1200 } as never)
  vi.spyOn(api, 'saveVehicleOdometer').mockResolvedValue({ ...MONTH.rows[0], closing_km: 1300, km_driven: 300 })
  vi.spyOn(api, 'generateOdometerForm').mockResolvedValue({ book_id: 91, document_id: 92, ref_number: '1/11/93', pdf_available: false })
})

describe('monthly vehicle maintenance', () => {
  it.each([false, true])('renders the log and saves closing with the first opening (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Bus')).toBeInTheDocument()
    expect(screen.getByText('Truck')).toBeInTheDocument()
    expect(api.getVehicleOdometer).toHaveBeenCalledWith('2026-10')
    expect(screen.getAllByRole('spinbutton', { name: /Start-of-month reading/ })).toHaveLength(1)
    expect(screen.queryByRole('spinbutton', { name: /Start-of-month reading.*36348/ })).not.toBeInTheDocument()
    const closing = screen.getByRole('spinbutton', { name: /end-of-month reading.*58216/ })
    await user.clear(closing)
    await user.type(closing, '1300{Enter}')
    await waitFor(() => expect(api.saveVehicleOdometer).toHaveBeenCalledWith(42, '2026-10', { opening_km: 1000, closing_km: 1300 }))
  })

  it('saves a start-of-month reading on its own', async () => {
    const empty = { ...MONTH.rows[0], opening_km: null, closing_km: null, km_driven: null }
    vi.spyOn(api, 'getVehicleOdometer').mockResolvedValue({ ...MONTH, rows: [empty] })
    const user = userEvent.setup()
    renderPage()
    const opening = await screen.findByRole('spinbutton', { name: /Start-of-month reading.*58216/ })
    await user.type(opening, '5000{Enter}')
    await waitFor(() => expect(api.saveVehicleOdometer).toHaveBeenCalledWith(42, '2026-10', { opening_km: 5000, closing_km: null }))
  })

  it('finds a vehicle by plate number typed in Arabic digits', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Bus')
    await user.type(screen.getByRole('searchbox', { name: 'Search by plate number or type' }), '١٠ ٣٦٣٤٨')
    expect(screen.getByText('Truck')).toBeInTheDocument()
    expect(screen.queryByText('Bus')).not.toBeInTheDocument()
  })

  it('rejects closing below opening without sending it', async () => {
    const user = userEvent.setup()
    renderPage()
    const closing = await screen.findByRole('spinbutton', { name: /end-of-month reading.*58216/ })
    await user.clear(closing)
    await user.type(closing, '900{Enter}')
    expect(api.saveVehicleOdometer).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(i18n.t('vehicles.odometerClosingBelowOpening'))
  })

  it('keeps readings read-only without edit permission', async () => {
    state.editable = false
    renderPage()
    await screen.findByText('Bus')
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Print form' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: i18n.t('vehicles.addMaintenance') })).not.toBeInTheDocument()
  })

  it('stores the month, tab and all-months filter in the URL', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Bus')
    await user.click(screen.getByRole('button', { name: /^Maintenance records/ }))
    await waitFor(() => expect(api.listVehicleMaintenance).toHaveBeenCalledWith('2026-10'))
    await user.click(screen.getByRole('checkbox', { name: 'All months' }))
    await waitFor(() => expect(api.listVehicleMaintenance).toHaveBeenCalledWith(undefined))
    expect(screen.getByText('/vehicles/maintenance?month=2026-10&tab=records&records=all')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByText('November 2026')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Monthly log' }))
    await waitFor(() => expect(api.getVehicleOdometer).toHaveBeenCalledWith('2026-11'))
    expect(screen.getByText('/vehicles/maintenance?month=2026-11&records=all')).toBeInTheDocument()
  })

  it.each(['all', 'selected'])('prints %s vehicles and navigates to the book', async (scope) => {
    const user = userEvent.setup()
    const client = renderPage()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await screen.findByText('Bus')
    await user.click(screen.getByRole('button', { name: 'Print form' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('radio', { name: 'All vehicles' })).toBeChecked()
    if (scope === 'selected') {
      await user.click(dialog.getByRole('radio', { name: 'Selected vehicles' }))
      expect(dialog.getByRole('button', { name: 'Save document' })).toBeDisabled()
      await user.click(dialog.getByRole('checkbox', { name: /58216/ }))
    }
    await user.click(dialog.getByRole('button', { name: 'Save document' }))
    await waitFor(() => expect(api.generateOdometerForm).toHaveBeenCalledWith({ month: '2026-10', vehicle_ids: scope === 'all' ? null : [42] }))
    expect(await screen.findByText('/books/91')).toBeInTheDocument()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
  })

  it.each(['en', 'ar'])('starts a maintenance request before the register, with one garage field (%s)', async (language) => {
    await i18n.changeLanguage(language)
    vi.mocked(api.listVehicles).mockResolvedValue([
      { id: 42, plate_code: '14', plate_number: '58216', type_ar: 'حافلة', type_en: 'Bus' },
    ] as never)
    const created = { id: 7, vehicle_id: 42, date: '2026-10-01', type: 'service', cost: 350, odometer_km: 1200, vendor_ar: null, vendor_en: null, next_due: null, receipt_file_id: null, created_at: '2026-10-01' }
    vi.spyOn(api, 'createVehicleMaintenance').mockResolvedValue(created as never)
    const user = userEvent.setup()
    renderPage()
    const start = screen.getByRole('button', { name: i18n.t('vehicles.addMaintenance') })
    await waitFor(() => expect(start).toBeEnabled())
    const register = screen.getByRole('group', { name: i18n.t('vehicles.maintenanceTitle') })
    expect(start.compareDocumentPosition(register) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(start)
    const dialog = within(screen.getByRole('dialog', { name: i18n.t('vehicles.addMaintenance') }))
    expect(dialog.getByRole('combobox', { name: new RegExp(i18n.t('vehicles.selectedVehicle')) })).toHaveTextContent('58216')
    const garage = dialog.getByLabelText(i18n.t('vehicles.garage'))
    expect(dialog.queryByLabelText(/· (AR|EN)/)).not.toBeInTheDocument()
    expect(await dialog.findByText(i18n.t('vehicles.noPreviousMaintenance'))).toBeInTheDocument()
    await user.type(garage, language === 'ar' ? 'ورشة الصيانة' : 'Fleet garage')
    await user.type(dialog.getByLabelText(new RegExp(i18n.t('vehicles.cost'))), '350')
    await user.click(dialog.getByRole('button', { name: i18n.t('vehicles.save') }))
    await waitFor(() => expect(api.createVehicleMaintenance).toHaveBeenCalledWith(expect.objectContaining({
      vehicle_id: 42, cost: 350,
      vendor_ar: language === 'ar' ? 'ورشة الصيانة' : null,
      vendor_en: language === 'en' ? 'Fleet garage' : null,
    })))
  })

  it('never carries a typed odometer reading over to another vehicle', async () => {
    vi.mocked(api.listVehicles).mockResolvedValue([
      { id: 42, plate_code: '14', plate_number: '58216', type_ar: 'حافلة', type_en: 'Bus' },
      { id: 23, plate_code: '10', plate_number: '36348', type_ar: 'شاحنة', type_en: 'Truck' },
    ] as never)
    vi.mocked(api.getVehicle).mockImplementation(async (id: number) =>
      ({ id, maintenance: [], current_odometer_km: id === 23 ? 3000 : 1200 }) as never,
    )
    const create = vi.spyOn(api, 'createVehicleMaintenance').mockResolvedValue({ id: 8, vehicle_id: 23 } as never)
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <I18nextProvider i18n={i18n}>
          <MaintenanceDialog open onOpenChange={vi.fn()} initialVehicleId={42} />
        </I18nextProvider>
      </QueryClientProvider>,
    )
    const odometer = await screen.findByLabelText(/Odometer \(km\)/)
    await waitFor(() => expect(odometer).toHaveValue(1200))
    await user.clear(odometer)
    await user.type(odometer, '12550')
    await user.click(screen.getByRole('combobox', { name: new RegExp(i18n.t('vehicles.selectedVehicle')) }))
    await user.click(await screen.findByRole('option', { name: /36348/ }))
    await waitFor(() => expect(screen.getByLabelText(/Odometer \(km\)/)).toHaveValue(3000))
    await user.type(screen.getByLabelText(new RegExp(i18n.t('vehicles.cost'))), '350')
    await user.click(screen.getByRole('button', { name: i18n.t('vehicles.save') }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ vehicle_id: 23, odometer_km: 3000 })))
  })

  it('keeps maintenance-request completion linked to the existing request', async () => {
    const create = vi.spyOn(api, 'createVehicleMaintenance').mockResolvedValue({ id: 7, vehicle_id: 42 } as never)
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <I18nextProvider i18n={i18n}>
          <MaintenanceDialog open onOpenChange={vi.fn()} vehicle={{ id: 42, plate_number: '58216' }}
            request={{ id: 91, vehicle_id: 42, type: 'repair', odometer_km: 12550 } as never} />
        </I18nextProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByLabelText(/^Odometer/)).toHaveValue(12550)
    await user.type(screen.getByLabelText(/^Cost/), '350')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      vehicle_id: 42, request_id: 91, type: 'repair', odometer_km: 12550, cost: 350,
    })))
  })
})
