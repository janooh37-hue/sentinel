/**
 * App privacy-lock state for a shared desktop session.
 *
 * The explicit lock flag lives in sessionStorage so an in-app reload stays
 * locked. The last activity timestamp lives in localStorage so closing and
 * reopening the window after a long idle period still requires re-verification.
 *
 * Verification remains the caller's responsibility through
 * /auth/verify-password.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'gssg.locked'
const ACTIVITY_KEY = 'gssg.lastActivity'

export const DEFAULT_IDLE_LOCK_SECONDS = 1800
export const LOCK_TIMER_OPTIONS = [30, 60, 120, 300, 900, 1800] as const
export type LockTimerSeconds = (typeof LOCK_TIMER_OPTIONS)[number]

export const LOCK_LAYOUTS = ['band', 'stack', 'console'] as const
export type LockLayout = (typeof LOCK_LAYOUTS)[number]

function readInitial(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function readActivity(): number | null {
  try {
    const value = window.localStorage.getItem(ACTIVITY_KEY)
    if (value === null) return null
    const timestamp = Number(value)
    return Number.isFinite(timestamp) ? timestamp : null
  } catch {
    return null
  }
}

function writeActivity(timestamp: number): void {
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(timestamp))
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

export function markActivity(): number {
  const timestamp = Date.now()
  writeActivity(timestamp)
  return timestamp
}

export function useLockState(enabled: boolean, timeoutMs: number): {
  locked: boolean
  lock: () => void
  unlock: () => void
} {
  const [locked, setLocked] = useState<boolean>(readInitial)
  const lastActivityRef = useRef<number | null>(null)
  const lastStorageWriteRef = useRef<number | null>(null)
  const wasEnabledRef = useRef(false)
  const writeThrottleMs = Math.min(15_000, Math.floor(timeoutMs / 4))
  const checkIntervalMs = Math.min(30_000, Math.max(5_000, Math.floor(timeoutMs / 6)))

  // Sync changes from other tabs / programmatic writes.
  useEffect(() => {
    function onStorage(e: StorageEvent): void {
      if (e.key === STORAGE_KEY) setLocked(e.newValue === '1')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const lock = useCallback(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
    setLocked(true)
  }, [])

  const unlock = useCallback(() => {
    const timestamp = markActivity()
    lastActivityRef.current = timestamp
    lastStorageWriteRef.current = timestamp
    try {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
    setLocked(false)
  }, [])

  useEffect(() => {
    if (!enabled) {
      wasEnabledRef.current = false
      return
    }
    if (wasEnabledRef.current) return
    wasEnabledRef.current = true

    const now = Date.now()
    const stored = readActivity()
    if (stored === null) {
      const timestamp = markActivity()
      lastActivityRef.current = timestamp
      lastStorageWriteRef.current = timestamp
      return
    }

    lastActivityRef.current = stored
    lastStorageWriteRef.current = stored
    if (now - stored >= timeoutMs) {
      const timeout = window.setTimeout(lock, 0)
      return () => window.clearTimeout(timeout)
    }
  }, [enabled, lock, timeoutMs])

  useEffect(() => {
    if (!enabled || locked) return

    function recordActivity(): void {
      const now = Date.now()
      lastActivityRef.current = now
      const lastWrite = lastStorageWriteRef.current
      if (lastWrite === null || now - lastWrite >= writeThrottleMs) {
        writeActivity(now)
        lastStorageWriteRef.current = now
      }
    }

    const events: Array<keyof WindowEventMap> = [
      'pointerdown',
      'keydown',
      'wheel',
      'touchstart',
    ]
    const options: AddEventListenerOptions = { capture: true, passive: true }
    for (const event of events) window.addEventListener(event, recordActivity, options)

    return () => {
      for (const event of events) window.removeEventListener(event, recordActivity, options)
    }
  }, [enabled, locked, writeThrottleMs])

  useEffect(() => {
    if (!enabled || locked) return

    function checkDeadline(): void {
      const stored = readActivity()
      const inMemory = lastActivityRef.current
      const lastActivity =
        stored === null ? inMemory : inMemory === null ? stored : Math.max(stored, inMemory)
      if (lastActivity !== null && Date.now() - lastActivity >= timeoutMs) lock()
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === 'visible') checkDeadline()
    }

    const interval = window.setInterval(checkDeadline, checkIntervalMs)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [checkIntervalMs, enabled, locked, lock, timeoutMs])

  return { locked, lock, unlock }
}
