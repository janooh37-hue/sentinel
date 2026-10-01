import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return {
    ...real,
    api: {
      ...real.api,
      listVehicleFines: vi.fn().mockResolvedValue([]),
      listVehicleSites: vi.fn().mockResolvedValue([
        { id: 7, name_en: 'North', name_ar: 'الشمال', active: true },
      ]),
    },
  }
})
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { VehicleFinesReportPage } from './VehicleFinesReportPage'

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

function setup(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/vehicles/fines-report"
            element={<><VehicleFinesReportPage /><LocationProbe /></>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('VehicleFinesReportPage URL filters', () => {
  it('writes changed filters to the URL and restores them when loaded directly', async () => {
    const user = userEvent.setup()
    const { unmount } = setup('/vehicles/fines-report')
    await screen.findByRole('option', { name: 'North' })
    await user.selectOptions(screen.getByLabelText('vehicles.site'), '7')
    await user.type(screen.getByLabelText('vehicles.fromDate'), '2026-09-01')

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('site_id=7')
      expect(screen.getByTestId('location')).toHaveTextContent('date_from=2026-09-01')
    })
    unmount()
    setup('/vehicles/fines-report?site_id=7&date_from=2026-09-01')
    await screen.findByRole('option', { name: 'North' })
    expect(screen.getByLabelText('vehicles.site')).toHaveValue('7')
    expect(screen.getByLabelText('vehicles.fromDate')).toHaveValue('2026-09-01')
  })
})
