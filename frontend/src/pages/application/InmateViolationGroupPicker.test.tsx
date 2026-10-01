import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ar' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap === 'messages.broadcast' }),
}))
vi.mock('../../lib/api', () => ({
  api: {
    gatewayStatus: vi.fn(),
    listGroups: vi.fn(),
    getInmateViolationGroup: vi.fn(),
    setInmateViolationGroup: vi.fn(),
  },
}))

import { api } from '../../lib/api'
import { InmateViolationGroupPicker } from './InmateViolationGroupPicker'

function renderPicker(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <InmateViolationGroupPicker />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'connected' })
  vi.mocked(api.listGroups).mockResolvedValue([
    { id: '1@g.us', name: 'Alpha' },
    { id: '2@g.us', name: 'Bravo' },
  ])
  vi.mocked(api.getInmateViolationGroup).mockResolvedValue({ group: null })
})

describe('InmateViolationGroupPicker', () => {
  it('shows the not-connected state with sending off and the picker disabled', async () => {
    vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'disabled' })
    renderPicker()
    expect(await screen.findByText('application.violationWhatsApp.notConnected')).toBeInTheDocument()
    const select = screen.getByRole('combobox', { name: 'application.violationWhatsApp.label' })
    await waitFor(() => expect(select).toBeDisabled())
    expect(select).toHaveValue('')
    expect(api.listGroups).not.toHaveBeenCalled()
  })

  it('lets a configured group be turned off while not connected', async () => {
    vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'disconnected' })
    vi.mocked(api.getInmateViolationGroup).mockResolvedValue({ group: { id: '1@g.us', name: 'Alpha' } })
    vi.mocked(api.setInmateViolationGroup).mockResolvedValue({ group: null })
    renderPicker()
    const select = screen.getByRole('combobox', { name: 'application.violationWhatsApp.label' })
    await waitFor(() => expect(select).toHaveValue('1@g.us'))
    await userEvent.selectOptions(select, '')
    await waitFor(() => expect(api.setInmateViolationGroup).toHaveBeenCalledWith(null))
    await waitFor(() => expect(select).toHaveValue(''))
  })

  it('saves the selected group and reflects it', async () => {
    vi.mocked(api.setInmateViolationGroup).mockResolvedValue({ group: { id: '2@g.us', name: 'Bravo' } })
    renderPicker()
    await screen.findByRole('option', { name: 'Bravo' })
    const select = screen.getByRole('combobox', { name: 'application.violationWhatsApp.label' })
    expect(screen.getByText('application.violationWhatsApp.hint')).toBeInTheDocument()
    await userEvent.selectOptions(select, '2@g.us')
    await waitFor(() => expect(api.setInmateViolationGroup).toHaveBeenCalledWith('2@g.us'))
    await waitFor(() => expect(select).toHaveValue('2@g.us'))
  })
})
