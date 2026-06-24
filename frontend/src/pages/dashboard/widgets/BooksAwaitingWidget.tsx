/**
 * BooksAwaitingWidget — dashboard widget listing books awaiting the signed-in
 * user's approval decision.
 *
 * Renders nothing when the user lacks `books.approve` OR the list is empty.
 * Each row shows: ref chip (mono), category, relative time, subject preview,
 * submitter, and quick-action buttons (Open / Reject / Approve).
 *
 * Query key: ['books', 'awaiting'] — invalidated by BookDetailDrawer actions.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatDistanceToNow, parseISO, type Locale } from 'date-fns'
import { ar as arLocale } from 'date-fns/locale'
import { Check, ChevronRight, Inbox, X } from 'lucide-react'

import { api, ApiError, type BookRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { BookDetailDrawer } from '@/components/books/BookDetailDrawer'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function relTime(iso: string, locale?: Locale): string {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale })
  } catch {
    return iso.slice(0, 10)
  }
}

interface RowProps {
  book: BookRead
  isAr: boolean
  dfLocale?: Locale
  onOpen: () => void
  onApprove: () => void
  onReject: () => void
  isDeciding: boolean
}

function AwaitingRow({
  book,
  isAr,
  dfLocale,
  onOpen,
  onApprove,
  onReject,
  isDeciding,
}: RowProps): React.JSX.Element {
  const { t } = useTranslation()
  const priIsHigh = book.priority === 'High'
  const catName = isAr
    ? (book.category?.name_ar ?? book.category?.name_en)
    : book.category?.name_en

  return (
    <article
      className={cn(
        'relative flex flex-col gap-2 rounded-xl border border-hairline bg-surface px-4 py-3 transition-shadow hover:shadow-sm',
        // Yellow/warning start-edge accent
        'border-s-2 border-s-warning',
      )}
    >
      {/* ── head ── */}
      <header className="flex items-center gap-2">
        <span className="shrink-0 rounded-md bg-surface-tinted px-1.5 py-0.5 font-mono text-[0.72em] font-semibold text-foreground">
          {book.ref_number}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.78em] text-muted-foreground">
          {catName}
        </span>
        <span className="font-mono text-[0.7em] text-muted-foreground">
          {relTime(book.created_at, dfLocale)}
        </span>
        {priIsHigh && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[0.65em] font-semibold"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            {t('books.approval.high')}
          </span>
        )}
      </header>

      {/* ── preview ── */}
      {book.subject && (
        <p className="line-clamp-2 text-[0.82em] leading-snug text-foreground">
          {book.subject}
        </p>
      )}

      {/* ── footer ── */}
      <footer className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[0.72em] text-muted-foreground">
          {t('books.approval.submitter')}:{' '}
          <span className="text-foreground">
            {book.submitted_by_name ?? book.submitted_by_user_id ?? '—'}
          </span>
        </span>

        <div className="flex items-center gap-1.5">
          {/* Open — opens BookDetailDrawer */}
          <button
            type="button"
            onClick={onOpen}
            aria-label={t('books.approval.open', { defaultValue: 'Open book entry' })}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
          </button>

          {/* Reject */}
          <button
            type="button"
            aria-label={t('books.approval.reject')}
            disabled={isDeciding}
            onClick={onReject}
            className="flex h-7 w-7 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
          </button>

          {/* Sign & approve */}
          <button
            type="button"
            aria-label={t('books.approval.signApprove')}
            disabled={isDeciding}
            onClick={onApprove}
            className="flex h-7 items-center gap-1 rounded-md bg-success/10 px-2 text-[0.72em] font-semibold text-success transition-colors hover:bg-success/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
            {t('books.approval.signApprove')}
          </button>
        </div>
      </footer>
    </article>
  )
}

export function BooksAwaitingWidget(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const dfLocale = isAr ? arLocale : undefined
  const { has } = useCapabilities()
  const qc = useQueryClient()
  const [sheetBook, setSheetBook] = useState<BookRead | null>(null)
  const [decidingId, setDecidingId] = useState<number | null>(null)

  const awaitingQuery = useQuery({
    queryKey: ['books', 'awaiting'],
    queryFn: api.listAwaitingBooks,
    staleTime: 30_000,
    enabled: has('books.approve'),
  })

  function invalidateBooks(): void {
    void qc.invalidateQueries({ queryKey: ['books'] })
    void qc.invalidateQueries({ queryKey: ['books', 'awaiting'] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const rejectMutation = useMutation({
    mutationFn: (id: number) => api.decideBook(id, 'reject'),
    onSuccess: () => {
      invalidateBooks()
      toast.success(t('books.approval.rejected'))
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
    onSettled: () => setDecidingId(null),
  })

  // Approval == signing: embeds the signer's signature. NO_SIGNATURE means the
  // user must add a signing signature in Settings first.
  const signMutation = useMutation({
    mutationFn: (id: number) => api.signBook(id),
    onSuccess: () => {
      invalidateBooks()
      toast.success(t('books.approval.signed'))
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'NO_SIGNATURE') {
        toast.error(t('books.approval.noSignatureHint'))
      } else {
        toast.error(err instanceof ApiError ? err.message : String(err))
      }
    },
    onSettled: () => setDecidingId(null),
  })

  // Gate: only approvers see this widget. When their queue is empty it still
  // renders (with an empty state) so the section is a stable dashboard anchor.
  if (!has('books.approve')) return null

  const books = awaitingQuery.data ?? []
  const isEmpty = awaitingQuery.isSuccess && books.length === 0

  return (
    <>
      <section className="mb-6 rounded-2xl border border-hairline bg-surface">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <h3 className="text-[0.86em] font-semibold text-foreground">
            {t('books.approval.awaitingTitle')}
          </h3>
          {(awaitingQuery.isLoading || books.length > 0) && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 font-mono text-[0.7em] font-semibold text-warning">
              {awaitingQuery.isLoading ? '…' : books.length}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-col gap-2 px-4 py-3">
          {awaitingQuery.isLoading ? (
            Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-xl border border-hairline p-3">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-2.5 w-2/3" />
              </div>
            ))
          ) : awaitingQuery.isError ? (
            <EmptyState
              icon={Inbox}
              message={t('common.loadError')}
              actionLabel={t('common.retry')}
              onAction={() => void awaitingQuery.refetch()}
            />
          ) : isEmpty ? (
            <EmptyState icon={Inbox} message={t('books.approval.awaitingEmpty')} />
          ) : (
            books.map((book) => (
              <AwaitingRow
                key={book.id}
                book={book}
                isAr={isAr}
                dfLocale={dfLocale}
                onOpen={() => setSheetBook(book)}
                onApprove={() => { setDecidingId(book.id); signMutation.mutate(book.id) }}
                onReject={() => { setDecidingId(book.id); rejectMutation.mutate(book.id) }}
                isDeciding={decidingId === book.id}
              />
            ))
          )}
        </div>
      </section>

      <BookDetailDrawer
        bookId={sheetBook?.id ?? null}
        onClose={() => setSheetBook(null)}
        onSubmitForApproval={() => setSheetBook(null)}
      />
    </>
  )
}
