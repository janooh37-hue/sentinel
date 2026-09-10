import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/lib/api'
import type { VehiclePhotoRead } from '@/lib/api'
import i18n from '@/lib/i18n'

import { VehiclePhotoPicker } from './VehiclePhotoPicker'

type ApiModule = { api: typeof api } & Record<string, unknown>

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<ApiModule>()
  return {
    ...mod,
    api: {
      ...mod.api,
      listVehiclePhotos: vi.fn(),
      uploadVehiclePhoto: vi.fn(),
    },
  }
})

function asset(id: number, label: string): VehiclePhotoRead {
  return {
    id,
    label_ar: `صورة ${id}`,
    label_en: label,
    original_name: `${label}.webp`,
    thumbnail_url: `/api/v1/vehicles/photo-library/${id}/image/thumbnail`,
    preview_url: `/api/v1/vehicles/photo-library/${id}/image/preview`,
    full_url: `/api/v1/vehicles/photo-library/${id}/image/full`,
    width: 1448,
    height: 1086,
    usage_count: id,
  }
}

const CURRENT = asset(1, 'Current composite')
const OTHER = asset(2, 'Other composite')

function renderPicker(onSave = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onOpenChange = vi.fn()
  const result = render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <VehiclePhotoPicker
          open
          onOpenChange={onOpenChange}
          currentAssetId={CURRENT.id}
          currentPreviewUrl={CURRENT.preview_url}
          onSave={onSave}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return { ...result, onOpenChange, onSave }
}

beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.listVehiclePhotos).mockResolvedValue([CURRENT, OTHER])
})

describe('VehiclePhotoPicker', () => {
  it('isolates a changed selection when the operator cancels', async () => {
    const user = userEvent.setup()
    const { onOpenChange, onSave } = renderPicker()
    const dialog = await screen.findByRole('dialog', { name: 'Choose main photo' })

    await user.click(await within(dialog).findByRole('button', { name: /Other composite/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the current selection when a named upload fails', async () => {
    const user = userEvent.setup()
    vi.mocked(api.uploadVehiclePhoto).mockRejectedValue(
      new ApiError(422, 'VEHICLE_PHOTO_INVALID', 'Image could not be decoded'),
    )
    const { onSave } = renderPicker()
    const dialog = await screen.findByRole('dialog', { name: 'Choose main photo' })

    await user.type(
      await within(dialog).findByRole('textbox', { name: 'Photo name in Arabic' }),
      'حافلة',
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Photo name in English' }),
      'Bus',
    )
    const fileInput = dialog.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    await user.upload(
      fileInput as HTMLInputElement,
      new File(['broken'], 'bus.png', { type: 'image/png' }),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Upload to library' }))

    expect(await within(dialog).findByRole('alert')).toBeVisible()
    expect(await within(dialog).findByRole('button', { name: /Current composite/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(onSave).not.toHaveBeenCalled()
  })
})
