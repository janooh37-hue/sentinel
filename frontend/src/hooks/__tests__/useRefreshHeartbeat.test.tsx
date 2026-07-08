import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRefreshHeartbeat } from '../useRefreshHeartbeat'
import { editingRegistry } from '../../lib/globalRefresh'

const wrap = (qc: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }

describe('useRefreshHeartbeat', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('invalidates on each interval when idle & visible', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    renderHook(() => useRefreshHeartbeat(1000), { wrapper: wrap(qc) })
    vi.advanceTimersByTime(1000)
    expect(spy).toHaveBeenCalledWith({ refetchType: 'active' })
  })
  it('skips when a form is being edited', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    editingRegistry.setEditing('form', true)
    renderHook(() => useRefreshHeartbeat(1000), { wrapper: wrap(qc) })
    vi.advanceTimersByTime(1000)
    expect(spy).not.toHaveBeenCalled()
    editingRegistry.setEditing('form', false)
  })
})
