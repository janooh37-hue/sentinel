import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDeferredDelete, type NotifyArgs } from './useDeferredDelete'

type Commit = (p: { id: number }) => Promise<void> | void

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function setup(onCommit = vi.fn<Commit>()) {
  const dismiss = vi.fn()
  const undos: (() => boolean)[] = []
  const notify = vi.fn(({ onUndo }: NotifyArgs) => {
    undos.push(onUndo)
    return dismiss
  })
  const hook = renderHook(() => useDeferredDelete({ onCommit, notify }))
  return { ...hook, onCommit, dismiss, undos }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useDeferredDelete', () => {
  it('onUndo cancels a live timer and returns true; nothing commits, nothing is dismissed', () => {
    const { result, onCommit, dismiss, undos } = setup()
    act(() => result.current.scheduleDelete({ id: 1 }))
    expect(result.current.pendingIds.has(1)).toBe(true)
    let cancelled = false
    act(() => {
      cancelled = undos[0]()
    })
    expect(cancelled).toBe(true)
    expect(result.current.pendingIds.has(1)).toBe(false)
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(onCommit).not.toHaveBeenCalled()
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('onUndo returns false once the item has committed; the toast was dismissed with the commit', () => {
    const { result, onCommit, dismiss, undos } = setup()
    act(() => result.current.scheduleDelete({ id: 1 }))
    act(() => {
      vi.advanceTimersByTime(6_000)
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(dismiss).toHaveBeenCalledTimes(1)
    let cancelled = true
    act(() => {
      cancelled = undos[0]()
    })
    expect(cancelled).toBe(false)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('keeps the id pending until onCommit settles, then releases it', async () => {
    const gate = deferred()
    const { result } = setup(vi.fn<Commit>(() => gate.promise))
    act(() => result.current.scheduleDelete({ id: 1 }))
    act(() => {
      vi.advanceTimersByTime(6_000)
    })
    expect(result.current.pendingIds.has(1)).toBe(true)
    await act(async () => {
      gate.resolve()
    })
    expect(result.current.pendingIds.has(1)).toBe(false)
  })

  it('flushAll commits at once, dismisses, and keeps the ids pending until the commits settle', async () => {
    const gate = deferred()
    const onCommit = vi.fn<Commit>(() => gate.promise)
    const { result, dismiss } = setup(onCommit)
    act(() => {
      result.current.scheduleDelete({ id: 1 })
      result.current.scheduleDelete({ id: 2 })
    })
    act(() => result.current.flushAll())
    expect(onCommit).toHaveBeenCalledTimes(2)
    expect(dismiss).toHaveBeenCalledTimes(2)
    expect(result.current.pendingIds).toEqual(new Set([1, 2]))
    await act(async () => {
      gate.resolve()
    })
    expect(result.current.pendingIds.size).toBe(0)
  })

  it('unmount commits pending deletes once and dismisses their toasts', () => {
    const { result, unmount, onCommit, dismiss } = setup()
    act(() => result.current.scheduleDelete({ id: 1 }))
    unmount()
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith({ id: 1 })
    expect(dismiss).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('re-scheduling a pending id re-arms it: the old toast is dismissed and only the new Undo is live', () => {
    const { result, onCommit, dismiss, undos } = setup()
    act(() => result.current.scheduleDelete({ id: 1 }))
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    act(() => result.current.scheduleDelete({ id: 1 }))
    expect(dismiss).toHaveBeenCalledTimes(1)
    let first = true
    act(() => {
      first = undos[0]()
    })
    expect(first).toBe(false)
    act(() => {
      vi.advanceTimersByTime(5_999)
    })
    expect(onCommit).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
})
