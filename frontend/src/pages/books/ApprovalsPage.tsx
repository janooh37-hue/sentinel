/**
 * ApprovalsPage — the approvals worklist under Records (#31, revision-scoped).
 *
 * Received / Sent by me outer tabs; To sign / To review sub-tabs under
 * Received when the caller has both. Received is authenticated and
 * assignment-scoped (a pending signature or review assignment grants access
 * without books.view/books.approve); Sent needs books.view. The context
 * (tab/kind/status/sort/page) lives in the URL via `@/lib/approvals` so it
 * survives navigating to a record and back.
 *
 * Rows carry a page-1 PDF thumbnail, mono reference, subject, counterparty
 * (submitter for received, assigned signer for sent), dates, and status. A
 * late advisory review (still pending after the signer already decided) shows
 * its own actionable state plus the record's real outcome. A thumbnail opens
 * a document preview dialog; activating the rest of a row routes to the
 * record with this context attached.
 */

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { ar as arLocale } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, FileText, Inbox } from 'lucide-react'

import { RefreshButton } from '@/components/refresh/RefreshButton'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonRow } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { ApprovalLogItem } from '@/lib/api'
import {
  APPROVALS_PAGE_SIZE,
  apiKindOf,
  approvalQueueUrl,
  approvalRecordUrl,
  normalizeApprovalContext,
  resetPage,
} from '@/lib/approvals'
import type { ApprovalContext, ApprovalKind, ApprovalSort, ApprovalStatus } from '@/lib/approvals'
import { useApprovalSummary } from '@/lib/useApprovalSummary'
import { useAuth } from '@/lib/authContext'
import { cn } from '@/lib/utils'
import { ApprovalPreviewDialog, StatusChip } from './ApprovalPreviewDialog'

const ScanPdfCanvas = lazy(() => import('@/pages/scanInbox/ScanPdfCanvas'))

const RECEIVED_STATUSES: readonly ApprovalStatus[] = ['pending', 'returned', 'approved', 'rejected', 'all']
const REVIEW_STATUSES: readonly ApprovalStatus[] = ['pending', 'all']
const SENT_STATUSES: readonly ApprovalStatus[] = ['all', 'pending', 'approved', 'rejected', 'returned']

interface QueueHistoryState {
  scrollY?: number
  focusBookId?: number
}

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

/** True when a review row is actionable ("pending") but the underlying
 *  record already carries a different, real decision — late advisory
 *  feedback, never a change to the signing outcome. */
function isLateAdvisory(item: ApprovalLogItem, kind: ApprovalKind | null): boolean {
  return (
    kind === 'review' &&
    item.status === 'pending' &&
    item.record_status != null &&
    item.record_status !== 'pending' &&
    item.record_status !== 'none'
  )
}

interface RowProps {
  item: ApprovalLogItem
  kind: ApprovalKind | null
  tab: 'sent' | 'received'
  dfLocale?: typeof arLocale
  onOpen: () => void
  onPreview: (trigger: HTMLButtonElement) => void
}

