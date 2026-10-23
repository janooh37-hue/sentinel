import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { api } from '@/lib/api'
import { approvalQueueUrl, approvalRecordUrl } from '@/lib/approvals'
import type { ApprovalContext } from '@/lib/approvals'
import { useApprovalSummary } from '@/lib/useApprovalSummary'
import { useAuth } from '@/lib/authContext'
import { useRecordDelete } from '@/pages/books/RecordDeleteProvider'
import { BIG_NUMBER, INLINE_LINK, MoreRecords, RECORD_ROW, WidgetFeedback } from './recordWidgetParts'
import { recordAge } from './recordWidgetTime'
import type { WidgetProps } from './types'

const CONTEXT: ApprovalContext = { tab: 'sent', status: 'pending', sort: 'newest', page: 1 }
const PENDING_URL = approvalQueueUrl(CONTEXT)
const RETURNED_URL = approvalQueueUrl({ ...CONTEXT, status: 'returned' })

export function SentApprovalsWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const { user } = useAuth()
  const { pendingIds } = useRecordDelete()
  const query = useApprovalSummary()
  const summary = query.data
  const list = tier === 'list' || tier === 'tall'
  const preview = useQuery({
    queryKey: ['books', 'approval-log', user?.id ?? 0, 'preview', CONTEXT, rows],
    queryFn: () => api.listApprovalLog({ scope: 'sent', status: 'pending', sort: 'newest', limit: rows }),
    enabled: list && !!summary && summary.sent.count > 0,
  })
  const visible = preview.data?.items.filter((item) => !pendingIds.has(item.book_id)).slice(0, rows) ?? []
  const oldest = summary?.sent.oldest
  return (
    <WidgetFrame title={t('dashboard.widgets.sent_approvals.title')} count={list ? summary?.sent.count : undefined} viewAllTo={PENDING_URL}>
      {query.isPending || query.isError || !summary ? <WidgetFeedback pending={query.isPending} retry={query.refetch} /> : <>
        {!list && <Link to={PENDING_URL} className={`${INLINE_LINK} flex shrink-0 items-baseline gap-2`}><bdi dir="ltr" className={BIG_NUMBER}>{summary.sent.count}</bdi>{' '}<span className="text-[0.75em] text-muted-foreground">{t('dashboard.widgets.sent_approvals.pending')}</span></Link>}
        {summary.returned_count > 0 && <Link to={RETURNED_URL} className={`${INLINE_LINK} mt-1 w-fit shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[0.7em] text-accent`}>{t('dashboard.widgets.sent_approvals.needsChanges', { count: summary.returned_count })}</Link>}
        {summary.sent.count === 0 ? <p className="pt-2 text-[0.75em] text-muted-foreground">{t('dashboard.widgets.sent_approvals.empty')}</p> : list ? preview.isPending || preview.isError ? <WidgetFeedback pending={preview.isPending} retry={preview.refetch} /> : <>
          <ul className="min-h-0 flex-1 overflow-hidden divide-y divide-hairline">
            {visible.map((item) => <li key={item.book_id}><Link to={approvalRecordUrl(item.book_id, item.version_id ?? null, CONTEXT)} className={RECORD_ROW}>
              <span className="min-w-0 flex-1"><span className="block truncate" dir="auto">{item.subject || item.ref_number}</span><span className="block truncate text-[0.9em] text-muted-foreground">{t('dashboard.widgets.sent_approvals.waitingOn', { name: (isAr ? item.approver_name_ar || item.approver_name : item.approver_name) || t('dashboard.widgets.sent_approvals.unassigned') })}</span></span>
              <span className="max-w-24 shrink-0 text-[0.85em] text-muted-foreground">{recordAge(item.submitted_at, isAr)}</span>
            </Link></li>)}
          </ul>
          <MoreRecords count={summary.sent.count - visible.length} to={PENDING_URL} labelKey="dashboard.widgets.sent_approvals.more" />
        </> : tier === 'summary' && oldest && <p className="line-clamp-2 pt-1 text-[0.72em] text-muted-foreground" dir="auto">{t('dashboard.widgets.sent_approvals.oldest', { subject: oldest.subject || oldest.ref_number })} · {t('dashboard.widgets.sent_approvals.waitingOn', { name: (isAr ? oldest.approver_name_ar || oldest.approver_name : oldest.approver_name) || t('dashboard.widgets.sent_approvals.unassigned') })} · {recordAge(oldest.submitted_at, isAr)}</p>}
      </>}
    </WidgetFrame>
  )
}
