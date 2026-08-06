import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Printer, Send } from 'lucide-react'

import { SubmitForApprovalDialog } from './SubmitForApprovalDialog'
import { api } from '@/lib/api'
import { canSendForApproval } from './book-detail-drawer-utils'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { cn } from '@/lib/utils'

export type NotificationChoice = 'enabled' | 'skipped'

export interface SavedRecordActionsProps {
  bookId: number
  refNumber: string
  detail?: string
  notification?: NotificationChoice
  className?: string
}

export function SavedRecordActions({
  bookId,
  refNumber,
  detail,
  notification,
  className,
}: SavedRecordActionsProps): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { has } = useCapabilities()
  const isMobile = useIsMobile()
  const [approvalOpen, setApprovalOpen] = useState(false)
  const bookQuery = useQuery({
    queryKey: ['books', 'detail', bookId],
    queryFn: () => api.getBook(bookId),
  })

  const state = bookQuery.data?.approval_state
  const current = bookQuery.data?.versions?.at(-1)
  const printable = Boolean(current?.pdf_url || bookQuery.data?.imported_doc?.pdf_url)
  const canSubmit = state === 'none' && canSendForApproval(state, { canManage: has('books.manage') })
  const print = () => {
    const opened = window.open(`/books/${bookId}?print=1`, '_blank')
    if (opened) opened.opener = null
    else navigate(`/books/${bookId}?print=1`)
  }

  const printButton = (
    <button
      type="button"
      disabled={!printable}
      onClick={print}
      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-hairline px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-tinted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Printer className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
      {t('books.record.print')}
    </button>
  )

  const approvalAction = canSubmit ? (
    <button
      type="button"
      onClick={() => setApprovalOpen(true)}
      className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Send className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
      {t('books.approval.submitForApproval')}
    </button>
  ) : state === 'pending' ? (
    <span className="inline-flex min-h-10 items-center rounded-lg bg-surface-tinted px-3 text-sm font-medium text-muted-foreground">
      {t('books.completion.pendingApproval')}
    </span>
  ) : null

  const openRecord = (
    <button
      type="button"
      onClick={() => navigate(`/books/${bookId}`)}
      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-hairline px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ExternalLink className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
      {t('books.pane.openRecord')}
    </button>
  )

  return (
    <section className={cn('rounded-xl border border-hairline bg-surface p-4', className)}>
      <div className="flex flex-col gap-1" dir="auto">
        <p className="text-sm font-semibold text-foreground">{t('books.completion.savedToRecords')}</p>
        <p className="text-sm text-muted-foreground">{t('books.completion.reference', { ref: refNumber })}</p>
        {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
        {notification === 'enabled' && (
          <p className="text-sm text-muted-foreground">{t('books.completion.notificationEnabled')}</p>
        )}
        {notification === 'skipped' && (
          <p className="text-sm text-muted-foreground">{t('books.completion.notificationSkipped')}</p>
        )}
      </div>

      {!bookQuery.isPending && !printable && (
        <p className="mt-3 text-sm text-muted-foreground">{t('books.completion.printUnavailable')}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {isMobile ? (
          <>
            {approvalAction}
            {printButton}
            {openRecord}
          </>
        ) : (
          <>
            {printButton}
            {approvalAction}
            {openRecord}
          </>
        )}
      </div>

      {approvalOpen && <SubmitForApprovalDialog bookId={bookId} onClose={() => setApprovalOpen(false)} />}
    </section>
  )
}
