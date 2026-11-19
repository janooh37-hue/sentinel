import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { has, listAttendanceDay } = vi.hoisted(() => ({ has: vi.fn<(cap: string) => boolean>(), listAttendanceDay: vi.fn() }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has, isLoading: false }) }))
vi.mock('@/lib/api', () => ({ api: { listAttendanceDay } }))

import { useAttendanceAttention } from './useAttendanceAttention'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  has.mockReturnValue(true)
  listAttendanceDay.mockResolvedValue({ items: [], next_cursor: null })
})

describe('useAttendanceAttention', () => {
  it.each(['workforce.people.view', 'workforce.attendance.review'])(
    'does not fetch or expose an attention badge without %s',
    (denied) => {
      has.mockImplementation((cap) => cap !== denied)
      const { result } = renderHook(() => useAttendanceAttention('2026-11-18'), { wrapper })
      expect(result.current.allowed).toBe(false)
      expect(result.current.attention).toBeNull()
      expect(listAttendanceDay).not.toHaveBeenCalled()
    },
  )

  it('fetches when both roster capabilities are held', async () => {
    const { result } = renderHook(() => useAttendanceAttention('2026-11-18'), { wrapper })
    await waitFor(() => expect(result.current.attention).toBe(0))
    expect(result.current.allowed).toBe(true)
    expect(listAttendanceDay).toHaveBeenCalledWith({ operational_date: '2026-11-18', limit: 500 })
  })
})
