import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FilePenLine } from 'lucide-react'
import { useState } from 'react'
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

interface WordReopenButtonProps extends WordActionProps {
  iconOnly?: boolean
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

export function WordReopenButton({
  book,
  isMobile,
  iconOnly,
}: WordReopenButtonProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [reopenSession, setReopenSession] = useState<WordSessionRead | null>(null)
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
  if (book.voided_at || !isFinished) return null

  const label = t('books.word.editNewVersion')
  const title = isMobile ? t('books.word.needsPc') : label

  return (
    <>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled={isMobile || reopenMutation.isPending}
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
