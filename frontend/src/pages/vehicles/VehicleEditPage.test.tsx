import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { VehicleFileRead, VehicleRead, VehicleSiteRead, VehicleUpdate } from '@/lib/api'
import i18n from '@/lib/i18n'

import { VehicleEditPage } from './VehicleEditPage'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    isLoading: false,
    has: (capability: string) =>
      capability === 'vehicles.view' || capability === 'vehicles.edit',
  }),
}))

type ApiModule = { api: typeof api } & Record<string, unknown>

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<ApiModule>()
  return {
    ...mod,
    api: {
      ...mod.api,
      getVehicle: vi.fn(),
      listVehicleSites: vi.fn(),
      updateVehicle: vi.fn(),
      uploadVehicleFile: vi.fn(),
      listVehicles: vi.fn(),
    },
  }
})

const SITES: VehicleSiteRead[] = [
  { id: 1, name_ar: 'مشروع الوثبة', name_en: 'Al Wathba', active: true, vehicle_count: 1 },
]

function baseVehicle(overrides: Partial<VehicleRead> = {}): VehicleRead {
  return {
    id: 101,
    plate_code: '14',
    plate_number: '58216',
    plate_label: '14 \\ 58216',
    traffic_code: '1180021637',
    type_ar: 'تويوتا كوستر',
    type_en: 'Toyota Coaster',
    class_ar: 'باص خفيف',
    class_en: 'Light bus',
    vin: null,
    site_id: 1,
    license_start: '2026-01-01',
    license_expiry: '2027-01-01',
    expiry_status: 'valid',
    days_to_expiry: 100,
    fines_count: 0,
    fines_amount: 0,
    black_points: 0,
    photo_url: null,
    make: null,
    model: null,
    model_year: null,
    colour: null,
    insurance_expiry: null,
    insurance_status: null,
    days_to_insurance_expiry: null,
    archived_at: null,
    contract_note_ar: null,
    contract_note_en: null,
    license_url: null,
    fines: [],
    renewals: [],
    accidents: [],
    maintenance: [],
    photos: [],
    inmate_capacity: null,
    passenger_capacity: null,
    accessories_ar: null,
    accessories_en: null,
    notes_ar: null,
    notes_en: null,
    photo_file_id: null,
    license_file_id: null,
    license_files: [],
    ...overrides,
  } as VehicleRead
}

function renderEditor(vehicleId = 101) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/vehicles/edit/${vehicleId}`]}>
          <Routes>
            <Route path="/vehicles/edit/:id" element={<VehicleEditPage />} />
            <Route path="/vehicles/:id" element={<div>DETAIL PAGE</div>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.listVehicleSites).mockResolvedValue(SITES)
})

describe('VehicleEditPage', () => {
  it('renders an archived vehicle read-only with a link back to its file', async () => {
    vi.mocked(api.getVehicle).mockResolvedValue(
      baseVehicle({ archived_at: '2026-09-07T00:00:00' }),
    )
    renderEditor()

    await screen.findByText('Archived')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to Vehicle Services/ })).toBeInTheDocument()
  })

  it('sends only the changed fields on save', async () => {
    const user = userEvent.setup()
    const vehicle = baseVehicle()
    vi.mocked(api.getVehicle).mockResolvedValue(vehicle)
    vi.mocked(api.updateVehicle).mockResolvedValue({ ...vehicle, make: 'Toyota' })
    renderEditor()

    const makeInput = await screen.findByLabelText('Make')
    await user.type(makeInput, 'Toyota')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.updateVehicle).toHaveBeenCalledTimes(1))
    const [calledId, patch] = vi.mocked(api.updateVehicle).mock.calls[0] as [number, VehicleUpdate]
    expect(calledId).toBe(101)
    expect(patch).toEqual({ make: 'Toyota' })
  })

  it('navigates to the vehicle file after a successful save', async () => {
    const user = userEvent.setup()
    const vehicle = baseVehicle()
    vi.mocked(api.getVehicle).mockResolvedValue(vehicle)
    vi.mocked(api.updateVehicle).mockResolvedValue(vehicle)
    renderEditor()

    await screen.findByLabelText('Make')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('DETAIL PAGE')
  })

  it('confirms before discarding unsaved changes on Cancel', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getVehicle).mockResolvedValue(baseVehicle())
    renderEditor()

    const makeInput = await screen.findByLabelText('Make')
    await user.type(makeInput, 'Toyota')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('DETAIL PAGE')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    await screen.findByText('DETAIL PAGE')
  })

  it('leaves immediately on Cancel with no unsaved changes', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getVehicle).mockResolvedValue(baseVehicle())
    renderEditor()

    await screen.findByLabelText('Make')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await screen.findByText('DETAIL PAGE')
  })

  it('stages multiple gallery files and retries only the failed upload after saving the profile', async () => {
    const user = userEvent.setup()
    const vehicle = baseVehicle()
    const attemptedFiles: string[] = []
    let failedOnce = false
    vi.mocked(api.getVehicle).mockResolvedValue(vehicle)
    vi.mocked(api.updateVehicle).mockResolvedValue({ ...vehicle, make: 'Toyota' })
    vi.mocked(api.uploadVehicleFile).mockImplementation(
      async (_vehicleId, kind, file): Promise<VehicleFileRead> => {
        attemptedFiles.push(file.name)
        if (file.name === 'failed.jpg' && !failedOnce) {
          failedOnce = true
          throw new Error('Upload failed')
        }
        return {
          id: file.name === 'saved.jpg' ? 501 : 502,
          kind,
          label_ar: null,
          label_en: null,
          original_name: file.name,
          media_type: file.type,
          url: `/api/vehicles/101/files/${file.name}`,
        }
      },
    )
    renderEditor()

    const makeInput = await screen.findByLabelText('Make')
    await user.type(makeInput, 'Toyota')
    const galleryInput = screen.getByLabelText('Add photo')
    const savedFile = new File(['saved'], 'saved.jpg', { type: 'image/jpeg' })
    const failedFile = new File(['failed'], 'failed.jpg', { type: 'image/jpeg' })
    await user.upload(galleryInput, [savedFile, failedFile])

    expect(screen.getByText('saved.jpg')).toBeInTheDocument()
    expect(screen.getByText('failed.jpg')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.uploadVehicleFile).toHaveBeenCalledTimes(2))
    expect(api.updateVehicle).toHaveBeenCalledTimes(1)
    expect(api.updateVehicle).toHaveBeenCalledWith(101, { make: 'Toyota' })
    expect(screen.queryByText('saved.jpg')).not.toBeInTheDocument()
    expect(screen.getByText('failed.jpg')).toBeInTheDocument()
    expect(screen.queryByText('DETAIL PAGE')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('DETAIL PAGE')
    expect(api.updateVehicle).toHaveBeenCalledTimes(1)
    expect(api.uploadVehicleFile).toHaveBeenCalledTimes(3)
    expect(attemptedFiles).toEqual(['saved.jpg', 'failed.jpg', 'failed.jpg'])
  })

  it('confirms before leaving when a gallery file is staged', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getVehicle).mockResolvedValue(baseVehicle())
    renderEditor()

    await screen.findByLabelText('Make')
    const galleryInput = screen.getByLabelText('Add photo')
    await user.upload(
      galleryInput,
      new File(['pending'], 'pending.jpg', { type: 'image/jpeg' }),
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('DETAIL PAGE')).not.toBeInTheDocument()
  })
})
