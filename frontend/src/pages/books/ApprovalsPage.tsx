/**
 * ApprovalsPage — the approvals log under Records (#31).
 *
 * Two tabs over GET /books/approval-log:
 *   - "Awaiting my review" (scope=received): my pending decision steps plus my
 *     own verdicts from the last 30 days. Needs `books.approve`.
 *   - "Sent by me" (scope=sent): every record I submitted for approval.
 *
 * The default tab is the reviewer's queue when the caller holds
 * `books.approve`, else their sent list; `?tab=sent|received` overrides once
 * and is consumed + stripped (same pattern as BooksPage's ?open/?status).
 *
 * Rows carry a page-1 PDF thumbnail (pdf.js canvas, IDM-safe base64 fetch —
 * reuses scanInbox/ScanPdfCanvas), a mono ref chip, the subject, the
 * submitter → manager line, both dates, and a status chip. Status chips filter
 * client-side. Clicking a row opens BookDetailDrawer, which owns every
 * decision mutation; this page stays read-only.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { format, parseISO } from 'date-fns'
import { ar as arLocale } from 'date-fns/locale'
import { FileText, Inbox, Stamp } from 'lucide-react'

import { api, type ApprovalLogItem } from '@/lib/api'
import { isApprovalScope, type ApprovalScope } from '@/lib/approvals'
import { useCapabilities } from '@/lib/useCapabilities'
import { BookDetailDrawer } from '@/components/books/BookDetailDrawer'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonRow } from '@/components/ui/skeleton'
import { RefreshButton } from '@/components/refresh/RefreshButton'
import { cn } from '@/lib/utils'

const ScanPdfCanvas = lazy(() => import('@/pages/scanInbox/ScanPdfCanvas'))

/** Client-side status chips. Rows with other states (draft, awaiting_scan)
 *  always show under "all" only. */
const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected', 'returned'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

function formatDate(iso: string | null | undefined, locale?: typeof arLocale): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), 'd MMM yyyy', { locale: locale ?? undefined })
  } catch {
    return iso.slice(0, 10)
  }
}

/** Page-1 thumbnail of the record's paper; icon tile when there is no
 *  generated document or the PDF won't render. Mounting is gated on visibility
 *  like ScanBackThumb — each thumb is its own PDF fetch. */
function ApprovalThumb({ item }: { item: ApprovalLogItem }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el || visible) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  const pdfUrl =
    item.document_id != null ? api.documentDownloadUrl(item.document_id, 'pdf') : null

  return (
    <div
      ref={boxRef}
      aria-hidden
      className="aspect-[16/11] w-14 shrink-0 overflow-hidden rounded-md border border-hairline bg-white"
    >
      {pdfUrl !== null && visible && !failed ? (
        <Suspense fallback={<span className="block h-full w-full animate-pulse bg-surface-tinted" />}>
          <ScanPdfCanvas pdfUrl={pdfUrl} onError={() => setFailed(true)} />
        </Suspense>
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-surface-tinted text-faint">
          <FileText className="h-4 w-4" strokeWidth={1.8} />
        </span>
      )}
    </div>
  )
}

function StatusChip({ item }: { item: ApprovalLogItem }): React.JSX.Element {
  const { t } = useTranslation()
  const variants: Record<string, string> = {
    none: 'bg-warning-soft text-warning',
    pending: 'bg-warning-soft text-warning',
    awaiting_scan: 'bg-info-soft text-info',
    approved: 'bg-success-soft text-success',
    rejected: 'bg-destructive/10 text-destructive',
    returned: 'bg-info-soft text-info',
  }
  // Verdict wording when decided ("Approved"/"Rejected"/"Returned"), otherwise
  // the state label — same keys the records surfaces use.
  const key =
    item.verdict != null
      ? `books.approval.state${item.verdict[0].toUpperCase()}${item.verdict.slice(1)}`
      : item.status === 'awaiting_scan'
        ? 'books.approval.stateAwaitingScan'
        : item.status === 'none'
          ? 'books.approval.stateDraft'
          : `books.approval.state${item.status[0].toUpperCase()}${item.status.slice(1)}`
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em]',
        variants[item.status] ?? 'bg-surface-tinted text-muted-foreground',
      )}
    >
      {t(key)}
    </span>
  )
}

interface RowProps {
  item: ApprovalLogItem
  dfLocale?: typeof arLocale
  onOpen: () => void
}

