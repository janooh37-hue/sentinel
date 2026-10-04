/**
 * Deferred-delete + undo (Gmail pattern). scheduleDelete hides the row
 * immediately and starts a timer; the destructive API call (onCommit) fires only
 * when the timer elapses, so Undo (via the injected notify's onUndo) simply
 * cancels it — no backend restore endpoint needed. flushAll commits anything
 * still pending; call it on unmount so a deferred delete is never silently lost.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface PendingDelete {
  id: number
}

export interface NotifyArgs<T extends PendingDelete = PendingDelete> {
  pending: T
  onUndo: () => void
}

interface UseDeferredDeleteOpts<T extends PendingDelete> {
  onCommit: (p: T) => Promise<void> | void
  /** Show the undo toast; wire its Undo action to `onUndo`. */
  notify: (args: NotifyArgs<T>) => void
  delayMs?: number
}

export function useDeferredDelete<T extends PendingDelete = PendingDelete>({
  onCommit,
  notify,
  delayMs = 6000,
}: UseDeferredDeleteOpts<T>): {
  pendingIds: Set<number>
  scheduleDelete: (p: T) => void
  flushAll: () => void
} {
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set())
  const timers = useRef(
    new Map<number, { timer: ReturnType<typeof setTimeout>; pending: T }>(),
  )

  // Keep the latest onCommit in a ref so commit/flushAll stay identity-stable.
  // Without this, an inline onCommit (new identity each render) would change
  // flushAll's identity, firing the unmount-flush effect's cleanup on EVERY
  // render and committing pending deletes immediately — killing the undo window.
  const onCommitRef = useRef(onCommit)
  useEffect(() => {
    onCommitRef.current = onCommit
  })

  const remove = useCallback((id: number) => {
    setPendingIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const commit = useCallback(
    (p: T) => {
      const rec = timers.current.get(p.id)
      if (rec) clearTimeout(rec.timer)
      timers.current.delete(p.id)
      remove(p.id)
      void onCommitRef.current(p)
    },
    [remove],
  )

  const undo = useCallback(
    (id: number) => {
      const rec = timers.current.get(id)
      if (rec) clearTimeout(rec.timer)
      timers.current.delete(id)
      remove(id)
    },
    [remove],
  )

  const scheduleDelete = useCallback(
    (pending: T) => {
      setPendingIds((prev) => new Set(prev).add(pending.id))
      // Re-scheduling an id that is already pending re-arms its timer.
      const existing = timers.current.get(pending.id)
      if (existing) clearTimeout(existing.timer)
      const timer = setTimeout(() => commit(pending), delayMs)
      timers.current.set(pending.id, { timer, pending })
      notify({ pending, onUndo: () => undo(pending.id) })
    },
    [commit, delayMs, notify, undo],
  )

  const flushAll = useCallback(() => {
    for (const { timer, pending } of timers.current.values()) {
      clearTimeout(timer)
      void onCommitRef.current(pending)
    }
    timers.current.clear()
    setPendingIds(new Set())
  }, [])

  // Flush on unmount so a deferred delete is never dropped on navigate away.
  useEffect(() => () => flushAll(), [flushAll])

  return { pendingIds, scheduleDelete, flushAll }
}
