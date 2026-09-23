import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, FilePenLine, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api, apiErrorMessage } from '@/lib/api'
import type { BookRead, WordSessionRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { cn } from '@/lib/utils'
import { WordHandoffDialog } from '@/pages/books/WordHandoffDialog'

interface WordActionProps {
  book: BookRead
  isMobile?: boolean
}

/** Trigger data for a menu-hosted rendering of `WordReopenButton` (record
 *  page Tools dropdown) — see the `onTriggerChange` doc below. */
export interface WordReopenTrigger {
  label: string
  icon: React.ReactNode
  disabled: boolean
  onClick: () => void
}

interface WordReopenButtonProps extends WordActionProps {
  iconOnly?: boolean
  /** Suppress the default standalone `<button>` — used when a caller renders
   *  the trigger itself (e.g. inside a dropdown menu item) via `onTriggerChange`.
   *  The mutation, session state, and `WordHandoffDialog` stay owned and mounted
   *  here regardless — only the visible trigger markup moves. */
  hideTrigger?: boolean
  /** Called with the current trigger affordance (or null when not applicable)
   *  on every change. Lets a caller (e.g. a Tools dropdown) render its own
   *  menu-item markup for this action while `WordReopenButton` keeps owning
   *  the mutation and `WordHandoffDialog` — mounted independently of whatever
   *  container the caller puts the rendered trigger in, so closing a dropdown
   *  never discards a pending reopen or an already-open handoff dialog. */
  onTriggerChange?: (trigger: WordReopenTrigger | null) => void
}

export function WordSessionActions({
  book,
  isMobile,
}: WordActionProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [discardOpen, setDiscardOpen] = useState(false)
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['books'] })

  const finishMutation = useMutation({
    mutationFn: () => api.finishWordSession(book.id),
    onSuccess: () => {
      invalidate()
      toast.success(t('books.word.finished', { ref: bidi(book.ref_number) }))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const discardMutation = useMutation({
    mutationFn: () => api.discardWordSession(book.id),
    onSuccess: () => {
      invalidate()
      toast.success(t('books.toast.deleted'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  if (book.voided_at || book.edit_session?.state !== 'active') return null

  const busy = finishMutation.isPending || discardMutation.isPending

  return (
    <>
      {isMobile ? (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            disabled
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border px-3 py-2 text-[0.82em] font-semibold text-[#185abd] opacity-50"
            style={{ borderColor: '#185abd33' }}
          >
            {t('books.word.openInWord')}
          </button>
          <span className="text-[0.72em] text-muted-foreground">
            {t('books.word.needsPc')}
          </span>
        </div>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => finishMutation.mutate()}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent bg-primary p-0 text-[0.82em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        aria-label={t('books.word.finish')}
        title={t('books.word.finish')}
      >
        <Check className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={() => setDiscardOpen(true)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-accent/40 p-0 text-[0.82em] font-semibold text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        aria-label={t('books.word.discard')}
        title={t('books.word.discard')}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('books.word.discard')}
        description={t('books.word.discardConfirm')}
        confirmLabel={t('books.word.discard')}
        onConfirm={() => discardMutation.mutate()}
        destructive
      />
    </>
  )
}

export function WordReopenButton({
  book,
  isMobile,
  iconOnly,
  hideTrigger,
  onTriggerChange,
}: WordReopenButtonProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [reopenSession, setReopenSession] = useState<WordSessionRead | null>(null)
  // The same instance is reused across records (BookRecordPage QueueNav,
  // RecordPane selection). A session retained for record A must not present
  // over record B.
  const [sessionBookId, setSessionBookId] = useState(book.id)
  if (sessionBookId !== book.id) {
    setSessionBookId(book.id)
    setReopenSession(null)
  }
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['books'] })

  const reopenMutation = useMutation({
    mutationFn: () => api.reopenWordSession(book.id),
    onSuccess: (session) => {
      invalidate()
      setReopenSession(session)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const hasActiveSession = book.edit_session?.state === 'active'
  const isFinished = (book.versions?.length ?? 0) > 0 && !hasActiveSession
  const eligible = isFinished && !book.voided_at
  const label = t('books.word.editNewVersion')
  const title = isMobile ? t('books.word.needsPc') : label
  const disabled = isMobile === true || reopenMutation.isPending

  // Reactive trigger payload for a caller hosting this action elsewhere (the
  // Tools dropdown): recomputed on every render, so — unlike a ref snapshot —
  // it never goes stale between the owner's renders.
  useEffect(() => {
    onTriggerChange?.(
      eligible
        ? { label, icon: <FilePenLine className="h-3.5 w-3.5" aria-hidden="true" />, disabled, onClick: () => reopenMutation.mutate() }
        : null,
    )
    // Unmounting (e.g. queue navigation to a record where this component no
    // longer renders) must clear the lifted trigger too, or the Tools menu
    // keeps showing — and can act on — the previous record's action.
    return () => onTriggerChange?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, label, disabled, onTriggerChange])

  // Reopen flips `book.edit_session` active via the `invalidate()` refetch,
  // often before the user sees the dialog (always when a lock defers it):
  // keep the retained session mounted instead of reading that as "nothing to show".
  if (book.voided_at || (!isFinished && reopenSession == null)) return null

  return (
    <>
      {isFinished && !hideTrigger && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => reopenMutation.mutate()}
            aria-label={iconOnly ? label : undefined}
            title={iconOnly ? title : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border text-[0.82em] font-semibold text-[#185abd] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
              iconOnly ? 'h-9 w-9 justify-center p-0' : 'px-3 py-2',
            )}
            style={{ borderColor: '#185abd55' }}
          >
            {iconOnly ? <FilePenLine className="h-4 w-4" aria-hidden="true" /> : label}
          </button>
          {isMobile && !iconOnly ? (
            <span className="text-[0.72em] text-muted-foreground">
              {t('books.word.needsPc')}
            </span>
          ) : null}
        </div>
      )}

      <WordHandoffDialog
        session={reopenSession}
        open={reopenSession != null}
        onClose={() => {
          setReopenSession(null)
          invalidate()
        }}
      />
    </>
  )
}
