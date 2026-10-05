/**
 * Deferred-delete + undo (Gmail pattern). scheduleDelete hides the row
 * immediately and starts a timer; the destructive API call (onCommit) fires only
 * when the timer elapses, so Undo (via the injected notify's onUndo) simply
 * cancels it — no backend restore endpoint needed.
 *
 * Lifecycle:
 * - Undo: `onUndo()` returns true only if it cancelled a still-live timer; once
 *   the item has committed it returns false, so the caller can say "too late"
 *   instead of claiming a restore that did not happen.
 * - Commit (timer elapsed, or flushAll): the `dismiss` that `notify` returned is
 *   called, so the Undo toast never outlives the commit. The id stays in
 *   `pendingIds` until onCommit settles (success or failure), so a row does not
 *   flash back before the caller's refetch lands — await it inside onCommit.
 * - Unmounting the hook's owner flushes: pending deletes commit at once (and
 *   their toasts are dismissed) so nothing is silently lost on navigate-away.
 * - Closing or reloading the tab is the opposite: the timers die with the page
 *   and nothing is sent, so a pending delete is cancelled and the record survives.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface PendingDelete {
  id: number
}

export interface NotifyArgs<T extends PendingDelete = PendingDelete> {
  pending: T
  /** Cancel the delete. True only if a still-live timer was cancelled; false
   *  once the item has committed (or was never pending). */
  onUndo: () => boolean
}

interface UseDeferredDeleteOpts<T extends PendingDelete> {
  /** The destructive call. The id stays in `pendingIds` until a returned promise settles. */
  onCommit: (p: T) => Promise<void> | void
  /** Show the undo toast; wire its Undo action to `onUndo`. May return a
   *  `dismiss` that closes the toast; it is called once when the item commits
   *  (timer or flush), never on undo. */
  notify: (args: NotifyArgs<T>) => (() => void) | void
  delayMs?: number
}

interface Scheduled<T extends PendingDelete> {
  timer: ReturnType<typeof setTimeout>
  pending: T
  dismiss?: () => void
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
  const timers = useRef(new Map<number, Scheduled<T>>())
  // Committed deletes whose onCommit has not settled yet, per id.
  const inFlight = useRef(new Map<number, number>())

  // Keep the latest onCommit in a ref so commit/flushAll stay identity-stable.
  // Without this, an inline onCommit (new identity each render) would change
  // flushAll's identity, firing the unmount-flush effect's cleanup on EVERY
  // render and committing pending deletes immediately — killing the undo window.
  const onCommitRef = useRef(onCommit)
  useEffect(() => {
    onCommitRef.current = onCommit
  })

  // Un-hide an id once nothing is pending for it: no live timer, no commit in flight.
  const release = useCallback((id: number) => {
    if (timers.current.has(id) || inFlight.current.has(id)) return
    setPendingIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const run = useCallback(
    (pending: T) => {
      const { id } = pending
      inFlight.current.set(id, (inFlight.current.get(id) ?? 0) + 1)
      const settle = (): void => {
        const left = (inFlight.current.get(id) ?? 1) - 1
        if (left > 0) inFlight.current.set(id, left)
        else inFlight.current.delete(id)
        release(id)
      }
      // The executor runs synchronously, so onCommit starts now; a synchronous
      // throw becomes a rejection and still releases the id.
      void new Promise<void>((resolve) => resolve(onCommitRef.current(pending))).finally(settle)
    },
    [release],
  )

  const commit = useCallback(
    (rec: Scheduled<T>) => {
      clearTimeout(rec.timer)
      timers.current.delete(rec.pending.id)
      rec.dismiss?.()
      run(rec.pending)
    },
    [run],
  )

  const undo = useCallback(
    (rec: Scheduled<T>): boolean => {
      const { id } = rec.pending
      // Only the item's own live timer may be cancelled: a committed or
      // superseded (re-armed) item reports false.
      if (timers.current.get(id) !== rec) return false
      clearTimeout(rec.timer)
      timers.current.delete(id)
      release(id)
      return true
    },
    [release],
  )

  const scheduleDelete = useCallback(
    (pending: T) => {
      setPendingIds((prev) => new Set(prev).add(pending.id))
      // Re-scheduling an id that is already pending re-arms its timer; the
      // superseded item's toast gives way to the new one.
      const existing = timers.current.get(pending.id)
      if (existing) {
        clearTimeout(existing.timer)
        existing.dismiss?.()
      }
      const rec: Scheduled<T> = { pending, timer: setTimeout(() => commit(rec), delayMs) }
      timers.current.set(pending.id, rec)
      const dismiss = notify({ pending, onUndo: () => undo(rec) })
      if (typeof dismiss === 'function') rec.dismiss = dismiss
    },
    [commit, delayMs, notify, undo],
  )

  const flushAll = useCallback(() => {
    // Ids stay pending until their commit settles (see `run`).
    for (const rec of [...timers.current.values()]) commit(rec)
  }, [commit])

  // Flush on unmount so a deferred delete is never dropped on navigate away.
  useEffect(() => () => flushAll(), [flushAll])

  return { pendingIds, scheduleDelete, flushAll }
}
