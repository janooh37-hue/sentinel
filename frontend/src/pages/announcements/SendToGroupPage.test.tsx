/**
 * SendToGroupPage tests — group listing flow.
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
vi.mock('../../lib/api', () => ({
  api: {
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
  vi.mocked(api.listGroups).mockResolvedValue([{ id: '1@g.us', name: 'Alpha' }])
})

describe('SendToGroupPage', () => {
  it('lists groups from the gateway', async () => {
    renderPage()
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
  })

  it('shows the empty state when no groups exist', async () => {
    vi.mocked(api.listGroups).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('sendToGroup.noGroups')).toBeInTheDocument()
  })
})
