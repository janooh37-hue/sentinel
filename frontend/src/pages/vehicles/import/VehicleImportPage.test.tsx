import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type {
  VehicleImportInspection,
  VehicleImportPreview,
  VehicleImportResult,
  VehicleSiteRead,
} from '@/lib/api'
import i18n from '@/lib/i18n'

import { ImportResultSummary } from './ImportResultSummary'
import { VehicleImportPage } from './VehicleImportPage'

type ApiModule = { api: typeof api } & Record<string, unknown>

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<ApiModule>()
  return {
    ...mod,
    api: {
      ...mod.api,
      listVehicleSites: vi.fn(),
      inspectVehicleImport: vi.fn(),
      previewVehicleImport: vi.fn(),
      confirmVehicleImport: vi.fn(),
      scanVehicleImportImage: vi.fn(),
      downloadVehicleImportTemplate: vi.fn(),
    },
  }
})

const SITES: VehicleSiteRead[] = [
  { id: 7, name_ar: 'مشروع المصفح', name_en: 'Mussafah', active: true, vehicle_count: 2 },
]

const INSPECTION: VehicleImportInspection = {
  token: 'a'.repeat(32),
  expires_at: '2026-09-09T08:00:00Z',
  filename: 'fleet.xlsx',
  sections: [{ id: 'section-1', sheet: 'Vehicles', title: 'Vehicles' }],
  rows: [
    {
      row_id: 'row-valid',
      section_id: 'section-1',
      sheet: 'Vehicles',
      row_number: 2,
      raw: { plate_number: '1001' },
      values: { plate_code: '1', plate_number: '1001', traffic_code: '10001' },
      image_ids: [],
    },
    {
      row_id: 'row-invalid',
      section_id: 'section-1',
      sheet: 'Vehicles',
      row_number: 3,
      raw: { plate_number: '1001' },
      values: { plate_code: '1', plate_number: '1001', traffic_code: '10002' },
      image_ids: [],
    },
  ],
  images: [],
  warnings: [],
}

const PREVIEW: VehicleImportPreview = {
  revision: 'latest-revision',
  rows: [
    {
      row_id: 'row-valid',
      action: 'create',
      vehicle_id: null,
      values: { plate_code: '1', plate_number: '1001', traffic_code: '10001', site_id: 7 },
      changes: [],
      errors: [],
      warnings: [],
      current_photo_url: null,
      current_license_url: null,
      images: [],
      photo_choice_required: false,
      license_choice_required: false,
      ocr_review_required: false,
    },
    {
      row_id: 'row-invalid',
      action: 'invalid',
      vehicle_id: null,
      values: { plate_code: '1', plate_number: '1001', traffic_code: '10002', site_id: 7 },
      changes: [],
      errors: [
        {
          row_id: 'row-invalid',
          field: 'plate_number',
          code: 'VEHICLE_IMPORT_DUPLICATE_PLATE',
          message: 'This plate appears more than once in the workbook.',
        },
      ],
      warnings: [],
      current_photo_url: null,
      current_license_url: null,
      images: [],
      photo_choice_required: false,
      license_choice_required: false,
      ocr_review_required: false,
    },
  ],
  counts: { create: 1, update: 0, unchanged: 0, invalid: 1, archived: 0, excluded: 0 },
}

const RESULT: VehicleImportResult = {
  created: 1,
  updated: 0,
  unchanged: 0,
  images_added: 0,
  images_skipped: 0,
  vehicle_ids: [501, 502],
}

function renderWizard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/vehicles/import']}>
          <VehicleImportPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.listVehicleSites).mockResolvedValue(SITES)
  vi.mocked(api.inspectVehicleImport).mockResolvedValue(INSPECTION)
  vi.mocked(api.previewVehicleImport).mockResolvedValue(PREVIEW)
  vi.mocked(api.confirmVehicleImport).mockResolvedValue(RESULT)
})

