/**
 * BookWordActions — Finish / Discard actions for a book with an active Word session.
 *
 * Used by BOTH RecordPane (desktop) and BookRecordPage (mobile, isMobile=true).
 *
 * Task-11 seam: "Open in Word" / "Continue writing" / "Edit in Word" require a
 * fresh session token from the re-open endpoint (not yet built). On mobile, we
 * render the button disabled with a PC hint. On desktop the button is omitted
 * here — Task 11 will add the re-open flow and wire its word_url back.
 * ponytail: placeholder disabled button on mobile; add re-open endpoint call in Task 11.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useState } from 'react'

import { api, apiErrorMessage } from '@/lib/api'
import type { BookRead } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'

interface Props {
  book: BookRead
  isMobile?: boolean
}

export function BookWordActions({ book, isMobile }: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [discardOpen, setDiscardOpen] = useState(false)

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

  // Voided book — no actions
  if (book.voided_at) return null

  // No active session — no word actions to show
  if (book.edit_session?.state !== 'active') return null

  const busy = finishMutation.isPending || discardMutation.isPending

  return (
    <>
      {/* Task-11 seam: disabled placeholder for "Open in Word" on mobile.
          On desktop this button is omitted — Task 11 adds the re-open endpoint
          (POST /books/{id}/word/reopen) and exposes a new word_url for the client. */}
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
            {/* Word-brand blue (#185abd) only on Word actions */}
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
  )
}
