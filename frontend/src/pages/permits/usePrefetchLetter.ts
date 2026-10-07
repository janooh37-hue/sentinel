import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { permitBookQuery } from './permitUtils'

export interface PrefetchHandlers {
  onPointerEnter: () => void
  onPointerLeave: () => void
  onFocus: () => void
}

const HOVER_INTENT_MS = 150

/**
 * Warms the quick view's letter (`GET /books/{id}`) for a register row. Focus
 * prefetches at once; hover only after the pointer rests ~150 ms, so sweeping
 * the mouse across the list doesn't fire a request per row crossed. One timer
 * per register: the pointer is only ever over one row.
 */
export function usePrefetchLetter(): (bookId: number | null | undefined) => PrefetchHandlers {
  const qc = useQueryClient()
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (bookId) => {
    const prefetch = (): void => {
      if (bookId) void qc.prefetchQuery({ ...permitBookQuery(bookId), staleTime: 30_000 })
    }
    return {
      onPointerEnter: () => {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(prefetch, HOVER_INTENT_MS)
      },
      onPointerLeave: () => window.clearTimeout(timer.current),
      onFocus: prefetch,
    }
  }
}
