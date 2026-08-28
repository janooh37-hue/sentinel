import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({
  api: {
    getScanInboxCount: vi.fn().mockResolvedValue({ total: 4 }),
  },
}))

import { api } from '@/lib/api'
import { useScanInboxCount } from './useScanInboxCount'

function wrapper({ children }: PropsWithChildren): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
})

it('does not query the scan inbox when disabled', async () => {
  const { result } = renderHook(() => useScanInboxCount(false), { wrapper })

  expect(result.current).toBe(0)
  await waitFor(() => expect(api.getScanInboxCount).not.toHaveBeenCalled())
})

it('queries and returns the scan inbox count when enabled', async () => {
  const { result } = renderHook(() => useScanInboxCount(true), { wrapper })

  await waitFor(() => expect(result.current).toBe(4))
  expect(api.getScanInboxCount).toHaveBeenCalledOnce()
})
