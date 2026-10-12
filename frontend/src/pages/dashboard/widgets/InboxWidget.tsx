/**
 * InboxWidget — records sent directly to me (widget id `inbox`, top-eligible
 * metric card). Big number = unread; received/sent link to the Records inbox
 * filters, and the four purposes break the received count down. Self-hides
 * without `books.view` (the summary endpoint needs it).
 */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FileInput } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { useCapabilities } from '@/lib/useCapabilities'
import { useInboxSummary } from '@/pages/books/useInboxCount'

const PURPOSES = ['info', 'action', 'reply', 'circulate'] as const
const RECEIVED_URL = '/books?inbox=received'
const SENT_URL = '/books?inbox=sent'

const LINK =
  'rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'

export function InboxWidget(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const canView = has('books.view')
  const summaryQuery = useInboxSummary(canView)
  if (!canView) return null

  const summary = summaryQuery.data
  const isLoading = summaryQuery.isPending

  return (
    <div className="flex h-full w-full flex-col rounded-2xl bg-surface p-5">
      <div className="flex min-h-[28px] items-center gap-2 text-[0.86em] font-medium text-muted-foreground">
        <FileInput className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        {t('dashboard.widgetLabels.inbox')}
      </div>

      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[2.4em] font-bold leading-none tracking-tight text-foreground tabular-nums">
          {isLoading ? <Skeleton className="h-9 w-16" /> : <bdi dir="ltr">{summary?.unread ?? 0}</bdi>}
        </span>
        <span className="text-[0.78em] text-muted-foreground">{t('dashboard.widgets.inbox.unread')}</span>
      </div>

      {summary && (
        <>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.78em] text-muted-foreground">
            <Link to={RECEIVED_URL} className={LINK}>
              {t('dashboard.widgets.inbox.received')}:{' '}
              <bdi dir="ltr" className="font-semibold text-foreground tabular-nums">
                {summary.received}
              </bdi>
            </Link>
            <Link to={SENT_URL} className={LINK}>
              {t('dashboard.widgets.inbox.sent')}:{' '}
              <bdi dir="ltr" className="font-semibold text-foreground tabular-nums">
                {summary.sent}
              </bdi>
            </Link>
          </div>
          {summary.received > 0 && (
            <ul
              aria-label={t('dashboard.widgets.inbox.byPurpose')}
              className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[0.75em] text-muted-foreground"
            >
              {PURPOSES.map((purpose) => (
                <li key={purpose} className="flex items-center justify-between gap-2">
                  <span className="truncate">{t(`books.send.purposes.${purpose}`)}</span>
                  <bdi dir="ltr" className="font-semibold text-foreground tabular-nums">
                    {summary.by_purpose[purpose]}
                  </bdi>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Link
        to={RECEIVED_URL}
        className="ms-auto mt-auto flex items-center gap-1 pt-3.5 text-[0.78em] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        {t('dashboard.widgets.inbox.open')}
        <span aria-hidden className="rtl:rotate-180">
          →
        </span>
      </Link>
    </div>
  )
}
