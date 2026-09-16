/**
 * SentApprovalsWidget — lower-zone metric card for the caller's own pending
 * sent submissions (#31, revision-scoped). Registered as widget id
 * `sent_approvals`. Uses separate links for "Needs your changes" and "All
 * requests I sent" rather than a clickable parent containing interactive
 * children.
 *
 * Self-hides only when the caller lacks sent-scope visibility at all
 * (`can_view_sent === false`) — a valid zero-pending scope still renders the
 * mockup's calm empty state.
 */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { CheckCircle2, Send } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { approvalQueueUrl } from '@/lib/approvals'
import { useApprovalSummary } from '@/lib/useApprovalSummary'

export function SentApprovalsWidget(): React.JSX.Element | null {
  const { t } = useTranslation()
  const summaryQuery = useApprovalSummary()
  const summary = summaryQuery.data
  const isLoading = summaryQuery.isPending

  if (summary && !summary.can_view_sent) return null

  const count = summary?.sent.count ?? 0
  const oldest = summary?.sent.oldest
  const returnedCount = summary?.returned_count ?? 0
  const age =
    oldest?.submitted_at != null
      ? Math.max(0, differenceInCalendarDays(new Date(), parseISO(oldest.submitted_at)))
      : null

  const allSentUrl = approvalQueueUrl({ tab: 'sent', status: 'all', sort: 'oldest', page: 1 })
  const returnedUrl = approvalQueueUrl({ tab: 'sent', status: 'returned', sort: 'oldest', page: 1 })

  return (
    <div className="flex h-full w-full flex-col rounded-2xl bg-surface p-5">
      <div className="flex min-h-[28px] items-center gap-2 text-[0.86em] font-medium text-muted-foreground">
        <Send className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        {t('dashboard.widgetLabels.sent_approvals')}
      </div>

      <div className="mt-1.5 text-[2.4em] font-bold leading-none tracking-tight text-foreground tabular-nums">
        {isLoading ? <Skeleton className="h-9 w-16" /> : count}
      </div>

      {!isLoading &&
        (count > 0 && oldest ? (
          <div className="mt-2 flex flex-col gap-0.5 text-[0.78em] text-muted-foreground">
            {oldest.subject && (
              <p className="line-clamp-1" dir="auto">
                {oldest.subject}
              </p>
            )}
            <p>
              {t('books.approvals.assignedSigner')}:{' '}
              <span className="text-foreground">{oldest.approver_name ?? '—'}</span>
              {age != null && ` · ${t('books.approvals.daysAgo', { count: age })}`}
            </p>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-1.5 text-[0.78em] text-success">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            {t('books.approvals.emptySent')}
          </div>
        ))}

      {returnedCount > 0 && (
        <Link
          to={returnedUrl}
          className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[0.72em] font-semibold text-warning hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {t('books.approvals.needsChanges')} · {returnedCount}
        </Link>
      )}

      <Link
        to={allSentUrl}
        className="ms-auto mt-auto flex items-center gap-1 pt-3.5 text-[0.78em] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        {t('books.approvals.allSent')}
        <span aria-hidden className="rtl:rotate-180">
          →
        </span>
      </Link>
    </div>
  )
}
