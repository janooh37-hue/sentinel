import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ status: 'authed' }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    myCapabilities: vi.fn(),
    getApprovalSummary: vi.fn().mockResolvedValue({
      can_view_sent: false,
      available_received_kinds: [],
      signature: { count: 0, oldest: null },
      review: { count: 0, oldest: null },
      sent: { count: 0, oldest: null },
      returned_count: 0,
      actionable_count: 0,
    }),
    listAwaitingScanBooks: vi.fn().mockResolvedValue([]),
    getLedgerUnreadRecent: vi.fn().mockResolvedValue({ items: [], total_unread: 0 }),
  },
}))

import { api } from '@/lib/api'
import { useWaitingSignals } from './useWaitingSignals'

function renderSignals(capabilities: string[]): QueryClient {
  vi.mocked(api.myCapabilities).mockResolvedValue(capabilities as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren): React.JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  renderHook(() => useWaitingSignals(true), { wrapper })
  return client
}

async function waitForCapabilities(client: QueryClient, capabilities: string[]): Promise<void> {
  await waitFor(() => expect(client.getQueryData(['my-capabilities'])).toEqual(capabilities))
  await waitFor(() => expect(client.isFetching()).toBe(0))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useWaitingSignals permission matrix', () => {
  it('always queries the assignment-aware approvals summary once authenticated — no capability gate', async () => {
    const capabilities: string[] = []
    const client = renderSignals(capabilities)
    await waitForCapabilities(client, capabilities)

    // Never gated behind books.approve: a review-only user's late feedback
    // is just as actionable as a signer's pending decision.
    expect(api.getApprovalSummary).toHaveBeenCalledOnce()
  })

  it('queries scan-back only when both books.view and books.edit are present', async () => {
    const withoutEdit = ['books.view']
    const deniedClient = renderSignals(withoutEdit)
    await waitForCapabilities(deniedClient, withoutEdit)
    expect(api.listAwaitingScanBooks).not.toHaveBeenCalled()

    vi.clearAllMocks()
    const withEdit = ['books.view', 'books.edit']
    const allowedClient = renderSignals(withEdit)
    await waitForCapabilities(allowedClient, withEdit)
    expect(api.listAwaitingScanBooks).toHaveBeenCalledWith('mine')
  })

  it('requires ledger.view for the unread-ledger query', async () => {
    const deniedCapabilities: string[] = []
    const deniedClient = renderSignals(deniedCapabilities)
    await waitForCapabilities(deniedClient, deniedCapabilities)
    expect(api.getLedgerUnreadRecent).not.toHaveBeenCalled()

    vi.clearAllMocks()
    const allowedCapabilities = ['ledger.view']
    const allowedClient = renderSignals(allowedCapabilities)
    await waitForCapabilities(allowedClient, allowedCapabilities)
    expect(api.getLedgerUnreadRecent).toHaveBeenCalledOnce()
  })
})
