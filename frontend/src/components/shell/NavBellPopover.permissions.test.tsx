import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>() }))
const awaitingReturnCount = vi.hoisted(() => vi.fn((enabled: boolean) => (enabled ? 3 : 0)))
const flagCount = vi.hoisted(() => vi.fn((enabled: boolean) => (enabled ? 4 : 0)))
const scanBack = vi.hoisted(() => vi.fn((_scope: string, enabled: boolean) => ({
  books: [],
  isLoading: false,
  count: enabled ? 2 : 0,
  enabled,
})))

vi.mock('@/lib/api', () => ({
  api: {
    getLedgerUnreadRecent: vi.fn().mockResolvedValue({ items: [], total_unread: 0 }),
    listAuthUsers: vi.fn().mockResolvedValue([]),
    getExpirySummary: vi.fn().mockResolvedValue({ urgent: 1 }),
    listAwaitingBooks: vi.fn().mockResolvedValue([{}]),
    markAllLedgerRead: vi.fn().mockResolvedValue(undefined),
  },
  apiErrorMessage: (error: unknown) => String(error),
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: capabilityState.allowed,
    isLoading: false,
    has: (capability: string) => capabilityState.allowed.has(capability),
  }),
}))
vi.mock('@/lib/useIdentity', () => ({ useIdentity: () => ({ isAdmin: false }) }))
vi.mock('@/pages/leaves/useAwaitingReturnCount', () => ({
  useAwaitingReturnCount: (enabled: boolean) => awaitingReturnCount(enabled),
}))
vi.mock('@/pages/ledger/outlook/useFlagCount', () => ({
  useFlagCount: (enabled: boolean) => flagCount(enabled),
}))
vi.mock('@/pages/scanBack/useScanBack', () => ({
  useScanBack: (scope: string, enabled: boolean) => scanBack(scope, enabled),
}))
vi.mock('@/pages/scanInbox/useScanInboxCount', () => ({ useScanInboxCount: () => 0 }))

import { api } from '@/lib/api'
import { NavBellPopover } from './NavBellPopover'

beforeEach(() => {
  vi.clearAllMocks()
  capabilityState.allowed = new Set(['books.approve', 'employees.view'])
})

it('does not query or render denied ledger, books, expiry, or leaves notifications', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NavBellPopover />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  await waitFor(() => {
    expect(api.getLedgerUnreadRecent).not.toHaveBeenCalled()
    expect(api.listAwaitingBooks).not.toHaveBeenCalled()
    expect(api.getExpirySummary).not.toHaveBeenCalled()
  })
  expect(flagCount).toHaveBeenCalledWith(false)
  expect(awaitingReturnCount).toHaveBeenCalledWith(false)
  expect(scanBack).toHaveBeenCalledWith('mine', false)

  await userEvent.click(screen.getByRole('button', { name: /notification/i }))
  expect(screen.queryByText('Awaiting your approval')).not.toBeInTheDocument()
  expect(screen.queryByText('Expiring documents')).not.toBeInTheDocument()
  expect(screen.queryByText('Awaiting return form')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /View all in inbox/i })).not.toBeInTheDocument()
})
