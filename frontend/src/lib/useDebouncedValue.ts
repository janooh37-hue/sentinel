import { useEffect, useState } from 'react'

/** Returns `value` delayed by `ms` — for debouncing search inputs before they
 *  drive a query. Resets the timer on every change, so only the last value in a
 *  burst of keystrokes propagates. */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}
