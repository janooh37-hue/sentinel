import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import i18n from '@/lib/i18n'

import { VehicleAccidentsPage } from './VehicleAccidentsPage'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => true, isLoading: false }),
}))

beforeEach(async () => {
  vi.restoreAllMocks()
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listVehicleAccidents').mockResolvedValue([])
})

describe('VehicleAccidentsPage counter', () => {
  it('offers a retry when the fleet list fails, then starts reports again', async () => {
    vi.spyOn(api, 'listVehicles')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([
        { id: 42, plate_code: '14', plate_number: '58216', type_ar: 'حافلة', type_en: 'Bus' },
      ] as never)
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/vehicles/accidents']}>
            <VehicleAccidentsPage />
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    )
    const start = screen.getByRole('button', { name: i18n.t('vehicles.newReport') })
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('common.loadError'))
    expect(start).toBeDisabled()
    await user.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    await waitFor(() => expect(start).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
