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
    listAwaitingBooks: vi.fn().mockResolvedValue([]),
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
  it('queries approvals with books.approve alone but not scan-back without books.view', async () => {
    const capabilities = ['books.approve', 'books.edit']
    const client = renderSignals(capabilities)
    await waitForCapabilities(client, capabilities)

    expect(api.listAwaitingBooks).toHaveBeenCalledOnce()
    expect(api.listAwaitingScanBooks).not.toHaveBeenCalled()
  })

  it('queries approvals and scan-back when each full capability pair is present', async () => {
    const capabilities = ['books.view', 'books.approve', 'books.edit']
    const client = renderSignals(capabilities)
    await waitForCapabilities(client, capabilities)

    expect(api.listAwaitingBooks).toHaveBeenCalledOnce()
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
