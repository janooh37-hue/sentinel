/**
 * BookWordActions — Finish / Discard actions for an active Word session,
 * plus the "Edit in Word (creates a new version)" button for finished books.
 *
 * Used by BOTH RecordPane (desktop) and BookRecordPage (mobile, isMobile=true).
 * On mobile, the re-open button is disabled with the PC hint.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useState } from 'react'

import { api, apiErrorMessage } from '@/lib/api'
import type { BookRead, WordSessionRead } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { WordHandoffDialog } from '@/pages/books/WordHandoffDialog'
import { cn } from '@/lib/utils'

interface Props {
  book: BookRead
  isMobile?: boolean
}

export function BookWordActions({ book, isMobile }: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [discardOpen, setDiscardOpen] = useState(false)
  const [reopenSession, setReopenSession] = useState<WordSessionRead | null>(null)

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['books'] })

  const finishMutation = useMutation({
    mutationFn: () => api.finishWordSession(book.id),
    onSuccess: () => {
      invalidate()
      toast.success(t('books.word.finished', { ref: book.ref_number }))
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

  const reopenMutation = useMutation({
    mutationFn: () => api.reopenWordSession(book.id),
    onSuccess: (session) => {
      invalidate()
      window.location.href = session.word_url
      setReopenSession(session)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  // Voided book — no actions
  if (book.voided_at) return null

  const hasActiveSession = book.edit_session?.state === 'active'
  const isFinished = (book.versions?.length ?? 0) > 0 && !hasActiveSession

  // Neither active session nor finished — nothing to show
  if (!hasActiveSession && !isFinished) return null

  const busy = finishMutation.isPending || discardMutation.isPending

  return (
    <>
      {/* Re-open button — shown for FINISHED books (has versions, no active session) */}
      {isFinished && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            disabled={isMobile || reopenMutation.isPending}
            onClick={() => reopenMutation.mutate()}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[0.82em] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'text-[#185abd] disabled:cursor-not-allowed disabled:opacity-50',
            )}
            style={{ borderColor: '#185abd55' }}
          >
            {t('books.word.editNewVersion')}
          </button>
          {isMobile && (
            <span className="text-[0.72em] text-muted-foreground">
              {t('books.word.needsPc')}
            </span>
          )}
        </div>
      )}

      {/* Active-session actions: Open again (mobile disabled), Finish, Discard */}
      {hasActiveSession && (
        <>
          {isMobile && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-[0.82em] font-semibold opacity-50',
                  'cursor-not-allowed text-[#185abd]',
                )}
                style={{ borderColor: '#185abd33' }}
              >
                {t('books.word.openInWord')}
              </button>
              <span className="text-[0.72em] text-muted-foreground">
                {t('books.word.needsPc')}
              </span>
            </div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => finishMutation.mutate()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-transparent bg-primary px-3 py-2 text-[0.82em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {t('books.word.finish')}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => setDiscardOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 px-3 py-2 text-[0.82em] font-semibold text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {t('books.word.discard')}
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
      )}

      {/* WordHandoffDialog for the re-opened session */}
      <WordHandoffDialog
        session={reopenSession}
        open={reopenSession != null}
        onClose={() => { setReopenSession(null); invalidate() }}
      />
    </>
  )
}
