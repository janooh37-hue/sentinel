/**
 * ReviewerActions — the verdict control for advisory reviewers.
 *
 * Renders two actions for the current user when they are a pending reviewer:
 *   • Approve as reviewed (green) — calls api.reviewBook with 'reviewed'
 *   • Request changes (amber) — reveals a required textarea, then submits
 *     with 'changes_requested' + the typed note.
 *
 * Invalidates ['books'], ['books','detail',bookId], ['books','awaiting'] on success.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, FileText } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  bookId: number
  onDone?: () => void
}

export function ReviewerActions({ bookId, onDone }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [mode, setMode] = useState<'changes' | null>(null)
  const [note, setNote] = useState('')

  const mut = useMutation({
    mutationFn: (v: { decision: 'reviewed' | 'changes_requested'; note?: string }) =>
      api.reviewBook(bookId, v.decision, v.note),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['books', 'detail', bookId] })
      void qc.invalidateQueries({ queryKey: ['books', 'awaiting'] })
      toast.success(t('books.reviewers.recorded'))
      setMode(null)
      setNote('')
      onDone?.()
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : String(e)),
  })

  const busy = mut.isPending

  function handleApproveReviewed(): void {
    mut.mutate({ decision: 'reviewed' })
  }

  function handleRequestChanges(): void {
    if (mode !== 'changes') {
      setMode('changes')
      setNote('')
      return
    }
    if (note.trim().length === 0) return
    mut.mutate({ decision: 'changes_requested', note: note.trim() })
  }

  return (
    <div data-testid="reviewer-actions">
      {mode === 'changes' && (
        <div className="mb-3">
          <label
            htmlFor="reviewer-note"
            className="mb-1 block text-[0.8em] font-medium text-muted-foreground"
          >
            {t('books.approval.reasonLabel')}
          </label>
          <textarea
            id="reviewer-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('books.approval.reasonPlaceholder')}
            className="w-full rounded-lg border border-hairline bg-background px-3 py-2 text-[0.88em] text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            dir="auto"
          />
          {note.trim().length === 0 && (
            <p className="mt-1 text-[0.74em] text-muted-foreground">
              {t('books.approval.reasonRequired')}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <button
          type="button"
          disabled={busy || (mode === 'changes' && note.trim().length === 0)}
          onClick={mode === 'changes' ? handleRequestChanges : () => setMode('changes')}
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[0.82em] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
            mode === 'changes'
              ? 'border-warning bg-warning text-white hover:bg-warning/90'
              : 'border-hairline text-warning hover:bg-warning/10',
          )}
          data-testid="reviewer-request-changes-btn"
        >
          <FileText className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          {t('books.reviewers.requestChanges')}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={handleApproveReviewed}
          className="ms-auto flex h-9 items-center gap-1.5 rounded-lg bg-success px-4 text-[0.82em] font-semibold text-white transition-colors hover:bg-success/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          data-testid="reviewer-approve-btn"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
          {t('books.reviewers.approveReviewed')}
        </button>
      </div>
    </div>
  )
}
