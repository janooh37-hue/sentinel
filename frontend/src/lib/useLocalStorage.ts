/**
 * useLocalStorage — minimal JSON-backed persistent state hook.
 *
 * Reads once at mount (lazy initializer) and writes back on every change.
 * Falls back to `defaultValue` if the stored value can't be parsed.
 *
 * Not isomorphic — pywebview is the only target, so `localStorage`
 * is always available.
 */

import { useCallback, useState } from 'react'

function read<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return defaultValue
    return JSON.parse(raw) as T
  } catch {
    return defaultValue
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Swallow quota / serialization errors — persistence is best-effort.
  }
}

export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  // Keep the active `key` inside state so a key change re-reads from the new
  // key during render (the React "derive state from props" pattern) instead of
  // persisting the previous key's value under the new key.
  const [state, setState] = useState<{ key: string; value: T }>(() => ({
    key,
    value: read(key, defaultValue),
  }))

  const value = state.key === key ? state.value : read(key, defaultValue)
  if (state.key !== key) {
    setState({ key, value })
  }

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setState((prev) => {
        const resolved =
          typeof next === 'function'
            ? (next as (p: T) => T)(prev.value)
            : next
        write(key, resolved)
        return { key, value: resolved }
      })
    },
    [key],
  )

  return [value, set]
}
