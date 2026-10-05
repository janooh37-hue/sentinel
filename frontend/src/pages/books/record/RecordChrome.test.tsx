import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  FOCUS_STORAGE_KEY,
  RAIL_STORAGE_KEY,
  RecordChromeProvider,
  useRecordChrome,
} from './RecordChrome'

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <RecordChromeProvider>{children}</RecordChromeProvider>
)

describe('RecordChrome', () => {
  const originalWidth = window.innerWidth
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  afterEach(() => setWidth(originalWidth))

  it('toggleRail below 1280 opens the overlay drawer and leaves the rail alone', () => {
    setWidth(1179)
    const { result } = renderHook(() => useRecordChrome(), { wrapper })
    expect(result.current.railDrawerOpen).toBe(false)
    act(() => result.current.toggleRail())
    expect(result.current.railDrawerOpen).toBe(true)
    expect(result.current.rail).toBe('open')
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBeNull()
    act(() => result.current.closeRailDrawer())
    expect(result.current.railDrawerOpen).toBe(false)
    act(() => result.current.toggleRail())
    act(() => result.current.toggleRail())
    expect(result.current.railDrawerOpen).toBe(false)
  })

  it('toggleRail from 1280 flips and persists the rail, defaulting open', () => {
    setWidth(1440)
    const { result, unmount } = renderHook(() => useRecordChrome(), { wrapper })
    expect(result.current.rail).toBe('open')
    act(() => result.current.toggleRail())
    expect(result.current.rail).toBe('closed')
    expect(result.current.railDrawerOpen).toBe(false)
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe('closed')
    unmount()
    const again = renderHook(() => useRecordChrome(), { wrapper })
    expect(again.result.current.rail).toBe('closed')
    act(() => again.result.current.toggleRail())
    expect(again.result.current.rail).toBe('open')
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe('open')
  })

  it('focus survives a remount within the session; fullscreen does not persist', () => {
    const first = renderHook(() => useRecordChrome(), { wrapper })
    expect(first.result.current.focus).toBe(false)
    act(() => {
      first.result.current.setFocus(true)
      first.result.current.setFullscreen(true)
    })
    expect(window.sessionStorage.getItem(FOCUS_STORAGE_KEY)).toBe('1')
    first.unmount()
    const second = renderHook(() => useRecordChrome(), { wrapper })
    expect(second.result.current.focus).toBe(true)
    expect(second.result.current.fullscreen).toBe(false)
    act(() => second.result.current.setFocus(false))
    expect(window.sessionStorage.getItem(FOCUS_STORAGE_KEY)).toBeNull()
  })

  it('entering focus mode closes the rail drawer so the first Esc is not spent on an invisible one', () => {
    setWidth(1024)
    const { result } = renderHook(() => useRecordChrome(), { wrapper })
    act(() => result.current.toggleRail())
    expect(result.current.railDrawerOpen).toBe(true)
    act(() => result.current.setFocus(true))
    expect(result.current.railDrawerOpen).toBe(false)
    act(() => result.current.setFocus(false))
    expect(result.current.railDrawerOpen).toBe(false)
  })

  it('throws outside the provider', () => {
    function Probe(): null {
      useRecordChrome()
      return null
    }
    expect(() => render(<Probe />)).toThrow(/RecordChromeProvider/)
  })
})
