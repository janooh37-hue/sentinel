/**
 * RecordDeleteProvider — the one deferred-delete service for records.
 *
 * Mounted in App.tsx ABOVE the routes, because the record page navigates away
 * right after scheduling: the 6 s timer and its Undo toast must outlive the
 * page that scheduled them.
 *
 * `scheduleDelete` hides the rows at once (`pendingIds`) and shows ONE toast
 * for the batch with an Undo action. The destructive `DELETE /books/{id}` fires
 * only when the 6 s timer elapses; Undo just cancels it, so no restore endpoint
 * is needed. A route change does not commit early.
 *
 * Once the timer elapses the toast is dismissed with the commit. An Undo that
 * still lands after it (pressed in the dismiss animation) cancels nothing and
 * says so ("too late") instead of claiming a restore.
 *
 * A batch is settled as a whole: every DELETE runs, failures are collected into
 * ONE error toast naming the refs, and `['books']` + `['dashboard']` are
 * invalidated once, awaited. The batch's ids stay hidden until that refetch
 * lands, so a row never flashes back between the commit and the refetch.
 *
 * Safe failure: closing or reloading the tab inside the 6 s window cancels the
 * delete — nothing was sent, so the record survives. Unmounting the provider
 * (app teardown) commits pending deletes at once and dismisses their toasts.
 */
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { useDeferredDelete, type NotifyArgs } from '@/lib/useDeferredDelete'

const RECORD_DELETE_DELAY_MS = 6000

export interface RecordDeleteItem {
  id: number
  /** Reference number shown in the toast (`books.record.deleted`). */
  ref: string
}

interface DeleteFailure {
  ref: string
  err: unknown
}

/**
 * Bookkeeping shared by the items of one scheduleDelete call (one toast).
 * Each item reports exactly one outcome: deleted, failed, or cancelled by Undo.
 * The last report closes the batch: ONE error toast for the failures and ONE
 * awaited invalidation per key. `done` resolves after that, and every item's
 * onCommit awaits it, which keeps the batch's rows hidden until the refetch.
 */
interface DeleteBatch {
  toastId: string
  done: Promise<void>
  /** One handle per item; true if it cancelled that item's delete. */
  undos: (() => boolean)[]
  deleted: () => void
  failed: (ref: string, err: unknown) => void
  cancelled: () => void
}

type ScheduledItem = RecordDeleteItem & { batch: DeleteBatch }

function createBatch(
  toastId: string,
  size: number,
  qc: QueryClient,
  describeFailures: (failures: DeleteFailure[]) => string,
): DeleteBatch {
  let open = size
  let sent = 0
  const failures: DeleteFailure[] = []
  let finish!: () => void
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })

  const close = async (): Promise<void> => {
    try {
      if (failures.length > 0) toast.error(describeFailures(failures))
      // Nothing reached the server when every item was undone.
      if (sent > 0) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['books'] }),
          qc.invalidateQueries({ queryKey: ['dashboard'] }),
        ])
      }
    } finally {
      finish()
    }
  }
  const report = (): void => {
    open -= 1
    if (open === 0) void close()
  }

  return {
    toastId,
    done,
    undos: [],
    deleted: () => {
      sent += 1
      report()
    },
    failed: (ref, err) => {
      sent += 1
      failures.push({ ref, err })
      report()
    },
    cancelled: report,
  }
}

/** One message per batch: the ref + reason for a single failure, else the count + refs. */
function failureMessage(failures: DeleteFailure[], t: TFunction, language: string): string {
  if (failures.length === 1) {
    const [{ ref, err }] = failures
    return t('books.record.deleteFailed', { ref: bidi(ref), reason: apiErrorMessage(err) })
  }
  const refs = new Intl.ListFormat(language, { type: 'conjunction' }).format(
    failures.map((f) => bidi(f.ref)),
  )
  return t('books.list.deleteFailedMany', { count: failures.length, refs })
}

