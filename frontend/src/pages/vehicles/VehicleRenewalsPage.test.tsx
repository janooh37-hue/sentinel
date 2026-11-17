import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { VehicleListItem, VehicleRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { VehicleRenewalsPage } from './VehicleRenewalsPage'

const state = vi.hoisted(() => ({ edit: true, mobile: false }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => cap === 'vehicles.view' || (cap === 'vehicles.edit' && state.edit), isLoading: false }) }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
type ApiModule = { api: typeof api } & Record<string, unknown>
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<ApiModule>()
  return { ...original, api: { ...original.api, listVehicles: vi.fn(), listVehicleSites: vi.fn(), vehiclesSummary: vi.fn(), getVehicle: vi.fn(), renewVehicleLicense: vi.fn(), uploadVehicleFile: vi.fn() } }
})

const valid: VehicleListItem = {
  id: 1, plate_code: '14', plate_number: '12345', plate_label: '14 \\ 12345', traffic_code: '111',
  type_ar: 'حافلة', type_en: 'Bus', class_ar: 'خفيف', class_en: 'Light', vin: null, site_id: 1,
  license_start: '2026-01-01', license_expiry: '2027-01-01', expiry_status: 'valid', days_to_expiry: 100,
  fines_count: 0, fines_amount_fils: 0, black_points: 0,
}
const expired: VehicleListItem = { ...valid, id: 2, plate_number: '54321', plate_label: '14 \\ 54321', license_start: '2025-01-01', license_expiry: '2026-01-01', expiry_status: 'expired', days_to_expiry: -100 }
function detail(vehicle: VehicleListItem): VehicleRead {
  return { ...vehicle, current_odometer_km: 1000, contract_note_ar: null, contract_note_en: null, license_url: null,
    fines: [], renewals: [], accidents: [], maintenance: [], photos: [], inmate_capacity: null, passenger_capacity: null,
    accessories_ar: null, accessories_en: null, notes_ar: null, notes_en: null, license_file_id: null }
}
function renderPage(path = '/vehicles/renewals') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[path]}><VehicleRenewalsPage /></MemoryRouter></I18nextProvider>
  </QueryClientProvider>)
}

beforeEach(async () => {
  vi.clearAllMocks()
  state.edit = true
  state.mobile = false
  await i18n.changeLanguage('en')
  vi.mocked(api.listVehicles).mockResolvedValue([valid, expired])
  vi.mocked(api.listVehicleSites).mockResolvedValue([{ id: 1, name_ar: 'الموقع', name_en: 'Site', active: true, vehicle_count: 2 }])
  vi.mocked(api.vehiclesSummary).mockResolvedValue({ vehicles: 2, fines_count: 0, fines_amount_fils: 0, black_points: 0, license_attention: 1, insurance_attention: 0, open_accidents: 0, maintenance_due: 0, active_sites: 1, notify_days: 30 })
  vi.mocked(api.getVehicle).mockImplementation(async (id) => detail(id === 2 ? expired : valid))
  vi.mocked(api.renewVehicleLicense).mockResolvedValue(detail(expired))
})

describe('VehicleRenewalsPage', () => {
  it.each([false, true])('starts with licences needing renewal and opens their vehicle file (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    renderPage()
    const open = await screen.findByRole('link', { name: /Open · 14.*54321/ })
    expect(open).toHaveAttribute('href', '/vehicles/2?tab=renewals')
    expect(screen.queryByRole('link', { name: /Open · 14.*12345/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Needs renewal/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('30')).toBeInTheDocument()
  })

  it('restores the register filter from the URL', async () => {
    renderPage('/vehicles/renewals?status=valid')
    expect(await screen.findByRole('link', { name: /Open · 14.*12345/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open · 14.*54321/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Valid/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides filing controls and rejects a request URL without edit capability', async () => {
    state.edit = false
    renderPage('/vehicles/renewals?action=renew&vehicle=2')
    await screen.findByRole('link', { name: /Open · 14.*54321/ })
    expect(screen.queryByRole('button', { name: /^Renew/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('starts the counter on the earliest expiry and updates the dates and history when the picker changes', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('link', { name: /Open · 14.*54321/ })
    await user.click(screen.getByRole('button', { name: 'Renew' }))
    const dialog = await screen.findByRole('dialog', { name: 'Renew vehicle license' })
    expect(within(dialog).getByLabelText(/^New start date/)).toHaveValue('2026-01-02')
    expect(within(dialog).getByLabelText(/^New expiry date/)).toHaveValue('2027-01-01')
    expect(await within(dialog).findByText('No previous renewals')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('combobox', { name: /Vehicle/ }))
    await user.click(await screen.findByRole('option', { name: /12345/ }))
    await waitFor(() => expect(within(dialog).getByLabelText(/^New start date/)).toHaveValue('2027-01-02'))
    expect(within(dialog).getByLabelText(/^New expiry date/)).toHaveValue('2028-01-01')
  })

  it('starts a deep-linked renewal on the vehicle the link names', async () => {
    renderPage('/vehicles/renewals?action=renew&vehicle=1')
    const dialog = await screen.findByRole('dialog', { name: 'Renew vehicle license' })
    // Vehicle 1 is not the most urgent one; the link still wins once the fleet loads.
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: /Vehicle/ })).toHaveTextContent('12345'))
    await waitFor(() => expect(within(dialog).getByLabelText(/^New start date/)).toHaveValue('2027-01-02'))
  })

  it('fixes the row vehicle and preserves an operator-edited expiry', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Renew · 14.*54321/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Renew vehicle license' })
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    const start = within(dialog).getByLabelText(/^New start date/)
    const expiry = within(dialog).getByLabelText(/^New expiry date/)
    await user.clear(expiry)
    await user.type(expiry, '2028-06-30')
    await user.clear(start)
    await user.type(start, '2026-06-01')
    expect(expiry).toHaveValue('2028-06-30')
    await user.click(within(dialog).getByRole('button', { name: 'Renew' }))
    await waitFor(() => expect(api.renewVehicleLicense).toHaveBeenCalledWith(2, { start: '2026-06-01', expiry: '2028-06-30', cost: 1450, scan_file_id: null }))
  })

  it('keeps reminder digits Latin in Arabic', async () => {
    await i18n.changeLanguage('ar')
    renderPage()
    expect(await screen.findByText('30')).toBeInTheDocument()
    expect(screen.queryByText('٣٠')).not.toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /54321/ })).toHaveAttribute('href', '/vehicles/2?tab=renewals')
  })
})
