import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { VehicleRead } from '@/lib/api'
import i18n from '@/lib/i18n'

import { VehicleFinesLetterPage } from './VehicleFinesLetterPage'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ isLoading: false, has: () => true }),
}))

vi.mock('@/components/shell/RequireCapability', () => ({
  RequireCapability: ({ children }: { children: React.ReactNode }) => children,
}))

const VEHICLE = {
  id: 42,
  plate_label: '14 \\ 58216',
  type_ar: 'مركبة',
  type_en: 'Vehicle',
  fines: [
    {
      id: 1,
      vehicle_id: 42,
      employee_id: null,
      employee_name_ar: null,
      employee_name_en: null,
      date: '2026-01-10',
      time: null,
      amount_fils: 1000,
      amount_after_discount_fils: null,
      black_points: 0,
      source: 'manual',
      evg_ticket_no: null,
      location: null,
      description: null,
      fine_type: null,
      payment_status: 'unpaid',
      receipt: null,
      archived_at: null,
      created_at: '2026-01-10T00:00:00',
      version: '1',
      vehicle_plate_label: '14 \\ 58216',
      vehicle_type_ar: 'مركبة',
      vehicle_type_en: 'Vehicle',
    },
  ],
} as VehicleRead

function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output>{`${location.pathname}${location.search}`}</output>
      <button type="button" onClick={() => navigate(-1)}>History back</button>
    </>
  )
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/vehicles/42/fines-letter']}>
          <Routes>
            <Route
              path="/vehicles/:id/fines-letter"
              element={
                <>
                  <VehicleFinesLetterPage />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'getVehicle').mockResolvedValue(VEHICLE)
})

describe('VehicleFinesLetterPage URL step', () => {
  it('returns to step 1 with Back after advancing to the preview', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /Preview document/ }))
    expect(screen.getByText('/vehicles/42/fines-letter?step=2')).toBeInTheDocument()
    expect(screen.getByText('Document preview').closest('[aria-current="step"]')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'History back' }))

    expect(await screen.findByText('/vehicles/42/fines-letter')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Preview document/ })).toBeInTheDocument()
    expect(screen.getByText('Document preview').closest('[aria-current="step"]')).toBeNull()
  })
})
