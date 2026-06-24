/**
 * App lock state — single-user, single-machine.
 *
 * The lock state is stored in sessionStorage so it survives in-app reloads but
 * NOT a process restart (closing the window restores the unlocked default,
 * which matches the v3 "trust the desktop session" model).
 *
 * The hook exposes a boolean + lock()/unlock() actions. Verification is done
 * by the caller against the /auth/verify-password endpoint.
 */

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'gssg.locked'

function readInitial(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function useLockState(): {
  locked: boolean
  lock: () => void
  unlock: () => void
} {
  const [locked, setLocked] = useState<boolean>(readInitial)

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
      // ignore
    }
    setLocked(true)
  }, [])

  const unlock = useCallback(() => {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    setLocked(false)
  }, [])

  return { locked, lock, unlock }
}
