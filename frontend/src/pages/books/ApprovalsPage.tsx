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
 * Rows carry a page-1 PDF thumbnail, mono reference, subject, submitter →
 * manager route, dates, and status. Status chips filter the priority-grouped
 * ledger client-side. A thumbnail opens a document preview dialog; activating
 * the rest of a row routes to `/books/:id`, where decisions live.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { format, parseISO } from 'date-fns'
import { ar as arLocale } from 'date-fns/locale'
import { Check, Clock, CornerUpLeft, FileText, Inbox, Stamp, X } from 'lucide-react'

import { RefreshButton } from '@/components/refresh/RefreshButton'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonRow } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { ApprovalLogItem } from '@/lib/api'
import { isApprovalScope } from '@/lib/approvals'
import type { ApprovalScope } from '@/lib/approvals'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'
import { ApprovalPreviewDialog, StatusChip } from './ApprovalPreviewDialog'

const ScanPdfCanvas = lazy(() => import('@/pages/scanInbox/ScanPdfCanvas'))

/** Client-side status chips. Rows with other states (draft, awaiting_scan)
 *  always show under "all" only. */
const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected', 'returned'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

const PRIORITY_GROUPS = [
  { id: 'waiting', statuses: ['pending', 'awaiting_scan', 'none'], icon: Clock },
  { id: 'returned', statuses: ['returned'], icon: CornerUpLeft },
  { id: 'approved', statuses: ['approved'], icon: Check },
  { id: 'rejected', statuses: ['rejected'], icon: X },
] as const

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
function ApprovalThumb({
  item,
  onPreview,
}: {
  item: ApprovalLogItem
  onPreview: (trigger: HTMLButtonElement) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(false)
  const boxRef = useRef<HTMLElement | null>(null)

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
  const tileClass =
    'col-start-1 row-span-4 row-start-1 aspect-[16/11] min-h-11 w-14 shrink-0 overflow-hidden rounded-md border border-hairline bg-white md:col-start-1 md:row-span-1 md:row-start-1'
  const tileContent =
    pdfUrl !== null && visible && !failed ? (
      <Suspense
        fallback={<span className="block h-full w-full animate-pulse bg-surface-tinted" />}
      >
        <ScanPdfCanvas pdfUrl={pdfUrl} onError={() => setFailed(true)} />
      </Suspense>
    ) : (
      <span className="flex h-full w-full items-center justify-center bg-surface-tinted text-faint">
        <FileText className="h-4 w-4" strokeWidth={1.8} aria-hidden />
      </span>
    )

  if (pdfUrl !== null && !failed) {
    return (
      <button
        ref={(node) => {
          boxRef.current = node
        }}
        type="button"
        aria-label={t('books.approvals.previewThumb', { ref: item.ref_number })}
        onClick={(e) => {
          e.stopPropagation()
          onPreview(e.currentTarget)
        }}
        className={cn(
          tileClass,
          'cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {tileContent}
      </button>
    )
  }

  return (
    <div
      ref={(node) => {
        boxRef.current = node
      }}
      aria-hidden
      className={tileClass}
    >
      {tileContent}
    </div>
  )
}

interface RowProps {
  item: ApprovalLogItem
  dfLocale?: typeof arLocale
  onOpen: () => void
  onPreview: (trigger: HTMLButtonElement) => void
}

function ApprovalRow({ item, dfLocale, onOpen, onPreview }: RowProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <article
      role="button"
      tabIndex={0}
      data-testid="approval-row"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      aria-label={t('books.approval.open')}
      className={cn(
        'grid cursor-pointer grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 p-3 transition-colors',
        'hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'md:grid-cols-[3.5rem_8rem_minmax(0,2.2fr)_minmax(0,1.6fr)_max-content_max-content] md:items-center md:gap-x-4',
      )}
    >
      <ApprovalThumb item={item} onPreview={onPreview} />

      <div className="col-start-2 row-start-1 flex min-w-0 items-center gap-2 pe-24 md:col-start-2 md:flex-col md:items-start md:gap-1 md:pe-0">
        <span className="shrink-0 rounded-md bg-surface-tinted px-1.5 py-0.5 font-mono text-[0.72em] font-semibold text-foreground">
          <bdi dir="ltr">{item.ref_number}</bdi>
        </span>
        {item.priority === 'High' && (
          <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[0.65em] font-semibold text-accent">
            {t('books.approval.high')}
          </span>
        )}
      </div>
      <span className="col-start-2 row-start-1 justify-self-end md:col-start-6 md:row-start-1">
        <StatusChip item={item} />
      </span>

      {item.subject && (
        <p
          className="col-start-2 row-start-2 line-clamp-2 text-[0.82em] leading-snug text-foreground md:col-start-3 md:row-start-1"
          dir="auto"
        >
          {item.subject}
        </p>
      )}

      <p className="col-start-2 row-start-3 truncate text-[0.72em] text-muted-foreground md:col-start-4 md:row-start-1">
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

      <div className="col-start-2 row-start-4 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[0.7em] text-muted-foreground md:col-start-5 md:row-start-1 md:flex-col md:items-start md:gap-0.5">
        <span>
          {t('books.approval.submittedAt')}: {formatDate(item.submitted_at, dfLocale)}
        </span>
        {item.decided_at && (
          <span>
            {t('books.approvals.decidedAt')}: {formatDate(item.decided_at, dfLocale)}
          </span>
        )}
      </div>

    </article>
  )
}

export function ApprovalsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
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
  const [preview, setPreview] = useState<ApprovalLogItem | null>(null)
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null)

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
  const groupedRows = useMemo(() => {
    const groups = PRIORITY_GROUPS.map((group) => ({
      ...group,
      items: [] as ApprovalLogItem[],
    }))

    for (const item of filteredRows) {
      const group =
        groups.find((entry) => entry.statuses.some((status) => status === item.status)) ??
        groups[0]
      group.items.push(item)
    }

    return groups
  }, [filteredRows])

  const tabs: Array<{ id: ApprovalScope; label: string; show: boolean }> = [
    { id: 'received', label: t('books.approvals.tabReceived'), show: canApprove },
    { id: 'sent', label: t('books.approvals.tabSent'), show: true },
  ]

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto px-6 pb-6 pt-5">
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
        <div className="flex flex-col gap-5 pb-10">
          {groupedRows.map((group) => {
            if (group.items.length === 0) return null
            const GroupIcon = group.icon
            const headingKey =
              group.id === 'waiting'
                ? 'books.approvals.groupWaiting'
                : `books.approval.state${group.id[0].toUpperCase()}${group.id.slice(1)}`
            const hintKey = `books.approvals.group${group.id[0].toUpperCase()}${group.id.slice(1)}Hint`

            return (
              <section key={group.id} data-testid={`approvals-group-${group.id}`}>
                <header className="mb-2 flex items-start gap-2 px-1">
                  <GroupIcon
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.8}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[0.9em] font-bold text-foreground">
                        {t(headingKey)}
                      </h2>
                      <span className="rounded-md bg-surface-tinted px-1.5 py-0.5 font-mono text-[0.72em] text-muted-foreground">
                        {group.items.length}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[0.72em] text-muted-foreground">
                      {t(hintKey)}
                    </p>
                  </div>
                </header>
                <div className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
                  {group.items.map((item) => (
                    <ApprovalRow
                      key={item.book_id}
                      item={item}
                      dfLocale={dfLocale}
                      onOpen={() => navigate(`/books/${item.book_id}`)}
                      onPreview={(trigger) => {
                        previewTriggerRef.current = trigger
                        setPreview(item)
                      }}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <ApprovalPreviewDialog
        item={preview}
        triggerRef={previewTriggerRef}
        onClose={() => setPreview(null)}
      />
    </div>
  )
}
