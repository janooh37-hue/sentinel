/**
 * The on-screen keyboard does not fire window.resize on iOS, so the composer
 * has to read visualViewport. This hook is the seam; it returns how many px of
 * the layout viewport the keyboard is covering.
 */
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { useKeyboardInset } from './useKeyboardInset'

interface FakeVV extends EventTarget {
  height: number
  offsetTop: number
}

let vv: FakeVV

function setViewport(height: number, offsetTop = 0): void {
  vv.height = height
  vv.offsetTop = offsetTop
  vv.dispatchEvent(new Event('resize'))
}

beforeEach(() => {
  window.innerHeight = 844
  vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 }) as FakeVV
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport')
})

describe('useKeyboardInset', () => {
  it('is 0 with the keyboard closed', () => {
    const { result } = renderHook(() => useKeyboardInset())
    expect(result.current).toBe(0)
  })

  it('reports the covered px when the keyboard opens', () => {
    const { result } = renderHook(() => useKeyboardInset())
    act(() => setViewport(508)) // iPhone keyboard ≈ 336px
    expect(result.current).toBe(336)
  })

  it('accounts for offsetTop when the visual viewport is scrolled', () => {
    const { result } = renderHook(() => useKeyboardInset())
    act(() => setViewport(508, 20))
    expect(result.current).toBe(316)
  })

  it('returns to 0 when the keyboard closes', () => {
    const { result } = renderHook(() => useKeyboardInset())
    act(() => setViewport(508))
    act(() => setViewport(844))
    expect(result.current).toBe(0)
  })

  it('also updates on visualViewport scroll (iOS fires scroll, not resize)', () => {
    const { result } = renderHook(() => useKeyboardInset())
    act(() => {
      vv.height = 508
      vv.dispatchEvent(new Event('scroll'))
    })
    expect(result.current).toBe(336)
  })

  it('is 0 when visualViewport is unavailable', () => {
    Reflect.deleteProperty(window, 'visualViewport')
    const { result } = renderHook(() => useKeyboardInset())
    expect(result.current).toBe(0)
  })
})
