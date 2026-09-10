import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/lib/api'
import type { VehicleFileRead, VehicleRead, VehicleSiteRead, VehicleUpdate } from '@/lib/api'
import i18n from '@/lib/i18n'

import { VehicleEditPage } from './VehicleEditPage'
import { VEHICLE_QUERY_KEYS } from './vehicleUtils'

const testState = { canDeleteFiles: true }

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    isLoading: false,
    has: (capability: string) =>
      capability === 'vehicles.view' ||
      capability === 'vehicles.edit' ||
      (capability === 'vehicles.delete' && testState.canDeleteFiles),
  }),
}))

type ApiModule = { api: typeof api } & Record<string, unknown>

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<ApiModule>()
  return {
    ...mod,
    api: {
      ...mod.api,
      createVehicle: vi.fn(),
      getVehicle: vi.fn(),
      listVehicleSites: vi.fn(),
      updateVehicle: vi.fn(),
      uploadVehicleFile: vi.fn(),
      deleteVehicleFile: vi.fn(),
      listVehicles: vi.fn(),
    },
  }
})

const SITES: VehicleSiteRead[] = [
  { id: 1, name_ar: 'مشروع الوثبة', name_en: 'Al Wathba', active: true, vehicle_count: 1 },
]

function vehicleFile(
  id: number,
  kind: VehicleFileRead['kind'],
  name: string,
): VehicleFileRead {
  return {
    id,
    kind,
    label_ar: null,
    label_en: null,
    original_name: name,
    media_type: 'image/jpeg',
    url: `/api/v1/vehicles/101/files/${id}`,
  }
}

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
  const result = render(
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
  return { ...result, client }
}

