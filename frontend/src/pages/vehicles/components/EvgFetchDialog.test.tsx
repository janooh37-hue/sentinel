import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { EvgPreviewResponse, EvgPreviewRow, VehicleListItem } from '@/lib/api'
import i18n from '@/lib/i18n'

import { EvgFetchDialog } from './EvgFetchDialog'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

type ApiModule = { api: typeof api } & Record<string, unknown>

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<ApiModule>()
  return {
    ...mod,
    api: {
      ...mod.api,
      listVehicles: vi.fn(),
      evgPreview: vi.fn(),
      evgConfirm: vi.fn(),
    },
  }
})

const ASSIGNED_VEHICLE_ID = 102

const FLEET: VehicleListItem[] = [
  {
    id: 101,
    plate_code: '21',
    plate_number: '13695',
    plate_label: '21 \\ 13695',
    traffic_code: '1180021637',
    type_ar: 'ميتسوبيشي بيك أب',
    type_en: 'Mitsubishi Pickup',
    class_ar: 'بيك أب',
    class_en: 'Pickup',
    vin: 'MMBJNKB40GD001369',
    site_id: 1,
    license_start: '2026-01-01',
    license_expiry: '2026-12-31',
    expiry_status: 'valid',
    days_to_expiry: 120,
    fines_count: 0,
    fines_amount: 0,
    black_points: 0,
    photo_url: null,
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
    vin: 'JN1TANY62Z0123456',
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
    plate_code: '14',
    plate_number: '58216',
    plate_label: '14 \\ 58216',
    traffic_code: '1180099942',
    type_ar: 'تويوتا كوستر',
    type_en: 'Toyota Coaster',
    class_ar: 'باص خفيف',
    class_en: 'Light bus',
    vin: 'JT123456789000103',
    site_id: 2,
    license_start: '2025-09-01',
    license_expiry: '2026-08-31',
    expiry_status: 'expired',
    days_to_expiry: -2,
    fines_count: 3,
    fines_amount: 1850,
    black_points: 7,
    photo_url: null,
  },
]

const MATCHED_ROW: EvgPreviewRow = {
  ticket_no: '6261776007',
  date: '2026-08-14',
  time: '12:37',
  location: 'Al Khaleej Al Arabi Street',
  plate_number: '13695',
  plate_code: '21',
  amount: 650,
  amount_after_discount: 650,
  black_points: 4,
  fine_type: 'Absent',
  description: 'Exceeding the speed limit',
  vehicle_id: 101,
  match: 'matched',
}

const UNMATCHED_ROW: EvgPreviewRow = {
  ticket_no: '6261776008',
  date: '2026-08-15',
  time: '08:05',
  location: 'Sheikh Zayed Road',
  plate_number: '35901',
  plate_code: null,
  amount: 400,
  amount_after_discount: 400,
  black_points: 0,
  fine_type: 'Absent',
  description: 'Lane discipline violation',
  vehicle_id: null,
  match: 'unmatched',
}

const AMBIGUOUS_ROW: EvgPreviewRow = {
  ticket_no: '6261776009',
  date: '2026-08-16',
  time: null,
  location: 'Airport Road',
  plate_number: '36348',
  plate_code: null,
  amount: 300,
  amount_after_discount: 300,
  black_points: 2,
  fine_type: 'Absent',
  description: 'Using a mobile phone while driving',
  vehicle_id: null,
  match: 'ambiguous',
}

const IMPORTED_ROW: EvgPreviewRow = {
  ticket_no: '6261776010',
  date: '2026-08-17',
  time: '15:20',
  location: 'Mussafah Industrial Area',
  plate_number: '58216',
  plate_code: '14',
  amount: 500,
  amount_after_discount: 500,
  black_points: 3,
  fine_type: 'Absent',
  description: 'Failure to stop at a red light',
  vehicle_id: 103,
  match: 'already_imported',
}

