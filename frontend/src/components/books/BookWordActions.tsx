import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, FilePenLine, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api, apiErrorMessage } from '@/lib/api'
import type { BookRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { cn } from '@/lib/utils'

interface WordActionProps {
  book: BookRead
  isMobile?: boolean
  onFinished?: (book: BookRead) => void
}

/** Trigger data for a menu-hosted rendering of `WordReopenButton` (record
 *  page Tools dropdown) — see the `onTriggerChange` doc below. */
export interface WordReopenTrigger {
  label: string
  icon: React.ReactNode
  disabled: boolean
  onClick: () => void
}

interface WordReopenButtonProps extends Omit<WordActionProps, 'onFinished'> {
  iconOnly?: boolean
  /** Suppress the default standalone `<button>` — used when a caller renders
   *  the trigger itself (e.g. inside a dropdown menu item) via `onTriggerChange`.
   *  The mutation stays owned here; reopening navigates to the Word page. */
  hideTrigger?: boolean
  /** Called with the current trigger affordance (or null when not applicable)
   *  on every change. Lets a caller (e.g. a Tools dropdown) render its own
   *  menu-item markup for this action while `WordReopenButton` keeps owning
   *  the mutation, independently of the trigger's container. */
  onTriggerChange?: (trigger: WordReopenTrigger | null) => void
}
export function WordSessionActions({
  book,
  isMobile,
  onFinished,
}: WordActionProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [discardOpen, setDiscardOpen] = useState(false)
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['books'] })

  const finishMutation = useMutation({
    mutationFn: () => api.finishWordSession(book.id),
    onSuccess: (finishedBook) => {
      invalidate()
      toast.success(t('books.word.finished', { ref: bidi(book.ref_number) }))
      onFinished?.(finishedBook)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const discardMutation = useMutation({
    mutationFn: () => api.discardWordSession(book.id),
    onSuccess: (discardedBook) => {
      invalidate()
      // The backend voids only a book with no committed versions; discarding a
      // re-opened session leaves the record intact.
      toast.success(
        t(discardedBook.voided_at ? 'books.toast.voided' : 'books.toast.wordSessionDiscarded'),
      )
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
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-primary px-3 py-1.5 text-[0.82em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none md:min-h-9"
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
        {t('books.word.finish')}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={() => setDiscardOpen(true)}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-destructive/50 bg-transparent px-3 py-1.5 text-[0.82em] font-semibold text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none md:min-h-9"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        {t('books.word.discard')}
      </button>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('books.word.discardConfirmLabel')}
        description={t('books.word.discardConfirm')}
        confirmLabel={t('books.word.discardConfirmLabel')}
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
  const navigate = useNavigate()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['books'] })

  const reopenMutation = useMutation({
    mutationFn: () => api.reopenWordSession(book.id),
    onSuccess: (session) => {
      invalidate()
      navigate(`/books/${session.book_id}/word`)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const hasActiveSession = book.edit_session?.state === 'active'
  const isFinished = ((book.versions?.length ?? 0) > 0 || book.is_word_book) && !hasActiveSession
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

  if (!eligible) return null

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

    </>
  )
}
