/**
 * BooksAwaitingWidget — lower-zone dashboard widget showing the caller's
 * assignment-aware approvals summary plus a short preview of their primary
 * bucket (#31, revision-scoped). Rows send the caller to the canonical
 * record page for the actual sign/review action — this widget carries no
 * one-click decision controls.
 *
 * Self-hides only when the caller has no assigned received kind at all
 * (`available_received_kinds.length === 0`); a valid zero-work scope still
 * renders the calm empty state.
 */

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNow, parseISO, type Locale } from 'date-fns'
import { ar as arLocale } from 'date-fns/locale'
import { ArrowLeftRight, ChevronRight, Inbox } from 'lucide-react'

import { api, type ApprovalLogItem } from '@/lib/api'
import { apiKindOf, approvalQueueUrl, approvalRecordUrl, isLateAdvisory } from '@/lib/approvals'
import type { ApprovalContext, ApprovalKind } from '@/lib/approvals'
import { useApprovalSummary } from '@/lib/useApprovalSummary'
import { useAuth } from '@/lib/authContext'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const PREVIEW_LIMIT = 5

function relTime(iso: string | null | undefined, locale?: Locale): string {
  if (!iso) return '—'
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale })
  } catch {
    return iso.slice(0, 10)
  }
}


function AwaitingRow({
  item,
  isAr,
  dfLocale,
  context,
}: {
  item: ApprovalLogItem
  isAr: boolean
  dfLocale?: Locale
  context: ApprovalContext
}): React.JSX.Element {
  const { t } = useTranslation()
  const priIsHigh = item.priority === 'High'
  const catName = isAr ? (item.category_name_ar ?? item.category_name_en) : item.category_name_en
  const late = isLateAdvisory(item)

  return (
    <Link
      to={approvalRecordUrl(item.book_id, item.version_id, context)}
      data-testid="approval-preview-row"
      className={cn(
        'relative flex flex-col gap-2 rounded-xl border border-hairline bg-surface px-4 py-3 transition-shadow hover:shadow-sm',
        'border-s-2 border-s-warning',
      )}
    >
      {/* ── head ── */}
      <header className="flex items-center gap-2">
        <span className="shrink-0 rounded-md bg-surface-tinted px-1.5 py-0.5 font-mono text-[0.72em] font-semibold text-foreground">
          <bdi dir="ltr">{item.ref_number}</bdi>
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.78em] text-muted-foreground">
          {catName}
        </span>
        <span className="font-mono text-[0.7em] text-muted-foreground">
          {relTime(item.submitted_at, dfLocale)}
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
      {item.subject && (
        <p className="line-clamp-2 text-[0.82em] leading-snug text-foreground" dir="auto">
          {item.subject}
        </p>
      )}

      {/* ── footer ── */}
      <footer className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[0.72em] text-muted-foreground">
          {t('books.approval.submitter')}:{' '}
          <span className="text-foreground">{item.submitted_by_name ?? '—'}</span>
        </span>
        {late && (
          <span className="shrink-0 rounded-full bg-warning-soft px-1.5 py-0.5 text-[0.65em] font-semibold text-warning">
            {t('books.approvals.lateAdvisory')}
          </span>
        )}
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" strokeWidth={2} aria-hidden />
      </footer>
    </Link>
  )
}

export function BooksAwaitingWidget(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const dfLocale = isAr ? arLocale : undefined
  const { user } = useAuth()

  const summaryQuery = useApprovalSummary()
  const summary = summaryQuery.data
  const signatureCount = summary?.signature.count ?? 0
  const reviewCount = summary?.review.count ?? 0

  // Primary bucket: signature work first, then review work, then whichever
  // received kind is authorized (an all-clear scope still needs a kind to
  // preview against); null only when neither kind is authorized at all.
  const primaryKind: ApprovalKind | null =
    signatureCount > 0
      ? 'sign'
      : reviewCount > 0
        ? 'review'
        : summary?.available_received_kinds.includes('approver')
          ? 'sign'
          : summary?.available_received_kinds.includes('reviewer')
            ? 'review'
            : null

  const context: ApprovalContext | null =
    primaryKind != null
      ? { tab: 'received', kind: primaryKind, status: 'pending', sort: 'oldest', page: 1 }
      : null

  const previewQuery = useQuery({
    queryKey: ['books', 'approval-log', user?.id ?? 0, 'preview', context],
    queryFn: () =>
      api.listApprovalLog({
        scope: 'received',
        kind: apiKindOf(context!.kind),
        status: 'pending',
        sort: 'oldest',
        limit: PREVIEW_LIMIT,
      }),
    enabled: context != null,
  })

  // Gate: self-hide only when the caller has no assigned received kind at
  // all. A valid zero-work scope still renders — Home summaries anchor the
  // dashboard for authorized-but-idle callers.
  if (summary && summary.available_received_kinds.length === 0) return null

  const rows = previewQuery.data?.items ?? []
  const isLoading = summaryQuery.isPending || (context != null && previewQuery.isPending)
  const isEmpty = context != null && previewQuery.isSuccess && rows.length === 0

  return (
    <section className="mb-6 rounded-2xl border border-hairline bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
        <h3 className="text-[0.86em] font-semibold text-foreground">
          {t(primaryKind === 'review' ? 'books.approvals.headingReview' : 'books.approval.awaitingTitle')}
        </h3>
        {(isLoading || (summary?.actionable_count ?? 0) > 0) && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 font-mono text-[0.7em] font-semibold text-warning">
            {isLoading ? '…' : summary?.actionable_count}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-2 px-4 py-3">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-xl border border-hairline p-3">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-2.5 w-2/3" />
            </div>
          ))
        ) : previewQuery.isError ? (
          <EmptyState
            icon={Inbox}
            message={t('common.loadError')}
            actionLabel={t('common.retry')}
            onAction={() => void previewQuery.refetch()}
          />
        ) : isEmpty ? (
          <EmptyState icon={Inbox} message={t(primaryKind === 'review' ? 'books.approval.reviewEmpty' : 'books.approval.awaitingEmpty')} />
        ) : (
          context &&
          rows.map((item) => (
            <AwaitingRow
              key={item.book_id}
              item={item}
              isAr={isAr}
              dfLocale={dfLocale}
              context={context}
            />
          ))
        )}
      </div>

      {/* Footer — into the full approvals log, same primary bucket. */}
      {context && (
        <div className="border-t border-hairline px-5 py-2.5">
          <Link
            to={approvalQueueUrl(context)}
            data-testid="approvals-full-log-link"
            className="flex items-center gap-1.5 text-[0.78em] font-semibold text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
            {t('books.approvals.viewFullLog')}
            <ChevronRight className="h-3 w-3 rtl:-scale-x-100" strokeWidth={2} aria-hidden />
          </Link>
        </div>
      )}
    </section>
  )
}