const PREVIEW: EvgPreviewResponse = {
  rows: [MATCHED_ROW, UNMATCHED_ROW, AMBIGUOUS_ROW, IMPORTED_ROW],
  traffic_codes: ['1180021637', '1180099942'],
  fetched_at: '2026-09-02T09:15:00Z',
  vehicles: FLEET.map(({ id, plate_label }) => ({ id, plate_label })),
}

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const onOpenChange = vi.fn()

  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <EvgFetchDialog open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )

  return { onOpenChange, queryClient }
}

async function fetchPreview(user: ReturnType<typeof userEvent.setup>) {
  renderDialog()
  const fetchButton = await screen.findByRole('button', { name: 'Fetch fines' })
  await user.click(fetchButton)
  await screen.findByText(MATCHED_ROW.ticket_no)
}

function rowFor(ticketNo: string) {
  return screen.getByRole('row', { name: new RegExp(ticketNo) })
}

describe('EvgFetchDialog', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
    vi.mocked(api.listVehicles).mockResolvedValue(FLEET)
    vi.mocked(api.evgPreview).mockResolvedValue(PREVIEW)
    vi.mocked(api.evgConfirm).mockResolvedValue({ created: 1, skipped: 0 })
  })

  it('renders every preview status and applies its initial row-selection state', async () => {
    const user = userEvent.setup()
    await fetchPreview(user)

    expect(api.evgPreview).toHaveBeenCalledWith({
      traffic_codes: ['1180021637', '1180099942'],
    })

    const matched = rowFor(MATCHED_ROW.ticket_no)
    const unmatched = rowFor(UNMATCHED_ROW.ticket_no)
    const ambiguous = rowFor(AMBIGUOUS_ROW.ticket_no)
    const imported = rowFor(IMPORTED_ROW.ticket_no)

    expect(within(matched).getByText('Matched')).toBeInTheDocument()
    expect(within(unmatched).getByText('Unmatched')).toBeInTheDocument()
    expect(within(ambiguous).getByText('Multiple matches')).toBeInTheDocument()
    expect(within(imported).getByText('Already imported')).toBeInTheDocument()

    expect(within(matched).getByRole('checkbox')).toBeChecked()
    expect(within(matched).getByRole('checkbox')).toBeEnabled()
    expect(within(unmatched).getByRole('checkbox')).not.toBeChecked()
    expect(within(unmatched).getByRole('checkbox')).toBeDisabled()
    expect(within(ambiguous).getByRole('checkbox')).not.toBeChecked()
    expect(within(ambiguous).getByRole('checkbox')).toBeDisabled()
    expect(within(imported).getByRole('checkbox')).not.toBeChecked()
    expect(within(imported).getByRole('checkbox')).toBeDisabled()
  })

  it('checks an unmatched row when a vehicle is chosen and confirms only checked rows with vehicle ids', async () => {
    const user = userEvent.setup()
    await fetchPreview(user)

    const matched = rowFor(MATCHED_ROW.ticket_no)
    const unmatched = rowFor(UNMATCHED_ROW.ticket_no)
    const imported = rowFor(IMPORTED_ROW.ticket_no)
    const matchedCheckbox = within(matched).getByRole('checkbox')
    const unmatchedCheckbox = within(unmatched).getByRole('checkbox')

    await user.click(matchedCheckbox)
    expect(matchedCheckbox).not.toBeChecked()

    await user.selectOptions(
      within(unmatched).getByRole('combobox'),
      String(ASSIGNED_VEHICLE_ID),
    )
    expect(unmatchedCheckbox).toBeEnabled()
    expect(unmatchedCheckbox).toBeChecked()
    expect(within(imported).getByRole('checkbox')).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Add 1 fines' }))

    await waitFor(() =>
      expect(api.evgConfirm).toHaveBeenCalledWith({
        rows: [{ ...UNMATCHED_ROW, vehicle_id: ASSIGNED_VEHICLE_ID }],
      }),
    )
    expect(api.evgConfirm).toHaveBeenCalledTimes(1)
  })
})