beforeEach(async () => {
  vi.resetAllMocks()
  testState.canDeleteFiles = true
  URL.createObjectURL = vi.fn(
    (file: Blob) => `blob:${(file as File).name}`,
  ) as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
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
    const galleryInput = screen.getByLabelText('Upload gallery photos')
    const savedFile = new File(['saved'], 'saved.jpg', { type: 'image/jpeg' })
    const failedFile = new File(['failed'], 'failed.jpg', { type: 'image/jpeg' })
    await user.upload(galleryInput, [savedFile, failedFile])

    expect(screen.getByText('saved.jpg')).toBeInTheDocument()
    expect(screen.getByText('failed.jpg')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.uploadVehicleFile).toHaveBeenCalledTimes(2))
    expect(api.updateVehicle).toHaveBeenCalledTimes(1)
    expect(api.updateVehicle).toHaveBeenCalledWith(101, { make: 'Toyota' })
    expect(screen.queryByAltText(/Preview of .*saved\.jpg/)).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'saved.jpg' })).toBeInTheDocument()
    expect(screen.getByText('failed.jpg')).toBeInTheDocument()
    expect(screen.queryByText('DETAIL PAGE')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('DETAIL PAGE')
    expect(api.updateVehicle).toHaveBeenCalledTimes(1)
    expect(api.uploadVehicleFile).toHaveBeenCalledTimes(3)
    expect(attemptedFiles).toEqual(['saved.jpg', 'failed.jpg', 'failed.jpg'])
  })

  it('invalidates landed writes and retries only a failed licence attachment', async () => {
    const user = userEvent.setup()
    const vehicle = baseVehicle()
    const replacement = new File(['replacement'], 'replacement-license.pdf', {
      type: 'application/pdf',
    })
    const uploaded: VehicleFileRead = {
      id: 601,
      kind: 'license',
      label_ar: null,
      label_en: null,
      original_name: replacement.name,
      media_type: replacement.type,
      url: '/api/vehicles/101/files/601',
    }
    const updatedVehicle = { ...vehicle, type_en: 'Toyota Hiace' }
    vi.mocked(api.getVehicle).mockResolvedValue(vehicle)
    vi.mocked(api.uploadVehicleFile).mockResolvedValue(uploaded)
    vi.mocked(api.updateVehicle)
      .mockResolvedValueOnce(updatedVehicle)
      .mockRejectedValueOnce(new Error('Attachment interrupted'))
      .mockResolvedValueOnce({
        ...updatedVehicle,
        license_file_id: uploaded.id,
        license_url: uploaded.url,
        license_files: [uploaded],
      })
    const { client } = renderEditor()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const uploadZone = await screen.findByRole('button', {
      name: 'Upload new license scan',
    })
    const uploadInput = uploadZone.querySelector('input[type="file"]')
    expect(uploadInput).not.toBeNull()
    await user.upload(uploadInput as HTMLInputElement, replacement)
    expect(api.uploadVehicleFile).not.toHaveBeenCalled()
    expect(api.updateVehicle).not.toHaveBeenCalled()
    const typeInput = screen.getByRole('textbox', { name: /Vehicle type in English/ })
    await user.clear(typeInput)
    await user.type(typeInput, 'Toyota Hiace')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Profile saved;.*1 file failed/,
    )
    expect(screen.getByText(replacement.name)).toBeInTheDocument()
    expect(screen.queryByText('DETAIL PAGE')).not.toBeInTheDocument()
    expect(api.updateVehicle).toHaveBeenCalledTimes(2)
    expect(api.updateVehicle).toHaveBeenNthCalledWith(1, 101, {
      type_en: 'Toyota Hiace',
    })
    expect(api.updateVehicle).toHaveBeenNthCalledWith(2, 101, {
      license_file_id: uploaded.id,
    })
    expect(api.uploadVehicleFile).toHaveBeenCalledTimes(1)
    expect(api.uploadVehicleFile).toHaveBeenCalledWith(
      101,
      'license',
      replacement,
    )
    expect(api.createVehicle).not.toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledTimes(10)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: VEHICLE_QUERY_KEYS.summary })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: VEHICLE_QUERY_KEYS.list })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: VEHICLE_QUERY_KEYS.detail(101),
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: VEHICLE_QUERY_KEYS.sites })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: VEHICLE_QUERY_KEYS.fines })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: VEHICLE_QUERY_KEYS.accidents })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: VEHICLE_QUERY_KEYS.maintenance,
    })

    invalidate.mockClear()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('DETAIL PAGE')
    expect(api.updateVehicle).toHaveBeenCalledTimes(3)
    expect(api.updateVehicle).toHaveBeenNthCalledWith(3, 101, {
      license_file_id: uploaded.id,
    })
    expect(api.uploadVehicleFile).toHaveBeenCalledTimes(1)
    expect(api.createVehicle).not.toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledTimes(3)
    expect(invalidate).toHaveBeenNthCalledWith(1, {
      queryKey: VEHICLE_QUERY_KEYS.summary,
    })
    expect(invalidate).toHaveBeenNthCalledWith(2, {
      queryKey: VEHICLE_QUERY_KEYS.list,
    })
    expect(invalidate).toHaveBeenNthCalledWith(3, {
      queryKey: VEHICLE_QUERY_KEYS.detail(101),
    })
  })

  it('confirms before leaving when a gallery file is staged', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getVehicle).mockResolvedValue(baseVehicle())
    renderEditor()

    await screen.findByLabelText('Make')
    const galleryInput = screen.getByLabelText('Upload gallery photos')
    await user.upload(
      galleryInput,
      new File(['pending'], 'pending.jpg', { type: 'image/jpeg' }),
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('DETAIL PAGE')).not.toBeInTheDocument()
  })

  it('previews each pending gallery file and revokes its object URL on removal and unmount', async () => {
    const user = userEvent.setup()
    vi.mocked(URL.createObjectURL).mockImplementation(
      (file) => `blob:${(file as File).name}`,
    )
    vi.mocked(api.getVehicle).mockResolvedValue(baseVehicle())
    const first = new File(['first'], 'first.jpg', { type: 'image/jpeg' })
    const second = new File(['second'], 'second.jpg', { type: 'image/jpeg' })
    const { unmount } = renderEditor()

    await user.upload(await screen.findByLabelText('Upload gallery photos'), [first, second])

    expect(screen.getByAltText(/first\.jpg/)).toHaveAttribute('src', 'blob:first.jpg')
    expect(screen.getByAltText(/second\.jpg/)).toHaveAttribute('src', 'blob:second.jpg')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: /Remove .*first\.jpg/ }))

    expect(screen.queryByAltText(/first\.jpg/)).not.toBeInTheDocument()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first.jpg')

    unmount()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second.jpg')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('saves only the chosen existing gallery photo pointer', async () => {
    const user = userEvent.setup()
    const gallery = vehicleFile(3, 'gallery', 'gallery.jpg')
    const vehicle = baseVehicle({
      photo_file_id: 1,
      photo_url: '/api/v1/vehicles/101/files/1',
      photos: [gallery],
    })
    vi.mocked(api.getVehicle).mockResolvedValue(vehicle)
    vi.mocked(api.updateVehicle).mockResolvedValue({
      ...vehicle,
      photo_file_id: gallery.id,
      photo_url: gallery.url,
    })
    renderEditor()

    await user.click(
      await screen.findByRole('button', { name: /Use .*gallery\.jpg.* as main photo/ }),
    )

    expect(api.updateVehicle).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(api.updateVehicle).toHaveBeenCalledWith(101, { photo_file_id: gallery.id }),
    )
    expect(api.updateVehicle).toHaveBeenCalledTimes(1)
  })

  it('retries only a failed main-photo pointer after the scalar profile has landed', async () => {
    const user = userEvent.setup()
    const gallery = vehicleFile(3, 'gallery', 'gallery.jpg')
    const vehicle = baseVehicle({ photos: [gallery] })
    const scalarSaved = { ...vehicle, make: 'Toyota' }
    vi.mocked(api.getVehicle).mockResolvedValue(vehicle)
    vi.mocked(api.updateVehicle)
      .mockResolvedValueOnce(scalarSaved)
      .mockRejectedValueOnce(new Error('Pointer update interrupted'))
      .mockResolvedValueOnce({
        ...scalarSaved,
        photo_file_id: gallery.id,
        photo_url: gallery.url,
      })
    renderEditor()

    await user.type(await screen.findByLabelText('Make'), 'Toyota')
    await user.click(screen.getByRole('button', { name: /Use .*gallery\.jpg.* as main photo/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Profile saved;.*1 file failed/)
    expect(api.updateVehicle).toHaveBeenNthCalledWith(1, 101, { make: 'Toyota' })
    expect(api.updateVehicle).toHaveBeenNthCalledWith(2, 101, { photo_file_id: gallery.id })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('DETAIL PAGE')
    expect(api.updateVehicle).toHaveBeenCalledTimes(3)
    expect(api.updateVehicle).toHaveBeenNthCalledWith(3, 101, { photo_file_id: gallery.id })
  })

  it('saves an explicit null main-photo pointer without deleting the file', async () => {
    const user = userEvent.setup()
    const vehicle = baseVehicle({
      photo_file_id: 1,
      photo_url: '/api/v1/vehicles/101/files/1',
    })
    vi.mocked(api.getVehicle).mockResolvedValue(vehicle)
    vi.mocked(api.updateVehicle).mockResolvedValue({
      ...vehicle,
      photo_file_id: null,
      photo_url: null,
    })
    renderEditor()

    await user.click(await screen.findByRole('button', { name: 'Remove main photo' }))

    expect(api.updateVehicle).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(api.updateVehicle).toHaveBeenCalledWith(101, { photo_file_id: null }),
    )
    expect(api.deleteVehicleFile).not.toHaveBeenCalled()
  })

  it('confirms gallery deletion, localizes an in-use denial, and hides delete without access', async () => {
    const user = userEvent.setup()
    const gallery = vehicleFile(3, 'gallery', 'gallery.jpg')
    vi.mocked(api.getVehicle).mockResolvedValue(baseVehicle({ photos: [gallery] }))
    vi.mocked(api.deleteVehicleFile).mockRejectedValue(
      new ApiError(409, 'VEHICLE_FILE_IN_USE', 'Vehicle file is in use.'),
    )
    const firstRender = renderEditor()

    await user.click(await screen.findByRole('button', { name: /Delete .*gallery\.jpg/ }))

    expect(api.deleteVehicleFile).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Delete gallery photo?')
    await user.click(within(dialog).getByRole('button', { name: 'Delete photo' }))

    expect(
      await screen.findByText(
        'This photo is in use as the main photo or in an accident record and cannot be deleted.',
      ),
    ).toBeInTheDocument()
    expect(api.deleteVehicleFile).toHaveBeenCalledWith(101, 3)
    expect(screen.getByRole('img', { name: 'gallery.jpg' })).toBeInTheDocument()

    firstRender.unmount()
    testState.canDeleteFiles = false
    renderEditor()

    expect(await screen.findByRole('img', { name: 'gallery.jpg' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete .*gallery\.jpg/ })).not.toBeInTheDocument()
  })

  it('keeps licence files in server newest-first order and marks the current scan', async () => {
    const current = vehicleFile(8, 'license', 'current-license.jpg')
    const previous = vehicleFile(4, 'license', 'previous-license.jpg')
    vi.mocked(api.getVehicle).mockResolvedValue(
      baseVehicle({
        license_file_id: current.id,
        license_url: current.url,
        license_files: [current, previous],
      }),
    )
    renderEditor()

    const files = await screen.findByRole('list', { name: 'Licence scans' })
    expect(within(files).getAllByRole('img').map((image) => image.getAttribute('alt'))).toEqual([
      'current-license.jpg',
      'previous-license.jpg',
    ])
    expect(within(files).getByText('Current scan')).toBeInTheDocument()
  })
})
