/**
 * LedgerBookActions — record-toolbar actions for an issued Ledger Book: Print
 * the shown Revision, pick a Revision, and for the writer either "Edit content"
 * (latest Revision unsigned) or "Start correction" (latest Revision signed).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FilePenLine, Printer } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { api, apiErrorMessage } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { ledgerBookKey, ledgerPaperUrl } from './ledgerBookKeys'

export function LedgerBookActions({ bookId, revision, onRevisionChange, className }: {
  bookId: number
  /** The shown Revision's `version_id`; omitted = the newest the viewer may read. */
  revision?: number
  /** Without it the Revision picker is hidden. */
  onRevisionChange?: (versionId: number) => void
  className?: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const userId = useAuth().user?.id
  const pickerId = useId()
  const query = useQuery({ queryKey: ledgerBookKey(bookId, revision), queryFn: () => api.getLedgerBook(bookId, revision) })
  const correction = useMutation({
    mutationFn: () => api.startLedgerCorrection(bookId),
    onSuccess: (book) => {
      void qc.invalidateQueries({ queryKey: ['ledger', 'books', bookId] })
      const latest = book.revisions.at(-1)
      if (latest) toast.success(t('ledgerBook.composer.book.correctionStarted', { n: latest.version_no }))
      navigate(`/ledger/books/${bookId}/edit`)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const book = query.data
  if (!book) return null
  const shown = revision ?? book.selected_version_id
  const latest = book.revisions.at(-1)
  const isWriter = userId !== undefined && book.created_by_user_id === userId && !book.voided

  const print = (): void => {
    const win = window.open(ledgerPaperUrl({ bookId, revision: shown }), `ledger-book-${bookId}`)
    win?.addEventListener('load', () => win.print(), { once: true })
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Button type="button" variant="outline" size="sm" onClick={print}>
        <Printer aria-hidden="true" className="size-4" />
        {t('ledgerBook.composer.book.print')}
      </Button>
      {onRevisionChange && (
        <span className="inline-flex items-center gap-1.5">
          <label htmlFor={pickerId} className="text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.book.revisions')}</label>
          <select
            id={pickerId}
            value={shown}
            onChange={(e) => onRevisionChange(Number(e.target.value))}
            className="min-h-9 rounded-md border border-hairline bg-background px-2 text-[0.84em] focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {book.revisions.map((r) => (
              <option key={r.version_id} value={r.version_id}>
                {t(r.locked ? 'ledgerBook.composer.book.revisionLocked' : 'ledgerBook.composer.book.revisionOption', { n: r.version_no })}
              </option>
            ))}
          </select>
        </span>
      )}
      {isWriter && latest && (latest.locked ? (
        <Button type="button" variant="outline" size="sm" disabled={correction.isPending} onClick={() => correction.mutate()}>
          <FilePenLine aria-hidden="true" className="size-4" />
          {t('ledgerBook.composer.book.startCorrection')}
        </Button>
      ) : (
        <Link to={`/ledger/books/${bookId}/edit`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <FilePenLine aria-hidden="true" className="size-4" />
          {t('ledgerBook.composer.book.editContent')}
        </Link>
      ))}
    </div>
  )
}