function ApprovalRow({ item, kind, tab, dfLocale, onOpen, onPreview }: RowProps): React.JSX.Element {
  const { t } = useTranslation()
  const late = isLateAdvisory(item, kind)
  const restricted = item.access_scope === 'assigned_revision'
  const counterpartyLabel = tab === 'sent' ? t('books.approvals.assignedSigner') : t('books.approval.submitter')
  const counterpartyName = tab === 'sent' ? item.approver_name : item.submitted_by_name

  return (
    <article
      role="button"
      tabIndex={0}
      data-testid="approval-row"
      data-book-id={item.book_id}
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
        {restricted && (
          <span className="rounded-full bg-info-soft px-1.5 py-0.5 text-[0.65em] font-semibold text-info">
            {t('books.approvals.assignedRevision')}
          </span>
        )}
      </div>
      <span className="col-start-2 row-start-1 flex items-center gap-1.5 justify-self-end md:col-start-6 md:row-start-1">
        {late && (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[0.65em] font-semibold text-warning">
            {t('books.approvals.lateAdvisory')}
          </span>
        )}
        <StatusChip item={late ? { ...item, status: item.record_status ?? item.status } : item} />
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
        {counterpartyLabel}:{' '}
        <span className="text-foreground">{counterpartyName ?? '—'}</span>
      </p>

      <div className="col-start-2 row-start-4 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[0.7em] text-muted-foreground md:col-start-5 md:row-start-1 md:flex-col md:items-start md:gap-0.5">
        <span>
          {t('books.approval.submittedAt')}: {formatDate(item.submitted_at, dfLocale)}
          {item.submitted_at &&
            ` (${t('books.approvals.daysAgo', {
              count: Math.max(0, differenceInCalendarDays(new Date(), parseISO(item.submitted_at))),
            })})`}
        </span>
        {item.decided_at && (
          <span>
            {t('books.approvals.decidedAt')}: {formatDate(item.decided_at, dfLocale)}
          </span>
        )}
        {item.assignment_version_no != null && item.assignment_version_no !== item.version_no && (
          <span>
            {t('books.approvals.assignmentRevision', { n: item.assignment_version_no })}
          </span>
        )}
      </div>
    </article>
  )
}

