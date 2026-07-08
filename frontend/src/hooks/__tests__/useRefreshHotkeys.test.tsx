import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRefreshHotkeys } from '../useRefreshHotkeys'

const wrap = (qc: QueryClient) =>
  function W({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }

function press(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { ...init, cancelable: true, bubbles: true })
  window.dispatchEvent(e)
  return e
}

describe('useRefreshHotkeys', () => {
  it('Alt+R triggers a soft refresh and is prevented', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    renderHook(() => useRefreshHotkeys(), { wrapper: wrap(qc) })
    const e = press({ code: 'KeyR', altKey: true })
    expect(spy).toHaveBeenCalledWith({ refetchType: 'active' })
    expect(e.defaultPrevented).toBe(true)
  })
  it('F5 is intercepted into a soft refresh', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    renderHook(() => useRefreshHotkeys(), { wrapper: wrap(qc) })
    const e = press({ code: 'F5' })
    expect(spy).toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(true)
  })
  it('Ctrl+Shift+R is left native (not prevented)', () => {
    const qc = new QueryClient()
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    renderHook(() => useRefreshHotkeys(), { wrapper: wrap(qc) })
    const e = press({ code: 'KeyR', ctrlKey: true, shiftKey: true })
    expect(e.defaultPrevented).toBe(false)
  })
})
