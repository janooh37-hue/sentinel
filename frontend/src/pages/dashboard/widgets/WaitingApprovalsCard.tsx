/**
 * WaitingApprovalsCard — Top-zone "glance" big card (#31, revision-scoped).
 * Needs my signature is the primary metric when the caller has signing work.
 * A review-only caller (no signing work, but a pending/historical review)
 * sees their review summary as the primary content instead of a hidden
 * widget — the whole point of assignment-aware summaries. The full
 * interactive queue (BooksAwaitingWidget) renders when this widget lives in
 * a lower zone instead; this is only the compact top-slot variant.
 *
 * Self-hides only when the caller has no assigned received kind at all
 * (never assigned signing or review work, ever) — a valid zero-work scope
 * still renders the calm "all clear" empty state; Top slots are dashboard
 * anchors and shouldn't collapse for an authorized-but-idle caller.
 */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { CheckCircle2, ChevronRight, Stamp } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { approvalQueueUrl } from '@/lib/approvals'
import { useApprovalSummary } from '@/lib/useApprovalSummary'

interface Props {
  onReview: () => void
}

export function WaitingApprovalsCard({
  onReview,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const summaryQuery = useApprovalSummary()
  const summary = summaryQuery.data
  const isLoading = summaryQuery.isPending

  if (summary && summary.available_received_kinds.length === 0) return null

  const signatureCount = summary?.signature.count ?? 0
  const reviewCount = summary?.review.count ?? 0
  // A review-only caller (no signing bucket) sees review work as the primary
  // metric instead of an all-clear card that hides their actual work.
  const primaryIsReview = signatureCount === 0 && reviewCount > 0
  const count = primaryIsReview ? reviewCount : signatureCount
  const oldest = primaryIsReview ? summary?.review.oldest : summary?.signature.oldest
  const secondaryReviewCount = primaryIsReview ? 0 : reviewCount

  const age =
    oldest?.submitted_at != null
      ? Math.max(0, differenceInCalendarDays(new Date(), parseISO(oldest.submitted_at)))
      : null

  return (
    <div className="group relative h-full w-full overflow-hidden rounded-2xl bg-surface p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg">
      <button
        type="button"
        onClick={onReview}
        aria-label={t(primaryIsReview ? 'dashboard.widgetLabels.waiting_reviews_aria' : 'dashboard.widgetLabels.waiting_approvals_aria', { count })}
        className="block w-full cursor-pointer text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="flex items-center gap-2 text-[0.86em] font-medium text-muted-foreground">
          <Stamp className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          {t(primaryIsReview ? 'books.approvals.headingReview' : 'books.approvals.headingSign')}
        </div>

        <div className="mt-2.5 text-[2.4em] font-bold leading-none tracking-tight text-foreground tabular-nums">
          {isLoading ? <Skeleton className="h-9 w-16" /> : count}
        </div>

        {!isLoading && count > 0 && oldest?.subject && (
          <p className="mt-1.5 line-clamp-1 text-[0.78em] text-muted-foreground" dir="auto">
            {t('dashboard.widgetLabels.waiting_approvals_oldest', {
              defaultValue: 'Oldest: {{subject}}',
              subject: oldest.subject,
            })}
            {age != null && ` · ${t('books.approvals.daysAgo', { count: age })}`}
          </p>
        )}

        <div className="mt-3.5 flex items-center justify-between text-[0.78em] text-muted-foreground">
          {count > 0 ? (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
              {t(primaryIsReview ? 'books.approvals.subTabReview' : 'books.approval.awaitingTitle')}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-success">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              {t(primaryIsReview ? 'books.approval.reviewEmpty' : 'books.approval.awaitingEmpty')}
            </span>
          )}
          <span
            className="rounded-full bg-primary px-4 py-1.5 text-[0.78em] font-medium text-primary-foreground shadow-sm transition-all duration-200 group-hover:scale-105 group-hover:bg-primary-hover motion-reduce:!transform-none"
            aria-hidden
          >
            {t('dashboard.widgetLabels.waiting_approvals_cta', { defaultValue: 'Review' })}
          </span>
        </div>

        <ChevronRight
          aria-hidden
          className="absolute end-5 top-5 h-3.5 w-3.5 text-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted-foreground rtl:group-hover:-translate-x-0.5 motion-reduce:!transform-none"
          strokeWidth={1.8}
        />
      </button>

      {/* Separate link, not nested inside the primary button — the caller's
       *  distinct review-bucket count when signing is their primary work. */}
      {secondaryReviewCount > 0 && (
        <Link
          to={approvalQueueUrl({ tab: 'received', kind: 'review', status: 'pending', sort: 'oldest', page: 1 })}
          className="relative z-10 mt-2 flex items-center gap-1 text-[0.74em] font-medium text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:rounded-sm"
        >
          {t('books.approvals.subTabReview')} · {secondaryReviewCount}
        </Link>
      )}
    </div>
  )
}
