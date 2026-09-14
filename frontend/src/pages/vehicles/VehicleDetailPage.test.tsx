import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/lib/api'
import type { VehicleFileRead, VehiclePhotoRead, VehicleRead, VehicleSiteRead } from '@/lib/api'
import i18n from '@/lib/i18n'

import { VehicleDetailPage } from './VehicleDetailPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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
      getVehicle: vi.fn(),
      listVehicleSites: vi.fn(),
      uploadVehicleFile: vi.fn(),
      updateVehicle: vi.fn(),
      updateVehicleCertificate: vi.fn(),
      deleteVehicleFile: vi.fn(),
      promoteVehiclePhoto: vi.fn(),
      listVehiclePhotos: vi.fn(),
      uploadVehiclePhoto: vi.fn(),
    },
  }
})

const SITES: VehicleSiteRead[] = [
  { id: 1, name_ar: 'مشروع الوثبة', name_en: 'Al Wathba', active: true, vehicle_count: 1 },
]

function vehicleFile(id: number, kind: VehicleFileRead['kind'], name: string): VehicleFileRead {
  return {
    id,
    kind,
    label_ar: null,
    label_en: null,
    original_name: name,
    media_type: 'image/jpeg',
    url: `/api/v1/vehicles/101/files/${id}`,
    is_historical: false,
  }
}

function certFile(
  id: number,
  name: string,
  overrides: Partial<VehicleFileRead> = {},
): VehicleFileRead {
  return {
    ...vehicleFile(id, 'certificate', name),
    label_ar: `مستند ${id}`,
    label_en: `Document ${id}`,
    media_type: 'image/png',
    expiry_date: '2027-06-01',
    is_historical: false,
    superseded_by_file_id: null,
    ...overrides,
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
    fines_amount_fils: 0,
    black_points: 0,
    photo_asset_id: 1,
    photo_url: '/api/v1/vehicles/photo-library/1/image/preview',
    photo_thumbnail_url: '/api/v1/vehicles/photo-library/1/image/thumbnail',
    photo_full_url: '/api/v1/vehicles/photo-library/1/image/full',
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
    license_url: '/api/v1/vehicles/101/files/2',
    fines: [],
    renewals: [],
    accidents: [],
    maintenance: [],
    photos: [vehicleFile(3, 'gallery', 'side.jpg')],
    inmate_capacity: null,
    passenger_capacity: null,
    accessories_ar: null,
    accessories_en: null,
    notes_ar: null,
    notes_en: null,
    license_file_id: 2,
    license_files: [vehicleFile(2, 'license', 'licence.jpg')],
    ...overrides,
  }
}

const PHOTO_ASSET: VehiclePhotoRead = {
  id: 21,
  label_ar: 'صورة جانبية',
  label_en: 'Side photo',
  original_name: 'side.jpg',
  thumbnail_url: '/api/v1/vehicles/photo-library/21/image/thumbnail',
  preview_url: '/api/v1/vehicles/photo-library/21/image/preview',
  full_url: '/api/v1/vehicles/photo-library/21/image/full',
  width: 1448,
  height: 1086,
  usage_count: 0,
}

