import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type {
  VehicleFileRead,
  VehiclePhotoRead,
  VehicleProfileScan,
  VehicleRead,
  VehicleSiteRead,
} from '@/lib/api'
import i18n from '@/lib/i18n'

import { AddVehicleDialog } from './AddVehicleDialog'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

type ApiModule = { api: typeof api } & Record<string, unknown>

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<ApiModule>()
  return {
    ...mod,
    api: {
      ...mod.api,
      listVehicleSites: vi.fn(),
      scanVehicleProfile: vi.fn(),
      createVehicle: vi.fn(),
      uploadVehicleFile: vi.fn(),
      updateVehicle: vi.fn(),
      listVehiclePhotos: vi.fn(),
      uploadVehiclePhoto: vi.fn(),
    },
  }
})

const SITES: VehicleSiteRead[] = [
  { id: 1, name_ar: 'مشروع الوثبة', name_en: 'Al Wathba', active: true, vehicle_count: 0 },
]

const CREATED_VEHICLE = {
  id: 101,
  plate_code: '14',
  plate_number: '58216',
  plate_label: '14 \\ 58216',
  traffic_code: '1180021637',
  type_ar: 'حافلة',
  type_en: 'Bus',
  class_ar: 'مركبة خفيفة',
  class_en: 'Light vehicle',
  vin: null,
  site_id: 1,
  license_start: '2026-09-08',
  license_expiry: '2027-09-07',
  expiry_status: 'valid',
  days_to_expiry: 364,
  fines_count: 0,
  fines_amount: 0,
  black_points: 0,
  contract_note_ar: null,
  contract_note_en: null,
} as VehicleRead

const LICENSE_FILE: VehicleFileRead = {
  id: 501,
  kind: 'license',
  label_ar: null,
  label_en: null,
  original_name: 'licence.jpg',
  media_type: 'image/jpeg',
  url: '/api/vehicles/101/files/501',
}
const PHOTO_ASSET: VehiclePhotoRead = {
  id: 21,
  label_ar: 'تويوتا كوستر',
  label_en: 'Toyota Coaster',
  original_name: 'coaster.webp',
  thumbnail_url: '/api/v1/vehicles/photo-library/21/image/thumbnail',
  preview_url: '/api/v1/vehicles/photo-library/21/image/preview',
  full_url: '/api/v1/vehicles/photo-library/21/image/full',
  width: 1448,
  height: 1086,
  usage_count: 2,
}


function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onOpenChange = vi.fn()

  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <AddVehicleDialog open onOpenChange={onOpenChange} />
      </I18nextProvider>
    </QueryClientProvider>,
  )

  return { onOpenChange }
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.listVehicleSites).mockResolvedValue(SITES)
  vi.mocked(api.scanVehicleProfile).mockResolvedValue({
    plate_code: '14',
    plate_number: '58216',
    traffic_code: '1180021637',
    type_ar: 'حافلة',
    type_en: 'Bus',
    make: 'Scanned make',
  })
  vi.mocked(api.createVehicle).mockResolvedValue(CREATED_VEHICLE)
  vi.mocked(api.uploadVehicleFile).mockResolvedValue(LICENSE_FILE)
  vi.mocked(api.listVehiclePhotos).mockResolvedValue([PHOTO_ASSET])
  vi.mocked(api.updateVehicle).mockResolvedValue({
    ...CREATED_VEHICLE,
    license_file_id: LICENSE_FILE.id,
  })
})

describe('AddVehicleDialog licence scan', () => {
  it('reviews suggestions without overwriting filled fields and retains the scan until Save', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(await screen.findByRole('button', { name: 'Choose from library' }))
    const picker = await screen.findByRole('dialog', { name: 'Choose main photo' })
    await user.click(within(picker).getByRole('button', { name: /Toyota Coaster/ }))
    await user.click(within(picker).getByRole('button', { name: 'Save selection' }))

    const makeInput = await screen.findByLabelText('Make')
    await user.type(makeInput, 'Manual make')

    const scanZone = screen.getByRole('button', { name: 'Read licence' })
    const scanInput = scanZone.querySelector('input[type="file"]')
    expect(scanInput).toBeInstanceOf(HTMLInputElement)
    const licence = new File(['scan'], 'licence.jpg', { type: 'image/jpeg' })
    await user.upload(scanInput as HTMLInputElement, licence)

    const review = await screen.findByRole('heading', { name: 'Review scanned fields' })
    const reviewPanel = review.parentElement?.parentElement
    expect(reviewPanel).not.toBeNull()
    const makeSuggestion = within(reviewPanel as HTMLElement).getByRole('checkbox', {
      name: 'Use suggested value: Make',
    })
    const plateSuggestion = within(reviewPanel as HTMLElement).getByRole('checkbox', {
      name: 'Use suggested value: Plate',
    })
    expect(makeSuggestion).not.toBeChecked()
    expect(plateSuggestion).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Plate' })).toHaveValue('')
    expect(api.uploadVehicleFile).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Apply selected suggestions' }))

    expect(screen.getByRole('textbox', { name: 'Plate' })).toHaveValue('14 \\ 58216')
    expect(screen.getByRole('textbox', { name: 'Make' })).toHaveValue('Manual make')
    expect(screen.getByRole('textbox', { name: 'Traffic code' })).toHaveValue('1180021637')
    expect(api.uploadVehicleFile).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.createVehicle).toHaveBeenCalledTimes(1))
    expect(api.createVehicle).toHaveBeenCalledWith(
      expect.objectContaining({ photo_asset_id: PHOTO_ASSET.id }),
    )
    expect(api.uploadVehicleFile).toHaveBeenCalledTimes(1)
    expect(api.uploadVehicleFile).toHaveBeenCalledWith(101, 'license', licence)
    expect(api.updateVehicle).toHaveBeenCalledWith(101, { license_file_id: 501 })
  })

  it('drops a stale scan response after the operator chooses another file', async () => {
    const user = userEvent.setup()
    let resolveFirstScan: ((value: VehicleProfileScan) => void) | undefined
    const firstScan = new Promise<VehicleProfileScan>((resolve) => {
      resolveFirstScan = resolve
    })
    vi.mocked(api.scanVehicleProfile)
      .mockImplementationOnce(() => firstScan)
      .mockResolvedValueOnce({ make: 'Second scan make' })
    renderDialog()

    await screen.findByLabelText('Make')
    const firstZone = screen.getByRole('button', { name: 'Read licence' })
    const firstInput = firstZone.querySelector('input[type="file"]')
    expect(firstInput).toBeInstanceOf(HTMLInputElement)
    await user.upload(
      firstInput as HTMLInputElement,
      new File(['first'], 'first.jpg', { type: 'image/jpeg' }),
    )

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    const secondZone = screen.getByRole('button', { name: 'Read licence' })
    const secondInput = secondZone.querySelector('input[type="file"]')
    expect(secondInput).toBeInstanceOf(HTMLInputElement)
    await user.upload(
      secondInput as HTMLInputElement,
      new File(['second'], 'second.jpg', { type: 'image/jpeg' }),
    )

    await screen.findByText('Second scan make')
    await act(async () => {
      resolveFirstScan?.({ make: 'Stale scan make' })
      await firstScan
    })

    expect(screen.queryByText('Stale scan make')).not.toBeInTheDocument()
    expect(screen.getByText('Second scan make')).toBeInTheDocument()
  })
})