export function ApprovalsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const isAr = i18n.language.startsWith('ar')
  const dfLocale = isAr ? arLocale : undefined
  const [searchParams, setSearchParams] = useSearchParams()
  const listRef = useRef<HTMLDivElement | null>(null)
  const [preview, setPreview] = useState<ApprovalLogItem | null>(null)
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null)

  const summaryQuery = useApprovalSummary()
  const summary = summaryQuery.data
  const context = summary ? normalizeApprovalContext(searchParams, summary) : undefined

  // Canonicalize an unauthorized/invalid/missing URL to the resolved context —
  // history.replace, not a pushed entry.
  useEffect(() => {
    if (summary === undefined) return
    const canonical = context ? approvalQueueUrl(context).split('?')[1] : ''
    if (canonical !== searchParams.toString()) {
      setSearchParams(new URLSearchParams(canonical), { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, context])

  const offset = context ? (context.page - 1) * APPROVALS_PAGE_SIZE : 0
  const logQuery = useQuery({
    queryKey: ['books', 'approval-log', user?.id ?? 0, context],
    queryFn: () =>
      api.listApprovalLog(context!.tab, {
        kind: context!.tab === 'received' ? apiKindOf(context!.kind) : undefined,
        status: context!.status,
        sort: context!.sort,
        limit: APPROVALS_PAGE_SIZE,
        offset,
      }),
    enabled: context != null,
  })
  const rows: ApprovalLogItem[] = logQuery.data?.items ?? []
  const total = logQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / APPROVALS_PAGE_SIZE))

  // An emptied final page (a decision moved the last row off it) normalizes
  // back to the last available page.
  useEffect(() => {
    if (context && logQuery.data && rows.length === 0 && context.page > 1 && context.page > pageCount) {
      updateContext({ ...context, page: pageCount })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logQuery.data])

  // Restore scroll + focus after returning from a record opened from this queue.
  useEffect(() => {
    if (!logQuery.data) return
    const state = location.state as QueueHistoryState | null
    if (!state) return
    if (state.scrollY != null) listRef.current?.scrollTo({ top: state.scrollY })
    if (state.focusBookId != null) {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-book-id="${state.focusBookId}"]`)
        ?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logQuery.data])

  function updateContext(next: ApprovalContext): void {
    const [, qs] = approvalQueueUrl(next).split('?')
    setSearchParams(new URLSearchParams(qs), { replace: true })
  }

  function openRow(item: ApprovalLogItem): void {
    if (!context) return
    // Stash scroll + focus on THIS history entry before navigating away, so
    // browser-back restores them.
    navigate(location.pathname + location.search, {
      replace: true,
      state: { scrollY: listRef.current?.scrollTop ?? 0, focusBookId: item.book_id },
    })
    navigate(approvalRecordUrl(item.book_id, item.version_id, context))
  }

  if (summaryQuery.isPending) {
    return (
      <div className="flex h-full w-full flex-col overflow-y-auto px-6 pb-6 pt-5">
        <div className="flex flex-col overflow-hidden rounded-2xl border border-hairline bg-surface">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} cols={3} />
          ))}
        </div>
      </div>
    )
  }

  if (summaryQuery.isError || !summary) {
    return (
      <div className="flex h-full w-full flex-col overflow-y-auto px-6 pb-6 pt-5">
        <div className="rounded-2xl border border-hairline bg-surface py-12">
          <EmptyState
            icon={Inbox}
            message={t('common.loadError')}
            actionLabel={t('common.retry')}
            onAction={() => void summaryQuery.refetch()}
          />
        </div>
      </div>
    )
  }

  if (!context) {
    return (
      <div className="flex h-full w-full flex-col overflow-y-auto px-6 pb-6 pt-5">
        <header className="mb-3 flex shrink-0 items-end justify-between gap-4">
          <h1 className="text-[1.45em] font-bold tracking-tight text-foreground">
            {t('books.approvals.title')}
          </h1>
          <RefreshButton />
        </header>
        <div className="rounded-2xl border border-hairline bg-surface py-12">
          <EmptyState icon={Inbox} message={t('books.approvals.emptyNoWork')} />
        </div>
      </div>
    )
  }

  const showBothKinds =
    summary.available_received_kinds.includes('approver') &&
    summary.available_received_kinds.includes('reviewer')
  const heading =
    context.tab === 'sent'
      ? t('books.approvals.headingSent')
      : context.kind === 'sign'
        ? t('books.approvals.headingSign')
        : t('books.approvals.headingReview')
  const statusOptions =
    context.tab === 'sent' ? SENT_STATUSES : context.kind === 'review' ? REVIEW_STATUSES : RECEIVED_STATUSES

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto px-6 pb-6 pt-5">
      <header className="mb-3 flex shrink-0 items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[1.45em] font-bold tracking-tight text-foreground">{heading}</h1>
          {!logQuery.isPending && !logQuery.isError && (
            <div className="mt-0.5 text-[0.8em] text-muted-foreground">
              {t('books.approvals.count', { count: total })}
            </div>
          )}
        </div>
        <RefreshButton />
      </header>

      {/* Outer tabs */}
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={t('books.approvals.title')}
          className="inline-flex rounded-full border border-hairline bg-surface p-0.5"
        >
          {(
            [
              { id: 'received' as const, label: t('books.approvals.tabReceived'), show: summary.available_received_kinds.length > 0 },
              { id: 'sent' as const, label: t('books.approvals.tabSent'), show: summary.can_view_sent },
            ]
          )
            .filter((entry) => entry.show)
            .map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={context.tab === entry.id}
                data-testid={`approvals-tab-${entry.id}`}
                onClick={() =>
                  updateContext(
                    resetPage(
                      entry.id === 'sent'
                        ? { tab: 'sent', status: 'all', sort: context.sort, page: 1 }
                        : {
                            tab: 'received',
                            kind: summary.available_received_kinds.includes('approver') ? 'sign' : 'review',
                            status: 'pending',
                            sort: context.sort,
                            page: 1,
                          },
                    ),
                  )
                }
                className={cn(
                  'rounded-full px-3.5 py-1.5 text-[0.8em] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  context.tab === entry.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {entry.label}
              </button>
            ))}
        </div>

        {context.tab === 'received' && showBothKinds && (
          <div
            role="tablist"
            aria-label={t('books.approvals.tabReceived')}
            className="inline-flex rounded-full border border-hairline bg-surface p-0.5"
          >
            {(['sign', 'review'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={context.kind === k}
                data-testid={`approvals-subtab-${k}`}
                onClick={() =>
                  updateContext(
                    resetPage({
                      tab: 'received',
                      kind: k,
                      status: k === 'review' && context.status !== 'all' ? 'pending' : context.status,
                      sort: context.sort,
                      page: 1,
                    }),
                  )
                }
                className={cn(
                  'rounded-full px-3 py-1 text-[0.75em] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  context.kind === k
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {k === 'sign' ? t('books.approvals.subTabSign') : t('books.approvals.subTabReview')}
              </button>
            ))}
          </div>
        )}

        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          {statusOptions.map((filter) => {
            const labelKey =
              filter === 'all'
                ? 'books.filters.statusAll'
                : `books.approval.state${filter[0].toUpperCase()}${filter.slice(1)}`
            return (
              <button
                key={filter}
                type="button"
                aria-pressed={context.status === filter}
                data-testid={`approvals-filter-${filter}`}
                onClick={() => updateContext(resetPage({ ...context, status: filter }))}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[0.75em] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  context.status === filter
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-hairline bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
                )}
              >
                {t(labelKey)}
              </button>
            )
          })}
          <button
            type="button"
            data-testid="approvals-sort-toggle"
            onClick={() =>
              updateContext(
                resetPage({ ...context, sort: (context.sort === 'oldest' ? 'newest' : 'oldest') as ApprovalSort }),
              )
            }
            className="rounded-full border border-hairline bg-surface-tinted px-2.5 py-1 text-[0.75em] font-semibold text-muted-foreground transition-colors hover:bg-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {context.sort === 'oldest' ? t('books.approvals.sortOldest') : t('books.approvals.sortNewest')}
          </button>
        </div>
      </div>

      {/* List */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {logQuery.isPending ? (
          <div className="flex flex-col overflow-hidden rounded-2xl border border-hairline bg-surface">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} cols={3} />
            ))}
          </div>
        ) : logQuery.isError ? (
          <div className="rounded-2xl border border-hairline bg-surface py-12">
            <EmptyState
              icon={Inbox}
              message={t('common.loadError')}
              actionLabel={t('common.retry')}
              onAction={() => void logQuery.refetch()}
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-hairline bg-surface py-12">
            <EmptyState
              icon={Inbox}
              message={
                context.tab === 'sent'
                  ? t('books.approvals.emptySent')
                  : context.kind === 'sign'
                    ? t('books.approvals.emptyReceivedSign')
                    : t('books.approvals.emptyReceivedReview')
              }
            />
          </div>
        ) : (
          <div className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
            {rows.map((item) => (
              <ApprovalRow
                key={item.book_id}
                item={item}
                kind={context.tab === 'received' ? context.kind : null}
                tab={context.tab}
                dfLocale={dfLocale}
                onOpen={() => openRow(item)}
                onPreview={(trigger) => {
                  previewTriggerRef.current = trigger
                  setPreview(item)
                }}
              />
            ))}
          </div>
        )}

        {pageCount > 1 && (
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={context.page <= 1}
              onClick={() => updateContext({ ...context, page: context.page - 1 })}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-hairline text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t('books.approvals.pagePrev')}
            >
              {isAr ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronLeft className="h-4 w-4" aria-hidden />}
            </button>
            <span className="text-[0.78em] text-muted-foreground">
              {t('books.approvals.pagePosition', { page: context.page, total: pageCount })}
            </span>
            <button
              type="button"
              disabled={context.page >= pageCount}
              onClick={() => updateContext({ ...context, page: context.page + 1 })}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-hairline text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t('books.approvals.pageNext')}
            >
              {isAr ? <ChevronLeft className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        )}
      </div>

      <ApprovalPreviewDialog
        item={preview}
        triggerRef={previewTriggerRef}
        onClose={() => setPreview(null)}
        context={context}
      />
    </div>
  )
}