function ApprovalRow({ item, dfLocale, onOpen }: RowProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <article
      role="button"
      tabIndex={0}
      data-testid="approval-row"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      aria-label={t('books.approval.open')}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-surface p-3 transition-colors',
        'hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <ApprovalThumb item={item} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* ref · priority · status */}
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded-md bg-surface-tinted px-1.5 py-0.5 font-mono text-[0.72em] font-semibold text-foreground">
            <bdi dir="ltr">{item.ref_number}</bdi>
          </span>
          {item.priority === 'High' && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[0.65em] font-semibold"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              {t('books.approval.high')}
            </span>
          )}
          <span className="ms-auto">
            <StatusChip item={item} />
          </span>
        </div>
        {/* subject */}
        {item.subject && (
          <p className="line-clamp-2 text-[0.82em] leading-snug text-foreground" dir="auto">
            {item.subject}
          </p>
        )}
        {/* submitter → manager */}
        <p className="truncate text-[0.72em] text-muted-foreground">
          {t('books.approval.submitter')}:{' '}
          <span className="text-foreground">{item.submitted_by_name ?? '—'}</span>
          {item.doc_manager_name && (
            <>
              {' '}
              <span aria-hidden>→</span>{' '}
              <span className="text-foreground">{item.doc_manager_name}</span>
            </>
          )}
        </p>
        {/* dates */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[0.7em] text-muted-foreground">
          <span>
            {t('books.approval.submittedAt')}: {formatDate(item.submitted_at, dfLocale)}
          </span>
          {item.decided_at && (
            <span>
              {t('books.approvals.decidedAt')}: {formatDate(item.decided_at, dfLocale)}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

export function ApprovalsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const dfLocale = isAr ? arLocale : undefined
  const { has } = useCapabilities()
  const canApprove = has('books.approve')

  // ── Tab state: ?tab= overrides once (consumed + stripped), then in-memory ──
  const [searchParams, setSearchParams] = useSearchParams()
  const [tabOverride, setTabOverride] = useState<ApprovalScope | null>(null)
  const defaultTab: ApprovalScope = canApprove ? 'received' : 'sent'
  const tab = tabOverride ?? defaultTab

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam) {
      if (isApprovalScope(tabParam)) setTabOverride(tabParam)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('tab')
          return next
        },
        { replace: true },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  /* eslint-enable react-hooks/set-state-in-effect */

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [openBookId, setOpenBookId] = useState<number | null>(null)

  const logQuery = useQuery({
    queryKey: ['books', 'approval-log', tab],
    queryFn: () => api.listApprovalLog(tab),
  })

  const rows: ApprovalLogItem[] = useMemo(() => logQuery.data?.items ?? [], [logQuery.data])
  const filteredRows = useMemo(
    () =>
      statusFilter === 'all' ? rows : rows.filter((row) => row.status === statusFilter),
    [rows, statusFilter],
  )

  const tabs: Array<{ id: ApprovalScope; label: string; show: boolean }> = [
    { id: 'received', label: t('books.approvals.tabReceived'), show: canApprove },
    { id: 'sent', label: t('books.approvals.tabSent'), show: true },
  ]

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-y-auto px-6 pb-6 pt-5">
      <header className="mb-3 flex shrink-0 items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[1.45em] font-bold tracking-tight text-foreground">
            {t('books.approvals.title')}
          </h1>
          {!logQuery.isPending && !logQuery.isError && (
            <div className="mt-0.5 text-[0.8em] text-muted-foreground">
              {t('books.approvals.count', { count: rows.length })}
            </div>
          )}
        </div>
        <RefreshButton />
      </header>

      {/* Tabs + status chips */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={t('books.approvals.title')}
          className="inline-flex rounded-full border border-hairline bg-surface p-0.5"
        >
          {tabs
            .filter((entry) => entry.show)
            .map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                data-testid={`approvals-tab-${entry.id}`}
                onClick={() => setTabOverride(entry.id)}
                className={cn(
                  'rounded-full px-3.5 py-1.5 text-[0.8em] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  tab === entry.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {entry.label}
              </button>
            ))}
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((filter) => {
            const labelKey =
              filter === 'all'
                ? 'books.filters.statusAll'
                : `books.approval.state${filter[0].toUpperCase()}${filter.slice(1)}`
            return (
              <button
                key={filter}
                type="button"
                aria-pressed={statusFilter === filter}
                data-testid={`approvals-filter-${filter}`}
                onClick={() => setStatusFilter(filter)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[0.75em] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  statusFilter === filter
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-hairline bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
                )}
              >
                {t(labelKey)}
              </button>
            )
          })}
        </div>
      </div>

      {/* List */}
      {logQuery.isPending ? (
        <div className="flex flex-col overflow-hidden rounded-2xl border border-hairline bg-surface">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} cols={3} />
          ))}
        </div>
      ) : logQuery.isError ? (
        <div className="rounded-2xl border border-hairline bg-surface py-12">
          <EmptyState
            icon={Stamp}
            message={t('common.loadError')}
            actionLabel={t('common.retry')}
            onAction={() => void logQuery.refetch()}
          />
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-2xl border border-hairline bg-surface py-12">
          <EmptyState
            icon={Inbox}
            message={
              rows.length === 0
                ? tab === 'sent'
                  ? t('books.approvals.emptySent')
                  : t('books.approvals.emptyReceived')
                : t('books.approvals.emptyFiltered')
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2 pb-10">
          {filteredRows.map((item) => (
            <ApprovalRow
              key={item.book_id}
              item={item}
              dfLocale={dfLocale}
              onOpen={() => setOpenBookId(item.book_id)}
            />
          ))}
        </div>
      )}

      <BookDetailDrawer
        bookId={openBookId}
        onClose={() => setOpenBookId(null)}
        onSubmitForApproval={() => setOpenBookId(null)}
      />
    </div>
  )
}
