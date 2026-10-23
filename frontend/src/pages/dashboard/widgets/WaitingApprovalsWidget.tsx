import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { useFitCount } from '@/components/dashboard/useFitCount'
import { api } from '@/lib/api'
import { apiKindOf, approvalQueueUrl, approvalRecordUrl, defaultApprovalContext, isLateAdvisory } from '@/lib/approvals'
import type { ApprovalContext } from '@/lib/approvals'
import { useApprovalSummary } from '@/lib/useApprovalSummary'
import { useAuth } from '@/lib/authContext'
import { useRecordDelete } from '@/pages/books/RecordDeleteProvider'
import { BIG_NUMBER, INLINE_LINK, MoreRecords, RECORD_ROW, WidgetFeedback } from './recordWidgetParts'
import { recordAge } from './recordWidgetTime'
import type { WidgetProps } from './types'

export function WaitingApprovalsWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const { user } = useAuth()
  const { pendingIds } = useRecordDelete()
  const query = useApprovalSummary()
  const summary = query.data
  const landing = summary ? defaultApprovalContext(summary) : null
  // Idle received scopes stay received, even when the generic landing rule prefers Sent.
  const kind = landing?.tab === 'received' ? landing.kind : summary?.available_received_kinds?.includes('approver') ? 'sign' : 'review'
  const context: ApprovalContext = { tab: 'received', kind, status: 'pending', sort: 'newest', page: 1 }
  const bucket = kind === 'review' ? summary?.review : summary?.signature
  const to = approvalQueueUrl(context)
  const list = tier === 'list' || tier === 'tall'
  const preview = useQuery({
    queryKey: ['books', 'approval-log', user?.id ?? 0, 'preview', context, rows],
    queryFn: () => api.listApprovalLog({ scope: 'received', kind: apiKindOf(kind), status: 'pending', sort: 'newest', limit: rows }),
    enabled: list && !!summary && (bucket?.count ?? 0) > 0,
  })
  const candidates = preview.data?.items.filter((item) => !pendingIds.has(item.book_id)) ?? []
  const { listRef, visibleCount } = useFitCount(Math.min(candidates.length, rows))
  const visible = candidates.slice(0, visibleCount)
  const oldest = bucket?.oldest
  const age = oldest?.submitted_at ? recordAge(oldest.submitted_at, isAr) : null
  const reviewCount = kind === 'sign' ? summary?.review.count ?? 0 : 0
  return (
    <WidgetFrame title={t(kind === 'review' ? 'dashboard.widgets.waiting_approvals.reviewTitle' : 'dashboard.widgets.waiting_approvals.title')} count={list ? bucket?.count : undefined} viewAllTo={to}>
      {query.isPending || query.isError || !bucket ? <WidgetFeedback pending={query.isPending} retry={query.refetch} /> : <>
        {!list && <Link to={to} className={`${INLINE_LINK} flex shrink-0 items-baseline gap-2`}><bdi dir="ltr" className={BIG_NUMBER}>{bucket.count}</bdi>{' '}<span className="text-[0.75em] text-muted-foreground">{t(kind === 'review' ? 'dashboard.widgets.waiting_approvals.toReview' : 'dashboard.widgets.waiting_approvals.toSign')}</span></Link>}
        {!list && oldest && <p className="line-clamp-2 pt-2 text-[0.72em] text-muted-foreground" dir="auto">{t('dashboard.widgets.waiting_approvals.oldest', { detail: tier === 'summary' && oldest.subject ? `${oldest.subject}${age ? ` · ${age}` : ''}` : age || oldest.subject || oldest.ref_number })}</p>}
        {reviewCount > 0 && <Link to={approvalQueueUrl({ tab: 'received', kind: 'review', status: 'pending', sort: 'newest', page: 1 })} className={`${INLINE_LINK} shrink-0 py-1 text-[0.7em] text-info`}>{t('dashboard.widgets.waiting_approvals.reviewMore', { count: reviewCount })}</Link>}
        {bucket.count === 0 ? <p className="pt-2 text-[0.75em] text-muted-foreground">{t('dashboard.widgets.waiting_approvals.empty')}</p> : list && (preview.isPending || preview.isError ? <WidgetFeedback pending={preview.isPending} retry={preview.refetch} /> : <>
          <ul ref={listRef} className="min-h-0 flex-1 overflow-hidden divide-y divide-hairline">
            {visible.map((item) => <li key={item.book_id}><Link to={approvalRecordUrl(item.book_id, item.version_id ?? null, context)} className={RECORD_ROW}>
              <span className="min-w-0 flex-1"><span className="block truncate" dir="auto">{item.subject || item.ref_number}</span><span className="block truncate text-[0.9em] text-muted-foreground"><bdi dir="ltr" className="font-mono">{item.ref_number}</bdi> · {(isAr ? item.submitted_by_name_ar || item.submitted_by_name : item.submitted_by_name) || t('dashboard.widgets.waiting_approvals.unknownSender')}</span></span>
              <span className="flex max-w-24 shrink-0 flex-col items-end gap-1 text-[0.85em] text-muted-foreground"><span>{recordAge(item.submitted_at, isAr)}</span>{item.priority === 'High' && <span className="rounded bg-accent-soft px-1 text-accent">{t('books.approval.high')}</span>}{isLateAdvisory(item) && <span className="rounded bg-warning-soft px-1 text-warning">{t('books.approvals.lateAdvisory')}</span>}</span>
            </Link></li>)}
          </ul>
          <MoreRecords count={bucket.count - visible.length} to={to} labelKey="dashboard.widgets.waiting_approvals.more" />
        </>)}
      </>}
    </WidgetFrame>
  )
}
