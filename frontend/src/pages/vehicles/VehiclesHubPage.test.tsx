import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { copyTable } from '@/lib/copyTable'
import { api } from '@/lib/api'
import type { VehicleListItem, VehicleSiteRead, VehiclesSummary } from '@/lib/api'
import i18n from '@/lib/i18n'

import { buildVehicleTable, vehicleTableClipboard } from './vehicleTable'
import { VehiclesHubPage } from './VehiclesHubPage'

const mobileViewport = vi.hoisted(() => ({ value: false }))
const outputState = vi.hoisted(() => ({
  print: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/useIsMobile', () => ({
  useIsMobile: () => mobileViewport.value,
}))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    isLoading: false,
    has: (capability: string) =>
      capability === 'vehicles.view' ||
      capability === 'vehicles.edit' ||
      capability === 'vehicles.delete',
  }),
}))

vi.mock('@/lib/copyTable', () => ({
  copyTable: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: outputState.toastSuccess,
    error: outputState.toastError,
  },
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
      archiveVehicle: vi.fn(),
      restoreVehicle: vi.fn(),
    },
  }
})

const SUMMARY: VehiclesSummary = {
  vehicles: 3,
  fines_count: 7,
  fines_amount: 3400,
  black_points: 11,
  license_attention: 2,
  insurance_attention: 0,
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

function liveView(): HTMLElement {
  const view = document.querySelector<HTMLElement>('[data-print-hide]')
  if (!view) throw new Error('Live vehicle hub not found')
  return view
}

function vehicleRowCheckbox(plate: string): HTMLInputElement {
  const row = within(liveView()).getByText(plate).closest('tr')
  if (!row) throw new Error(`Vehicle row not found for ${plate}`)
  return within(row).getByRole('checkbox')
}

beforeEach(async () => {
  vi.clearAllMocks()
  mobileViewport.value = false
  outputState.print.mockReset()
  Object.defineProperty(window, 'print', {
    configurable: true,
    value: outputState.print,
  })
  outputState.print.mockImplementation(() => {
    window.dispatchEvent(new Event('beforeprint'))
  })
  await i18n.changeLanguage('en')
  vi.mocked(copyTable).mockResolvedValue()
  vi.mocked(api.vehiclesSummary).mockResolvedValue(SUMMARY)
  vi.mocked(api.listVehicleSites).mockResolvedValue(SITES)
  vi.mocked(api.listVehicles).mockImplementation(async (params = {}) =>
    VEHICLES.filter((vehicle) => {
      const wantArchived = params.state === 'archived'
      if (Boolean(vehicle.archived_at) !== wantArchived) return false
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
  vi.mocked(api.archiveVehicle).mockResolvedValue({ ...VEHICLES[0], archived_at: '2026-09-07T00:00:00' } as never)
  vi.mocked(api.restoreVehicle).mockResolvedValue({ ...VEHICLES[0], archived_at: null } as never)
})

describe('VehiclesHubPage', () => {
  it('renders metric service cards and keeps import as a count-free secondary action', async () => {
    renderPage()

    await screen.findByRole('heading', { name: 'Vehicle Services' })

    const fines = screen.getByRole('link', { name: /Fines/ })
    await waitFor(() => expect(fines).toHaveTextContent(/7\s*·\s*3,400 AED/))

    const renew = screen.getByRole('button', { name: /Renew License/ })
    const accidents = screen.getByRole('link', { name: /Accident Report/ })
    const maintenance = screen.getByRole('link', { name: /Maintenance/ })
    const editVehicle = screen.getByRole('link', { name: /Edit Vehicle/ })
    const addVehicle = screen.getByRole('button', { name: /Add Vehicle/ })
    const sites = screen.getByRole('button', { name: /Sites/ })
    expect(within(renew).getByText('2')).toBeInTheDocument()
    expect(within(accidents).getByText('1')).toBeInTheDocument()
    expect(within(maintenance).getByText('2')).toBeInTheDocument()
    expect(within(editVehicle).getByText('3')).toBeInTheDocument()
    expect(within(addVehicle).getByText('3')).toBeInTheDocument()
    expect(within(sites).getByText('2')).toBeInTheDocument()
    const importAction = screen.getByRole('link', { name: 'Fleet Import' })
    expect(importAction).toHaveAttribute('href', '/vehicles/import')
    expect(importAction).not.toHaveTextContent('3')
    expect(importAction.closest('div')).toHaveTextContent(
      'Bulk-create or update vehicles from an XLSX spreadsheet',
    )
  })

  it('renders shared service artwork without legacy inline icons', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Vehicle Services' })

    expect(container.querySelectorAll('img[src*="service-icons"]').length).toBe(7)
    expect(container.querySelector('svg[viewBox="0 0 64 64"]')).toBeNull()
  })

  it('filters the grouped fleet ledger with a site chip', async () => {
    const user = userEvent.setup()
    renderPage()

    await within(liveView()).findByText('14 \\ 58216')
    expect(within(liveView()).getByText('10 \\ 36348')).toBeInTheDocument()
    expect(within(liveView()).getByText('21 \\ 13695')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Al Wathba' }))

    await waitFor(() =>
      expect(within(liveView()).queryByText('21 \\ 13695')).not.toBeInTheDocument(),
    )
    expect(within(liveView()).getByText('14 \\ 58216')).toBeInTheDocument()
    expect(within(liveView()).getByText('10 \\ 36348')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mussafah' })).not.toBeInTheDocument()
  })

  it('shows only due and expired vehicles for the attention expiry filter', async () => {
    const user = userEvent.setup()
    renderPage()

    await within(liveView()).findByText('10 \\ 36348')
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'License expiry' }),
      'attention',
    )

    await waitFor(() =>
      expect(within(liveView()).queryByText('10 \\ 36348')).not.toBeInTheDocument(),
    )
    expect(within(liveView()).getByText('14 \\ 58216')).toBeInTheDocument()
    expect(within(liveView()).getByText('21 \\ 13695')).toBeInTheDocument()
  })

  it('disables copy with no selection and copies only the selected vehicles once selected', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()

    await within(liveView()).findByText('14 \\ 58216')
    const copyButton = screen.getByRole('button', { name: 'Copy table' })
    expect(copyButton).toBeDisabled()

    await user.click(vehicleRowCheckbox('14 \\ 58216'))
    await waitFor(() => expect(copyButton).toBeEnabled())
    await user.click(copyButton)

    await waitFor(() =>
      expect(copyTable).toHaveBeenLastCalledWith(
        vehicleTableClipboard(buildVehicleTable([VEHICLES[0]], 'en', i18n.t)),
      ),
    )
    await waitFor(() =>
      expect(outputState.toastSuccess).toHaveBeenCalledWith(
        'Table copied to the clipboard.',
      ),
    )
    expect(outputState.toastError).not.toHaveBeenCalled()
    expect(container.querySelector('.print-vehicle-list')).not.toBeInTheDocument()
  })

  it('reports a localized clipboard failure and keeps the current selection', async () => {
    const user = userEvent.setup()
    vi.mocked(copyTable).mockRejectedValueOnce(new Error('COPY_FAILED'))
    renderPage()

    const selected = await screen.findByRole('checkbox', { name: 'Select 10 \\ 36348' })
    await user.click(selected)
    const copyButton = screen.getByRole('button', { name: 'Copy table' })
    await user.click(copyButton)

    await waitFor(() =>
      expect(outputState.toastError).toHaveBeenCalledWith(
        'Could not copy to clipboard. Try again.',
      ),
    )
    expect(outputState.toastSuccess).not.toHaveBeenCalled()
    expect(selected).toBeChecked()
    expect(copyButton).toBeEnabled()
  })

  it('reports a localized print failure when print returns without starting', async () => {
    const user = userEvent.setup()
    outputState.print.mockImplementation(() => undefined)
    renderPage()

    await screen.findByRole('checkbox', { name: 'Select 14 \\ 58216' })
    const printButton = screen.getByRole('button', { name: 'Print' })
    await user.click(printButton)

    await waitFor(() =>
      expect(outputState.toastError).toHaveBeenCalledWith(
        'Could not open the print dialog. Try again.',
      ),
    )
    expect(outputState.print).toHaveBeenCalledTimes(1)
    expect(printButton).toBeEnabled()
    expect(document.querySelector('.print-vehicle-list')).not.toBeInTheDocument()
    expect(outputState.toastSuccess).not.toHaveBeenCalled()
  })

  it('reports a localized print failure and releases the transient print state', async () => {
    const user = userEvent.setup()
    let printViewMounted = false
    let printWasDisabled = false
    outputState.print.mockImplementation(() => {
      printViewMounted = document.querySelector('.print-vehicle-list') != null
      printWasDisabled = screen.getByRole('button', { name: 'Print' }).hasAttribute('disabled')
      throw new Error('Print unavailable')
    })
    renderPage()

    const selected = await screen.findByRole('checkbox', { name: 'Select 14 \\ 58216' })
    await user.click(selected)
    const printButton = screen.getByRole('button', { name: 'Print' })
    await user.click(printButton)

    await waitFor(() =>
      expect(outputState.toastError).toHaveBeenCalledWith(
        'Could not open the print dialog. Try again.',
      ),
    )
    expect(printViewMounted).toBe(true)
    expect(printWasDisabled).toBe(true)
    expect(printButton).toBeEnabled()
    expect(document.querySelector('.print-vehicle-list')).not.toBeInTheDocument()
    expect(outputState.toastSuccess).not.toHaveBeenCalled()
    expect(selected).toBeChecked()
  })

  it('clears a selected vehicle when the expiry filter changes', async () => {
    const user = userEvent.setup()
    renderPage()

    await within(liveView()).findByText('14 \\ 58216')
    await user.click(vehicleRowCheckbox('14 \\ 58216'))
    expect(vehicleRowCheckbox('14 \\ 58216')).toBeChecked()

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'License expiry' }),
      'attention',
    )

    await waitFor(() => expect(vehicleRowCheckbox('14 \\ 58216')).not.toBeChecked())
  })

  it('keeps selection across language and responsive layout changes', async () => {
    const user = userEvent.setup()
    renderPage()

    await within(liveView()).findByText('14 \\ 58216')
    await user.click(vehicleRowCheckbox('14 \\ 58216'))

    mobileViewport.value = true
    await i18n.changeLanguage('ar')
    try {
      const card = within(liveView()).getByText('14 \\ 58216').closest('article')
      if (!card) throw new Error('Mobile vehicle card not found')
      await waitFor(() => expect(within(card).getByRole('checkbox')).toBeChecked())
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('disables print and copy while loading, erroring, or resolving a search filter', async () => {
    let resolveRows!: (rows: VehicleListItem[]) => void
    vi.mocked(api.listVehicles).mockReturnValueOnce(
      new Promise<VehicleListItem[]>((resolve) => {
        resolveRows = resolve
      }),
    )
    const first = renderPage()

    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Copy table' })).toBeDisabled()

    resolveRows(VEHICLES)
    const selected = await screen.findByRole('checkbox', { name: 'Select 14 \\ 58216' })
    await userEvent.click(selected)
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Search plate, type, or traffic code' }),
      'Toyota',
    )
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Copy table' })).toBeDisabled()

    first.unmount()
    vi.mocked(api.listVehicles).mockRejectedValueOnce(new Error('offline'))
    renderPage()
    await screen.findByText("Couldn't load this. Check your connection and try again.")
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Copy table' })).toBeDisabled()
  })

  it('renders the fleet ledger heading in Arabic', async () => {
    await i18n.changeLanguage('ar')
    try {
      renderPage()
      expect(
        await within(liveView()).findByRole('heading', { name: 'سجل المركبات' }),
      ).toBeInTheDocument()
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('shows "Not recorded" for a vehicle with no insurance date', async () => {
    renderPage()

    await within(liveView()).findByText('14 \\ 58216')
    expect(screen.getAllByText(/Not recorded/).length).toBeGreaterThan(0)
  })

  it('switches the ledger to archived vehicles and offers Restore instead of Archive', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listVehicles).mockImplementation(async (params = {}) => {
      if (params.state === 'archived') {
        return [{ ...VEHICLES[0], id: 104, archived_at: '2026-09-07T00:00:00' }]
      }
      return VEHICLES
    })
    renderPage()

    await within(liveView()).findByText('14 \\ 58216')
    await user.selectOptions(screen.getByRole('combobox', { name: 'State' }), 'archived')

    await waitFor(async () => expect((await screen.findAllByText('Archived')).length).toBeGreaterThan(1))
    expect(screen.getAllByRole('button', { name: /Restore vehicle/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Archive vehicle/ })).not.toBeInTheDocument()
  })

  it('archives a vehicle after confirming, then refetches the ledger', async () => {
    const user = userEvent.setup()
    renderPage()

    await within(liveView()).findByText('14 \\ 58216')
    const [archiveButton] = screen.getAllByRole('button', { name: /Archive vehicle/ })
    await user.click(archiveButton)

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Archive vehicle' }))

    await waitFor(() => expect(api.archiveVehicle).toHaveBeenCalledWith(101))
  })
})
