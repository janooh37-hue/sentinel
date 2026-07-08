import { useEffect, useRef, useState } from 'react'
import { useIsFetching, type QueryClient } from '@tanstack/react-query'

export async function refreshAll(
  qc: QueryClient,
  opts: { minSpinMs?: number; ceilingMs?: number } = {},
): Promise<void> {
  const minSpinMs = opts.minSpinMs ?? 500
  const ceilingMs = opts.ceilingMs ?? 8000
  const start = performance.now()
  const invalidation = Promise.resolve(qc.invalidateQueries({ refetchType: 'active' }))
  const ceiling = new Promise<void>((r) => setTimeout(r, ceilingMs))
  await Promise.race([invalidation, ceiling])
  const remaining = minSpinMs - (performance.now() - start)
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining))
}

// NOTE (Milestone A): scaffolding only — nothing calls `setEditing` yet, so
// `isAnyEditing()` is always false and the heartbeat's "pause while editing"
// guard is currently inert. Editable forms hold drafts in react-hook-form
// (independent of the query cache), so a background refetch can't clobber them.
// Wire `setEditing` into dirty controlled-form surfaces in Milestone B.
const dirty = new Map<string, boolean>()
export const editingRegistry = {
  setEditing(id: string, isDirty: boolean): void {
    if (isDirty) dirty.set(id, true)
    else dirty.delete(id)
  },
  isAnyEditing(): boolean {
    return dirty.size > 0
  },
}

/** True while any query is fetching, latched for at least minVisibleMs so the top
 *  bar is always perceptible even on instant LAN fetches. */
export function useIsRefreshing(minVisibleMs = 450): boolean {
  const fetching = useIsFetching() > 0
  const [on, setOn] = useState(false)
  const onRef = useRef(false)
  const offAt = useRef(0)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    if (fetching) {
      offAt.current = performance.now() + minVisibleMs
      if (!onRef.current) {
        onRef.current = true
        setOn(true)
      }
    } else if (onRef.current) {
      const wait = Math.max(0, offAt.current - performance.now())
      t = setTimeout(() => {
        onRef.current = false
        setOn(false)
      }, wait)
    }
    return () => {
      if (t) clearTimeout(t)
    }
  }, [fetching, minVisibleMs])
  return on
}
