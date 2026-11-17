import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import i18n from '@/lib/i18n'

import { AccidentDialog } from './AccidentDialog'

function renderDialog(vehicle: { id: number; plate_number: string } | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <AccidentDialog open onOpenChange={vi.fn()} vehicle={vehicle} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listVehicles').mockRejectedValue(new Error('offline'))
  vi.spyOn(api, 'listVehicleSites').mockResolvedValue([])
})

describe('AccidentDialog when the fleet list fails', () => {
  it('still opens the report for a fixed vehicle', async () => {
    renderDialog({ id: 42, plate_number: '58216' })
    expect(await screen.findByLabelText(new RegExp(i18n.t('vehicles.location')))).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers a retry instead of loading forever when the vehicle is chosen here', async () => {
    const user = userEvent.setup()
    renderDialog(null)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(i18n.t('common.loadError'))
    await user.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    await waitFor(() => expect(api.listVehicles).toHaveBeenCalledTimes(2))
  })
})
