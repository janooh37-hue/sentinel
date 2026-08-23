import { useInfiniteQuery } from '@tanstack/react-query'
import { FileText, Laptop, Mail, Paperclip } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, type CorrespondenceItemRead } from '@/lib/api'
import { openCorrespondenceInOutlook, outlookBridgeErrorMessage } from '@/lib/outlookBridge'
import { useIsMobile } from '@/lib/useIsMobile'

interface Props {
  employeeId: string
}

function recipientLabel(item: CorrespondenceItemRead): string {
  if (item.counterparty.trim()) return item.counterparty
  return [...item.to_recipients, ...item.cc_recipients]
    .map((recipient) => recipient.name || recipient.address)
    .filter(Boolean)
    .join(', ')
}

export function CorrespondenceTab({ employeeId }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isMobile = useIsMobile()
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  )
  const query = useInfiniteQuery({
    queryKey: ['employee-correspondence', employeeId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.listEmployeeCorrespondence(employeeId, { limit: 50, offset: pageParam }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    enabled: employeeId.length > 0,
  })
  const pages = query.data?.pages ?? []
  const items = pages.flatMap((page) => page.items)
  const total = pages[0]?.total ?? 0

  async function open(item: CorrespondenceItemRead): Promise<void> {
    try {
      await openCorrespondenceInOutlook(item.entry_id, employeeId)
    } catch (error) {
      toast.error(outlookBridgeErrorMessage(error, t))
    }
  }

  if (query.isPending) {
    return <div role="status" className="rounded-2xl bg-surface p-12 text-center text-muted-foreground">{t('common.loading')}</div>
  }
  if (query.isError) {
    return <div className="rounded-2xl border border-accent/30 bg-surface p-8 text-center text-accent">{t('employee.correspondence.loadError')}</div>
  }
  if (items.length === 0) {
    return <div className="rounded-2xl bg-surface p-12 text-center text-muted-foreground">{t('employee.correspondence.empty')}</div>
  }

  return (
    <div className="space-y-3" aria-label={t('employee.correspondence.title')}>
      {items.map((item) => {
        const canOpen = item.channel === 'email' && item.can_open_in_outlook
        const readOnly = !canOpen
        return (
          <article
            key={item.entry_id}
            data-read-only={readOnly ? 'true' : undefined}
            className="rounded-2xl border border-hairline bg-surface p-4 shadow-sm sm:p-5"
          >
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary" aria-hidden>
                {item.channel === 'email' ? <Mail className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <h3 className="min-w-0 truncate font-semibold text-foreground" dir="auto">{item.subject || t('employee.correspondence.noSubject')}</h3>
                  <time className="shrink-0 font-mono text-xs text-muted-foreground" dateTime={item.entry_date}>
                    {dateFormatter.format(new Date(`${item.entry_date}T00:00:00`))}
                  </time>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                  <span dir="auto">{recipientLabel(item) || t('employee.correspondence.noCounterparty')}</span>
                  <span aria-hidden>·</span>
                  <span>{t(`employee.correspondence.direction.${item.direction}`, { defaultValue: item.direction })}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-surface-tinted px-2 py-1" dir="auto">
                    {t(`employee.correspondence.linkSource.${item.link_source}`)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Paperclip className="h-3.5 w-3.5" aria-hidden />
                    {item.attachment_count}
                  </span>
                  {item.to_recipients.length > 0 && (
                    <span dir="auto">{t('employee.correspondence.to', { count: item.to_recipients.length })}</span>
                  )}
                </div>
              </div>
            </div>

            {canOpen ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
                <button
                  type="button"
                  aria-label={t('employee.correspondence.open')}
                  disabled={isMobile}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => { void open(item) }}
                >
                  <Mail className="h-4 w-4" aria-hidden />
                  {t('employee.correspondence.open')}
                </button>
                {isMobile && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Laptop className="h-3.5 w-3.5" aria-hidden />
                    {t('employee.correspondence.desktopRequired')}
                  </span>
                )}
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3 text-xs text-muted-foreground">
                <span>{t('employee.correspondence.readOnly')}</span>
              </div>
            )}
          </article>
        )
      })}
      <p className="text-end text-xs text-muted-foreground">
        {t('employee.correspondence.showing', { shown: items.length, total })}
      </p>
      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => { void query.fetchNextPage() }}
          disabled={query.isFetchingNextPage}
          className="mx-auto block min-h-11 rounded-full border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          {query.isFetchingNextPage ? t('common.loading') : t('employee.correspondence.loadMore')}
        </button>
      )}
    </div>
  )
}
