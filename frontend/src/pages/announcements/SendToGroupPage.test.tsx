/**
 * SendToGroupPage tests — group listing flow + gateway status banner.
 *
 * Mirrors the harness in SupervisorDesignations.test.tsx:
 *   QueryClientProvider + i18n stub + vi.mock('../../lib/api') + sonner mock.
 */
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: Record<string, unknown>) => {
    if (opts && typeof opts.count === 'number') return `${k}:${opts.count}`
    return k
  }, i18n: { language: 'ar' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => false }),
}))
vi.mock('../../lib/api', () => ({
  api: {
    gatewayStatus: vi.fn().mockResolvedValue({ state: 'connected' }),
    listGroups: vi.fn().mockResolvedValue([{ id: '1@g.us', name: 'Alpha' }]),
    sendAnnouncement: vi.fn(),
  },
}))

import { api } from '../../lib/api'
import { SendToGroupPage } from './SendToGroupPage'

function renderPage(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <SendToGroupPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'connected' })
  vi.mocked(api.listGroups).mockResolvedValue([{ id: '1@g.us', name: 'Alpha' }])
})

describe('SendToGroupPage', () => {
  it('lists groups from the gateway when connected', async () => {
    renderPage()
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
  })

  it('shows the empty state when no groups exist (connected, empty list)', async () => {
    vi.mocked(api.listGroups).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('sendToGroup.noGroupsForNumber')).toBeInTheDocument()
  })

  // Case A: disconnected → blocked banner, no group list, Send disabled
  it('shows blocked banner when state is disconnected', async () => {
    vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'disconnected' })
    renderPage()
    expect(await screen.findByText('sendToGroup.gatewayDisconnected')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'sendToGroup.send' })).toBeDisabled()
  })

  // Case B: connected + empty groups → neutral noGroupsForNumber, NOT the blocked banner
  it('shows neutral empty message (not blocked banner) when connected but no groups', async () => {
    vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'connected' })
    vi.mocked(api.listGroups).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('sendToGroup.noGroupsForNumber')).toBeInTheDocument()
    expect(screen.queryByText('sendToGroup.gatewayDisconnected')).not.toBeInTheDocument()
    expect(screen.queryByText('sendToGroup.blockedTitle')).not.toBeInTheDocument()
  })

  it('shows blocked banner with gatewayDisabled message', async () => {
    vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'disabled' })
    renderPage()
    expect(await screen.findByText('sendToGroup.gatewayDisabled')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
  })

  it('shows blocked banner with gatewayUnreachable message', async () => {
    vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'unreachable' })
    renderPage()
    expect(await screen.findByText('sendToGroup.gatewayUnreachable')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
  })

  it('shows askAdmin copy (not reconnect button) when disconnected and non-admin', async () => {
    vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'disconnected' })
    renderPage()
    expect(await screen.findByText('sendToGroup.askAdmin')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'sendToGroup.reconnect' })).not.toBeInTheDocument()
  })
})