function renderPage(tab?: 'renewals' | 'photos' | 'certificates') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const suffix = tab ? `?tab=${tab}` : ''
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/vehicles/101${suffix}`]}>
          <Routes>
            <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  i18n.addResource('en', 'translation', 'vehicles.setAsMainPhoto', 'Set as main photo')
  i18n.addResource('en', 'translation', 'vehicles.replaceLicenceFile', 'Replace licence file')
  i18n.addResource(
    'en',
    'translation',
    'vehicles.replaceLicenceFileHint',
    'Replaces only the attached scan; licence dates stay unchanged.',
  )
  i18n.addResource(
    'en',
    'translation',
    'vehicles.previousLicenceFiles',
    'Previous licence files',
  )
  vi.mocked(api.getVehicle).mockResolvedValue(baseVehicle())
  vi.mocked(api.listVehicleSites).mockResolvedValue(SITES)
  vi.mocked(api.listVehiclePhotos).mockResolvedValue([PHOTO_ASSET])
  vi.mocked(api.promoteVehiclePhoto).mockResolvedValue(PHOTO_ASSET)
})

describe('VehicleDetailPage', () => {
  it('shows that insurance is not recorded when the vehicle has no insurance date', async () => {
    renderPage()

    const label = await screen.findByText('Insurance expiry')
    expect(label.parentElement).toHaveTextContent('Not recorded')
  })

  it('loads the full variant only after the main photo viewer opens', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Main photo' }))

    expect(await screen.findByRole('img', { name: 'Main photo' })).toHaveAttribute(
      'src',
      '/api/v1/vehicles/photo-library/1/image/full',
    )
  })

  it('promotes a gallery photo to the main photo', async () => {
    const user = userEvent.setup()
    vi.mocked(api.updateVehicle).mockResolvedValue(
      baseVehicle({ photo_asset_id: PHOTO_ASSET.id, photo_url: PHOTO_ASSET.preview_url }),
    )
    renderPage('photos')

    await user.click(await screen.findByRole('button', { name: 'Set as main photo' }))

    await waitFor(() =>
      expect(api.promoteVehiclePhoto).toHaveBeenCalledWith(101, 3),
    )
    expect(api.updateVehicle).toHaveBeenCalledWith(101, { photo_asset_id: PHOTO_ASSET.id })
  })

  it('replaces only the attached licence file without changing licence dates', async () => {
    const user = userEvent.setup()
    const replacement = new File(['scan'], 'replacement.jpg', { type: 'image/jpeg' })
    const previous = vehicleFile(8, 'license', 'previous-licence.jpg')
    vi.mocked(api.getVehicle).mockResolvedValue(
      baseVehicle({
        license_files: [vehicleFile(2, 'license', 'licence.jpg'), previous],
      }),
    )
    vi.mocked(api.uploadVehicleFile).mockResolvedValue(vehicleFile(9, 'license', replacement.name))
    vi.mocked(api.updateVehicle).mockResolvedValue(baseVehicle({ license_file_id: 9 }))
    const { container } = renderPage('renewals')

    await screen.findByText('Replace licence file')
    expect(await screen.findByRole('img', { name: 'previous-licence.jpg' })).toBeInTheDocument()
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await user.upload(input as HTMLInputElement, replacement)

    await waitFor(() =>
      expect(api.uploadVehicleFile).toHaveBeenCalledWith(
        101,
        'license',
        replacement,
        expect.objectContaining({ label_ar: expect.any(String), label_en: expect.any(String) }),
      ),
    )
    expect(api.updateVehicle).toHaveBeenCalledWith(101, { license_file_id: 9 })
  })

  it('uploads every gallery file from one multiple selection in order', async () => {
    const user = userEvent.setup()
    const first = new File(['one'], 'one.jpg', { type: 'image/jpeg' })
    const second = new File(['two'], 'two.jpg', { type: 'image/jpeg' })
    vi.mocked(api.uploadVehicleFile).mockImplementation(async (_id, kind, file) =>
      vehicleFile(file === first ? 10 : 11, kind, file.name),
    )
    const { container } = renderPage('photos')

    await screen.findByText('Add photo')
    const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')
    expect(input).not.toBeNull()
    await user.upload(input as HTMLInputElement, [first, second])

    await waitFor(() => expect(api.uploadVehicleFile).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.uploadVehicleFile).mock.calls.map((call) => call[2])).toEqual([
      first,
      second,
    ])
  })

  it('surfaces the server delete guard message for an in-use file', async () => {
    const user = userEvent.setup()
    vi.mocked(api.deleteVehicleFile).mockRejectedValue(
      new ApiError(409, 'FILE_NOT_DELETABLE', 'Only gallery photos can be deleted.'),
    )
    renderPage('photos')

    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Only gallery photos can be deleted.'),
    )
  })

  describe('certificates', () => {
    it('renders dated, no-expiry, and historical certificates', async () => {
      vi.mocked(api.getVehicle).mockResolvedValue(
        baseVehicle({
          certificates: [
            certFile(201, 'inspection.pdf', { expiry_date: '2027-06-01' }),
            certFile(202, 'permanent.png', { expiry_date: null }),
            certFile(203, 'old-scan.jpg', { expiry_date: '2026-01-01', is_historical: true }),
          ],
        }),
      )
      renderPage('certificates')

      expect(await screen.findByText('inspection.pdf')).toBeInTheDocument()
      expect(screen.getByText('permanent.png')).toBeInTheDocument()
      expect(screen.getByText('No expiry')).toBeInTheDocument()
      expect(screen.getByText('Historical')).toBeInTheDocument()
    })

    it('blocks submission until every pending row has a name and a date or No expiry', async () => {
      const user = userEvent.setup()
      vi.mocked(api.getVehicle).mockResolvedValue(baseVehicle({ certificates: [] }))
      const first = new File(['a'], 'a.png', { type: 'image/png' })
      const second = new File(['b'], 'b.png', { type: 'image/png' })
      const { container } = renderPage('certificates')

      await screen.findByText('Add certificates')
      const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')
      expect(input).not.toBeNull()
      await user.upload(input as HTMLInputElement, [first, second])

      const submit = screen.getByRole('button', { name: 'Upload certificates' })
      expect(submit).toBeDisabled()

      const dateInputs = screen.getAllByLabelText('Expiry date')
      await user.type(dateInputs[0], '2027-01-01')
      expect(submit).toBeDisabled() // second row still has neither a date nor No expiry

      const noExpiryCheckboxes = screen.getAllByRole('checkbox', { name: 'No expiry' })
      await user.click(noExpiryCheckboxes[1])
      expect(dateInputs[1]).toBeDisabled()
      expect(submit).not.toBeDisabled()

      await user.click(noExpiryCheckboxes[1])
      expect(submit).toBeDisabled() // unchecking requires the date to be re-entered
    })

    it('retains only the failed pending row and applies the succeeded upload after refetch', async () => {
      const user = userEvent.setup()
      vi.mocked(api.getVehicle)
        .mockResolvedValueOnce(baseVehicle({ certificates: [] }))
        .mockResolvedValue(
          baseVehicle({ certificates: [certFile(301, 'saved.png', { expiry_date: '2027-01-01' })] }),
        )
      vi.mocked(api.uploadVehicleFile).mockImplementation(async (_id, _kind, file) => {
        if (file.name === 'failed.png') throw new ApiError(422, 'VEHICLE_CERTIFICATE_INVALID', 'bad')
        return certFile(301, file.name, { expiry_date: '2027-01-01' })
      })
      const saved = new File(['s'], 'saved.png', { type: 'image/png' })
      const failed = new File(['f'], 'failed.png', { type: 'image/png' })
      const { container } = renderPage('certificates')

      await screen.findByText('Add certificates')
      const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')
      await user.upload(input as HTMLInputElement, [saved, failed])
      for (const dateInput of screen.getAllByLabelText('Expiry date')) {
        await user.type(dateInput, '2027-01-01')
      }

      await user.click(screen.getByRole('button', { name: 'Upload certificates' }))

      await waitFor(() => expect(api.uploadVehicleFile).toHaveBeenCalledTimes(2))
      expect(await screen.findByText('failed.png')).toBeInTheDocument()
      expect(screen.queryByDisplayValue('saved')).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByText('saved.png')).toBeInTheDocument())
    })

    it('cancelling Edit expiry sends no certificate update', async () => {
      const user = userEvent.setup()
      vi.mocked(api.getVehicle).mockResolvedValue(
        baseVehicle({ certificates: [certFile(401, 'a.pdf', { expiry_date: '2027-01-01' })] }),
      )
      renderPage('certificates')

      await user.click(await screen.findByRole('button', { name: 'Edit expiry' }))
      const dateInput = screen.getByLabelText('Expiry date')
      await user.clear(dateInput)
      await user.type(dateInput, '2028-01-01')
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(api.updateVehicleCertificate).not.toHaveBeenCalled()
      expect(screen.queryByLabelText('Expiry date')).not.toBeInTheDocument()
    })

    it('deletes only the certificate selected among two rows sharing a name', async () => {
      const user = userEvent.setup()
      vi.mocked(api.getVehicle).mockResolvedValue(
        baseVehicle({
          certificates: [
            certFile(501, 'copy.pdf', { expiry_date: '2027-01-01' }),
            certFile(502, 'copy.pdf', { expiry_date: '2028-01-01' }),
          ],
        }),
      )
      vi.mocked(api.deleteVehicleFile).mockResolvedValue(undefined)
      renderPage('certificates')

      const deleteButtons = await screen.findAllByRole('button', { name: 'Delete' })
      await user.click(deleteButtons[0])
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(api.deleteVehicleFile).toHaveBeenCalledWith(101, 501))
      expect(api.deleteVehicleFile).not.toHaveBeenCalledWith(101, 502)
    })
  })
})
