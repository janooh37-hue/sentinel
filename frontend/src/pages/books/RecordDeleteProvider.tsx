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
 * Safe failure: closing or reloading the tab inside the 6 s window cancels the
 * delete — nothing was sent, so the record survives.
 */
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import { useDeferredDelete, type NotifyArgs } from '@/lib/useDeferredDelete'

const RECORD_DELETE_DELAY_MS = 6000

export interface RecordDeleteItem {
  id: number
  /** Reference number shown in the toast (`books.record.deleted`). */
  ref: string
}

export interface RecordDeleteApi {
  /** Hide the records now and delete them after 6 s unless Undo is pressed. */
  scheduleDelete: (items: RecordDeleteItem[]) => void
  /** Ids hidden while their delete is pending; filter lists/queues by this. */
  pendingIds: ReadonlySet<number>
}

const RecordDeleteContext = createContext<RecordDeleteApi | null>(null)

export function RecordDeleteProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  // Undo callbacks of the batch currently being scheduled (notify is per item,
  // the toast is per batch).
  const batchUndos = useRef<(() => void)[] | null>(null)

  // Stable identity keeps `scheduleDelete` (and the context value) stable.
  const notify = useCallback(({ onUndo }: NotifyArgs<RecordDeleteItem>) => {
    batchUndos.current?.push(onUndo)
  }, [])

  const { pendingIds, scheduleDelete: scheduleOne } = useDeferredDelete<RecordDeleteItem>({
    delayMs: RECORD_DELETE_DELAY_MS,
    onCommit: async (item) => {
      try {
        await api.deleteBook(item.id)
      } catch (err) {
        // 409 (no longer deletable) / 403 (lost permission) / anything else:
        // the record is still there, so tell the user and let the refetch show it.
        toast.error(apiErrorMessage(err))
      } finally {
        void qc.invalidateQueries({ queryKey: ['books'] })
        void qc.invalidateQueries({ queryKey: ['dashboard'] })
      }
    },
    notify,
  })

  const scheduleDelete = useCallback(
    (items: RecordDeleteItem[]) => {
      if (items.length === 0) return
      const undos: (() => void)[] = []
      batchUndos.current = undos
      try {
        for (const item of items) scheduleOne(item)
      } finally {
        batchUndos.current = null
      }
      const single = items.length === 1 ? items[0] : null
      toast(
        single
          ? t('books.record.deleted', { ref: single.ref })
          : t('books.list.deletedMany', { count: items.length }),
        {
          duration: RECORD_DELETE_DELAY_MS,
          action: {
            label: t('common.undo'),
            onClick: () => {
              for (const undo of undos) undo()
              toast.success(
                single
                  ? t('books.record.restored', { ref: single.ref })
                  : t('books.list.restoredMany', { count: items.length }),
              )
            },
          },
        },
      )
    },
    [scheduleOne, t],
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