export interface RecordDeleteApi {
  /** Hide the records now and delete them after 6 s unless Undo is pressed. */
  scheduleDelete: (items: RecordDeleteItem[]) => void
  /** Ids hidden while their delete is pending; filter lists/queues by this. */
  pendingIds: ReadonlySet<number>
}

const RecordDeleteContext = createContext<RecordDeleteApi | null>(null)

export function RecordDeleteProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const batchSeq = useRef(0)
  // Ids with a delete scheduled or in flight. Scheduling one again is dropped:
  // the pending delete already covers it, and a re-armed timer would orphan the
  // first batch (it would never see that item's outcome).
  const activeIds = useRef(new Set<number>())

  // notify runs per item, the toast is per batch. Stable identity keeps
  // `scheduleDelete` (and the context value) stable.
  const notify = useCallback(({ pending, onUndo }: NotifyArgs<ScheduledItem>) => {
    const { id, batch } = pending
    batch.undos.push(() => {
      if (!onUndo()) return false
      activeIds.current.delete(id)
      batch.cancelled()
      return true
    })
    // The Undo toast never outlives the commit.
    return () => toast.dismiss(batch.toastId)
  }, [])

  const { pendingIds, scheduleDelete: scheduleOne } = useDeferredDelete<ScheduledItem>({
    delayMs: RECORD_DELETE_DELAY_MS,
    onCommit: async ({ id, ref, batch }) => {
      let failure: { err: unknown } | null = null
      try {
        await api.deleteBook(id)
      } catch (err) {
        // 409 (no longer deletable) / 403 (lost permission) / anything else:
        // the record is still there; the batch reports it and the refetch shows it.
        failure = { err }
      }
      if (failure) batch.failed(ref, failure.err)
      else batch.deleted()
      try {
        await batch.done
      } finally {
        activeIds.current.delete(id)
      }
    },
    notify,
  })

  const scheduleDelete = useCallback(
    (items: RecordDeleteItem[]) => {
      const fresh: RecordDeleteItem[] = []
      for (const item of items) {
        if (activeIds.current.has(item.id)) continue
        activeIds.current.add(item.id)
        fresh.push(item)
      }
      if (fresh.length === 0) return
      batchSeq.current += 1
      const batch = createBatch(`record-delete-${batchSeq.current}`, fresh.length, qc, (failures) =>
        failureMessage(failures, t, i18n.language),
      )
      for (const item of fresh) scheduleOne({ ...item, batch })
      const single = fresh.length === 1 ? fresh[0] : null
      let handled = false
      toast(
        single
          ? t('books.record.deleted', { ref: bidi(single.ref) })
          : t('books.list.deletedMany', { count: fresh.length }),
        {
          id: batch.toastId,
          duration: RECORD_DELETE_DELAY_MS,
          action: {
            label: t('common.undo'),
            onClick: () => {
              if (handled) return
              handled = true
              // Only claim a restore for deletes that were really cancelled; a
              // committed one (timer paused by hover, toast still up) is gone.
              const tooLate = batch.undos.filter((undo) => !undo()).length
              if (tooLate === 0) {
                toast.success(
                  single
                    ? t('books.record.restored', { ref: bidi(single.ref) })
                    : t('books.list.restoredMany', { count: fresh.length }),
                )
              } else {
                toast.error(
                  single
                    ? t('books.record.undoTooLate', { ref: bidi(single.ref) })
                    : t('books.list.undoTooLateMany', { count: tooLate }),
                )
              }
            },
          },
        },
      )
    },
    [i18n, qc, scheduleOne, t],
  )

  const value = useMemo<RecordDeleteApi>(
    () => ({ scheduleDelete, pendingIds }),
    [scheduleDelete, pendingIds],
  )

  return <RecordDeleteContext.Provider value={value}>{children}</RecordDeleteContext.Provider>
}

// The hook lives next to its provider on purpose (single import for consumers).
// eslint-disable-next-line react-refresh/only-export-components
export function useRecordDelete(): RecordDeleteApi {
  const ctx = useContext(RecordDeleteContext)
  if (!ctx) throw new Error('useRecordDelete must be used inside RecordDeleteProvider')
  return ctx
}
