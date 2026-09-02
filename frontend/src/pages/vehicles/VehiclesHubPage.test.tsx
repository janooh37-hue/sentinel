import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { VehicleListItem, VehicleSiteRead, VehiclesSummary } from '@/lib/api'
import i18n from '@/lib/i18n'

import { VehiclesHubPage } from './VehiclesHubPage'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    isLoading: false,
    has: (capability: string) =>
      capability === 'vehicles.view' ||
      capability === 'vehicles.edit' ||
      capability === 'vehicles.delete',
  }),
}))

type ApiModule = { api: typeof api } & Record<string, unknown>

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<ApiModule>()
  return {
    ...mod,
    api: {
      ...mod.api,
      vehiclesSummary: vi.fn(),
      listVehicleSites: vi.fn(),
      listVehicles: vi.fn(),
      setVehicleNotifyDays: vi.fn(),
    },
  }
})

const SUMMARY: VehiclesSummary = {
  vehicles: 3,
  fines_count: 7,
  fines_amount: 3400,
  black_points: 11,
  license_attention: 2,
  open_accidents: 1,
  maintenance_due: 2,
  active_sites: 2,
  notify_days: 30,
}

const SITES: VehicleSiteRead[] = [
  {
    id: 1,
    name_ar: 'مشروع الوثبة',
    name_en: 'Al Wathba',
    active: true,
    vehicle_count: 2,
  },
  {
    id: 2,
    name_ar: 'مشروع مصفح',
    name_en: 'Mussafah',
    active: true,
    vehicle_count: 1,
  },
]

const VEHICLES: VehicleListItem[] = [
  {
    id: 101,
    plate_code: '14',
    plate_number: '58216',
    plate_label: '14 \\ 58216',
    traffic_code: '1180021637',
    type_ar: 'تويوتا كوستر',
    type_en: 'Toyota Coaster',
    class_ar: 'باص خفيف',
    class_en: 'Light bus',
    vin: 'JT123456789000101',
    site_id: 1,
    license_start: '2026-01-01',
    license_expiry: '2026-09-20',
    expiry_status: 'due',
    days_to_expiry: 18,
    fines_count: 3,
    fines_amount: 1250,
    black_points: 4,
    photo_url: '/api/v1/vehicles/101/files/1',
  },
  {
    id: 102,
    plate_code: '10',
    plate_number: '36348',
    plate_label: '10 \\ 36348',
    traffic_code: '1180021637',
    type_ar: 'نيسان باترول',
    type_en: 'Nissan Patrol',
    class_ar: 'مركبة خفيفة',
    class_en: 'Light vehicle',
    vin: 'JN123456789000102',
    site_id: 1,
    license_start: '2026-07-01',
    license_expiry: '2027-06-30',
    expiry_status: 'valid',
    days_to_expiry: 301,
    fines_count: 1,
    fines_amount: 300,
    black_points: 0,
    photo_url: null,
  },
  {
    id: 103,
    plate_code: '21',
    plate_number: '13695',
    plate_label: '21 \\ 13695',
    traffic_code: '1180099942',
    type_ar: 'ميتسوبيشي بيك أب',
    type_en: 'Mitsubishi Pickup',
    class_ar: 'بيك أب',
    class_en: 'Pickup',
    vin: null,
    site_id: 2,
    license_start: '2025-08-01',
    license_expiry: '2026-08-31',
    expiry_status: 'expired',
    days_to_expiry: -2,
    fines_count: 3,
    fines_amount: 1850,
    black_points: 7,
    photo_url: null,
  },
]

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/vehicles']}>
          <VehiclesHubPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.vehiclesSummary).mockResolvedValue(SUMMARY)
  vi.mocked(api.listVehicleSites).mockResolvedValue(SITES)
  vi.mocked(api.listVehicles).mockImplementation(async (params = {}) =>
    VEHICLES.filter((vehicle) => {
      if (params.site_id != null && vehicle.site_id !== params.site_id) return false
      if (params.expiry === 'attention' && vehicle.expiry_status === 'valid') return false
      if (
        params.expiry != null &&
        params.expiry !== 'all' &&
        params.expiry !== 'attention' &&
        vehicle.expiry_status !== params.expiry
      ) {
        return false
      }
      return true
    }),
  )
  vi.mocked(api.setVehicleNotifyDays).mockResolvedValue(SUMMARY)
})

describe('VehiclesHubPage', () => {
  it('renders all six service cards with their live summary counts', async () => {
    renderPage()

    await screen.findByRole('heading', { name: 'Vehicle Services' })

    const fines = screen.getByRole('link', { name: /Fines/ })
    await waitFor(() => expect(fines).toHaveTextContent(/7\s*·\s*3,400 AED/))

    const renew = screen.getByRole('button', { name: /Renew License/ })
    const accidents = screen.getByRole('link', { name: /Accident Report/ })
    const maintenance = screen.getByRole('link', { name: /Maintenance/ })
    const addVehicle = screen.getByRole('button', { name: /Add Vehicle/ })
    const sites = screen.getByRole('button', { name: /Sites/ })
    expect(within(renew).getByText('2')).toBeInTheDocument()
    expect(within(accidents).getByText('1')).toBeInTheDocument()
    expect(within(maintenance).getByText('2')).toBeInTheDocument()
    expect(within(addVehicle).getByText('3')).toBeInTheDocument()
    expect(within(sites).getByText('2')).toBeInTheDocument()
  })

  it('renders shared service artwork without legacy inline icons', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Vehicle Services' })

    expect(container.querySelectorAll('img[src*="service-icons"]').length).toBe(6)
    expect(container.querySelector('svg[viewBox="0 0 64 64"]')).toBeNull()
  })

  it('filters the grouped fleet ledger with a site chip', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('14 \\ 58216')
    expect(screen.getByText('10 \\ 36348')).toBeInTheDocument()
    expect(screen.getByText('21 \\ 13695')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Al Wathba' }))

    await waitFor(() => expect(screen.queryByText('21 \\ 13695')).not.toBeInTheDocument())
    expect(screen.getByText('14 \\ 58216')).toBeInTheDocument()
    expect(screen.getByText('10 \\ 36348')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mussafah' })).not.toBeInTheDocument()
  })

  it('shows only due and expired vehicles for the attention expiry filter', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('10 \\ 36348')
    await user.selectOptions(screen.getByRole('combobox'), 'attention')

    await waitFor(() => expect(screen.queryByText('10 \\ 36348')).not.toBeInTheDocument())
    expect(screen.getByText('14 \\ 58216')).toBeInTheDocument()
    expect(screen.getByText('21 \\ 13695')).toBeInTheDocument()
  })

  it('renders the fleet ledger heading in Arabic', async () => {
    await i18n.changeLanguage('ar')
    try {
      renderPage()
      expect(await screen.findByRole('heading', { name: 'سجل المركبات' })).toBeInTheDocument()
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
