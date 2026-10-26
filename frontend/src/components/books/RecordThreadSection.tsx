import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from '@/lib/toast'

import { api, apiErrorMessage, type BookRead, type BookThreadItem } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { ConfidentialityChip } from './ConfidentialityChip'

function RecordLink({ item }: { item: BookThreadItem }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <Link
        to={`/books/${item.book_id}`}
        className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2 rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <bdi dir="ltr" className="font-mono font-medium tabular-nums">{item.ref_number}</bdi>
        <span className="break-words" dir="auto">{item.subject}</span>
      </Link>
      <ConfidentialityChip level={item.confidentiality} />
    </div>
  )
}

export function RecordThreadSection({ book }: { book: BookRead }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const canEdit = has('books.edit') && book.can_write
  const qc = useQueryClient()
  const thread = useQuery({
    queryKey: ['books', 'thread', book.id],
    queryFn: () => api.getBookThread(book.id),
    enabled: book.access_scope === 'full',
  })
  const unlink = useMutation({
    mutationFn: (targetBookId: number) => api.unlinkBook(book.id, targetBookId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books', 'thread', book.id] })
      void qc.invalidateQueries({ queryKey: ['books', 'detail', book.id] })
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  if (book.access_scope !== 'full') return null

  if (thread.isError) {
    return (
      <p role="alert" data-print-hide className="border-b border-hairline bg-surface px-4 py-3 text-[0.8em] text-destructive sm:px-5">
        {apiErrorMessage(thread.error)}
      </p>
    )
  }

  const items = thread.data ?? []
  if (items.length === 0) return null
  const references = items.filter((item) => item.direction === 'outgoing' && item.attached)

  return (
    <div data-print-hide data-testid="record-thread" className="border-b border-hairline bg-surface">
      {references.length > 0 && (
        <section aria-label={t('books.thread.references')}>
          <h3 className="px-4 py-2 text-[0.8em] font-semibold text-foreground sm:px-5">
            {t('books.thread.references')}
          </h3>
          <ul className="divide-y divide-hairline border-t border-hairline">
            {references.map((item) => (
              <li key={item.book_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[0.78em] sm:px-5">
                <RecordLink item={item} />
                {item.current_document_id != null && (
                  <a
                    href={api.documentDownloadUrl(item.current_document_id, 'pdf')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-9 items-center rounded-sm px-2 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('books.thread.pdf')}
                  </a>
                )}
                {canEdit && item.can_unlink && (
                  <button
                    type="button"
                    onClick={() => { if (canEdit && book.access_scope === 'full' && item.can_unlink) unlink.mutate(item.book_id) }}
                    disabled={unlink.isPending}
                    className="min-h-9 shrink-0 rounded-lg border border-hairline px-3 text-[0.95em] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('books.thread.unlink')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label={t('books.thread.title')}>
        <h3 className="px-4 py-2 text-[0.8em] font-semibold text-foreground sm:px-5">
          {t('books.thread.title')}
        </h3>
        <ul className="divide-y divide-hairline border-t border-hairline">
          {items.map((item) => (
            <li key={`${item.direction}-${item.book_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[0.78em] sm:px-5">
              <span className="text-muted-foreground">
                {t(`books.thread.relations.${item.direction}.${item.kind}`)}
              </span>
              <RecordLink item={item} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