describe('VehicleImportPage', () => {
  it('confirms selected valid rows with the latest preview while leaving an invalid row blocked', async () => {
    const user = userEvent.setup()
    const { container } = renderWizard()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(
      fileInput,
      new File(['xlsx'], 'fleet.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    )

    await screen.findByText('Workbook review')
    await user.selectOptions(screen.getByLabelText('Site for \u2068Vehicles\u2069'), '7')
    await user.click(screen.getByRole('button', { name: 'Preview changes' }))

    await waitFor(() => expect(api.previewVehicleImport).toHaveBeenCalledTimes(1))
    const validRow = screen.getByText('Workbook row \u20682\u2069').closest('article')
    const invalidRow = screen.getByText('Workbook row \u20683\u2069').closest('article')
    expect(validRow).not.toBeNull()
    expect(invalidRow).not.toBeNull()
    expect(
      within(validRow as HTMLElement).getByRole('checkbox', {
        name: 'Select workbook row \u20682\u2069 for import',
      }),
    ).toBeChecked()
    expect(
      within(invalidRow as HTMLElement).getByRole('checkbox', {
        name: 'Select workbook row \u20683\u2069 for import',
      }),
    ).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Import selected (\u20681\u2069)' }))

    await waitFor(() =>
      expect(api.confirmVehicleImport).toHaveBeenCalledWith(INSPECTION.token, {
        revision: 'latest-revision',
        row_ids: ['row-valid'],
      }),
    )
    expect(await screen.findByText('Fleet import complete')).toBeInTheDocument()
  })

  it('uses typed shared controls and blocks invalid integer corrections without coercing them', async () => {
    const user = userEvent.setup()
    const { container } = renderWizard()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(
      fileInput,
      new File(['xlsx'], 'fleet.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    )
    await screen.findByText('Workbook review')
    await user.selectOptions(screen.getByLabelText('Site for \u2068Vehicles\u2069'), '7')
    const row = screen.getByText('Workbook row \u20682\u2069').closest('article')
    expect(row).not.toBeNull()
    await user.click(within(row as HTMLElement).getByText('Edit workbook fields'))

    expect(within(row as HTMLElement).getByLabelText('Licence start')).toHaveAttribute(
      'type',
      'date',
    )
    const capacity = within(row as HTMLElement).getByLabelText('Passenger capacity')
    expect(capacity).toHaveAttribute('inputmode', 'numeric')

    await user.type(capacity, '12 seats')
    await waitFor(() => expect(capacity).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByRole('button', { name: 'Preview changes' })).toBeDisabled()

    await user.clear(capacity)
    await user.type(capacity, '12')
    await waitFor(() => expect(capacity).not.toHaveAttribute('aria-invalid'))
    expect(screen.getByRole('button', { name: 'Preview changes' })).toBeEnabled()
  })

  it('renders required-field row errors from the locale instead of the backend message', async () => {
    const user = userEvent.setup()
    const requiredPreview: VehicleImportPreview = {
      ...PREVIEW,
      rows: PREVIEW.rows.map((row) =>
        row.row_id === 'row-invalid'
          ? {
              ...row,
              errors: [
                {
                  row_id: row.row_id,
                  field: 'type_ar',
                  code: 'VEHICLE_IMPORT_REQUIRED_FIELD',
                  message: 'type_ar is required.',
                },
              ],
            }
          : row,
      ),
    }
    await i18n.changeLanguage('ar')
    vi.mocked(api.previewVehicleImport).mockResolvedValue(requiredPreview)
    const { container } = renderWizard()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(
      fileInput,
      new File(['xlsx'], 'fleet.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    )
    await screen.findByText('مراجعة ملف المركبات')
    await user.selectOptions(screen.getByLabelText(/موقع القسم/), '7')
    await user.click(screen.getByRole('button', { name: 'معاينة التغييرات' }))

    expect(await screen.findByText('هذا الحقل مطلوب.')).toBeInTheDocument()
    expect(screen.queryByText('type_ar is required.')).not.toBeInTheDocument()
  })

  it('renders one affected-vehicle link for every returned id and keeps restart available', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ImportResultSummary result={RESULT} onRestart={vi.fn()} />
        </MemoryRouter>
      </I18nextProvider>,
    )

    const links = screen.getAllByRole('link', { name: /Open vehicle/ })
    expect(links).toHaveLength(RESULT.vehicle_ids.length)
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/vehicles/501',
      '/vehicles/502',
    ])
    expect(screen.getByRole('button', { name: 'Import another workbook' })).toBeInTheDocument()
  })
})
