import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IDLE_LOCK_MS, markActivity, useLockState } from './useLockState'

const START = new Date('2026-08-28T10:00:00.000Z')
const ACTIVITY_KEY = 'gssg.lastActivity'
const LOCK_KEY = 'gssg.locked'

function renderEnabled(enabled = true) {
  return renderHook(({ active }) => useLockState(active), {
    initialProps: { active: enabled },
  })
}

describe('useLockState idle locking', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('locks after 30 minutes without activity', () => {
    const { result } = renderEnabled()

    act(() => vi.advanceTimersByTime(IDLE_LOCK_MS))

    expect(result.current.locked).toBe(true)
    expect(sessionStorage.getItem(LOCK_KEY)).toBe('1')
  })

  it('uses newer in-memory activity when the throttled storage write lags', () => {
    const { result } = renderEnabled()
    act(() => vi.advanceTimersByTime(10_000))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })))

    expect(localStorage.getItem(ACTIVITY_KEY)).toBe(String(START.getTime()))

    act(() => vi.advanceTimersByTime(IDLE_LOCK_MS - 10_000))
    expect(result.current.locked).toBe(false)

    act(() => vi.advanceTimersByTime(30_000))
    expect(result.current.locked).toBe(true)
  })

  it('defers locking when keyboard activity occurs before the deadline', () => {
    const { result } = renderEnabled()

    act(() => vi.advanceTimersByTime(29 * 60_000))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })))
    act(() => vi.advanceTimersByTime(2 * 60_000))

    expect(result.current.locked).toBe(false)

    act(() => vi.advanceTimersByTime(29 * 60_000))

    expect(result.current.locked).toBe(true)
  })

  it('locks immediately when enabled with activity older than 30 minutes', () => {
    localStorage.setItem(ACTIVITY_KEY, String(START.getTime() - 31 * 60_000))

    const { result } = renderEnabled()
    act(() => vi.advanceTimersByTime(0))

    expect(result.current.locked).toBe(true)
  })

  it('stays unlocked when enabled with recent activity', () => {
    localStorage.setItem(ACTIVITY_KEY, String(START.getTime() - 5 * 60_000))

    const { result } = renderEnabled()

    expect(result.current.locked).toBe(false)
  })

  it('seeds missing activity without locking on first enable', () => {
    const { result } = renderEnabled()

    expect(result.current.locked).toBe(false)
    expect(localStorage.getItem(ACTIVITY_KEY)).toBe(String(START.getTime()))
  })

  it('refreshes activity and clears the persisted lock when unlocked', () => {
    sessionStorage.setItem(LOCK_KEY, '1')
    localStorage.setItem(ACTIVITY_KEY, String(START.getTime() - IDLE_LOCK_MS))
    const { result } = renderEnabled()
    vi.setSystemTime(new Date(START.getTime() + 5_000))

    act(() => result.current.unlock())

    expect(result.current.locked).toBe(false)
    expect(sessionStorage.getItem(LOCK_KEY)).toBeNull()
    expect(localStorage.getItem(ACTIVITY_KEY)).toBe(String(START.getTime() + 5_000))
  })

  it('does not record activity while locked', () => {
    sessionStorage.setItem(LOCK_KEY, '1')
    const previous = String(START.getTime() - 60_000)
    localStorage.setItem(ACTIVITY_KEY, previous)
    renderEnabled()

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })))

    expect(localStorage.getItem(ACTIVITY_KEY)).toBe(previous)
  })

  it('does not seed activity or lock while disabled', () => {
    const { result } = renderEnabled(false)

    act(() => vi.advanceTimersByTime(IDLE_LOCK_MS * 2))

    expect(result.current.locked).toBe(false)
    expect(localStorage.getItem(ACTIVITY_KEY)).toBeNull()
  })

  it('checks the stored deadline when transitioning from disabled to enabled', () => {
    const { result, rerender } = renderEnabled(false)
    localStorage.setItem(ACTIVITY_KEY, String(START.getTime() - 31 * 60_000))

    rerender({ active: true })
    act(() => vi.advanceTimersByTime(0))

    expect(result.current.locked).toBe(true)
  })

  it('markActivity stores the current timestamp', () => {
    markActivity()

    expect(localStorage.getItem(ACTIVITY_KEY)).toBe(String(START.getTime()))
  })
})
