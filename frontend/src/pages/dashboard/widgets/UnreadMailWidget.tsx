import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'
import { WidgetEmpty, WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { useFitCount } from '@/components/dashboard/useFitCount'
import { api, apiErrorMessage } from '@/lib/api'
import { formatDmy } from '@/lib/formatDmy'
import { useCapabilities } from '@/lib/useCapabilities'
import { BIG_NUMBER, INLINE_LINK, MoreRecords, RECORD_ROW, WidgetFeedback } from './recordWidgetParts'
import { recordAge } from './recordWidgetTime'
import type { WidgetProps } from './types'

const MAIL_URL = '/ledger?tab=email'

export function UnreadMailWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const { has } = useCapabilities()
  const canReadMail = has('ledger.view')
  const query = useQuery({ queryKey: ['dashboard'], queryFn: api.getDashboardSummary, staleTime: 60_000 })
  const qc = useQueryClient()
  const sync = useMutation({
    mutationFn: () => api.syncEmail(),
    onMutate: () => toast.loading(t('dashboard.widgets.emailSync.syncingToast')),
    onSuccess: (result, _vars, toastId) => {
      toast.success(t('dashboard.widgets.ledger.syncSuccess', { imported: result.imported, skipped: result.skipped_duplicate }), { id: toastId })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      void qc.invalidateQueries({ queryKey: ['email-account'] })
      void qc.invalidateQueries({ queryKey: ['ledger'] })
    },
    onError: (err, _vars, toastId) => toast.error(apiErrorMessage(err), { id: toastId }),
  })
  const mail = query.data?.unread_mail
  const emailSync = query.data?.email_sync
  const candidates = mail?.latest ?? []
  const { listRef, visibleCount } = useFitCount(Math.min(candidates.length, rows))
  const visible = candidates.slice(0, visibleCount)
  const list = tier === 'list' || tier === 'tall'
  return (
    <WidgetFrame title={t('dashboard.widgets.ledger.title')} viewAllTo={MAIL_URL} compact={tier === 'glance'}>
      {query.isPending || query.isError || !mail || !emailSync ? <WidgetFeedback pending={query.isPending} retry={query.refetch} /> : <>
        {mail.count > 0 && <Link to={MAIL_URL} className={`${INLINE_LINK} flex shrink-0 items-baseline gap-2`}><bdi dir="ltr" className={BIG_NUMBER}>{mail.count}</bdi>{' '}<span className="text-[0.75em] text-muted-foreground">{t('dashboard.widgets.ledger.unread')}</span></Link>}
        {tier === 'summary' && mail.count > 0 && <p className="pt-1 text-[0.75em] text-muted-foreground">{t('dashboard.widgets.ledger.receivedToday', { count: emailSync.incoming_today })}</p>}
        {mail.count === 0 ? <WidgetEmpty message={t('dashboard.widgets.ledger.empty')} to={MAIL_URL} action={t('dashboard.widgets.ledger.emptyAction')} /> : list && <>
          <ul ref={listRef} className="min-h-0 flex-1 overflow-hidden divide-y divide-hairline pt-1">
            {visible.map((item) => <li key={item.id}><Link to={`/ledger?mail=${item.id}`} className={RECORD_ROW}>
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
              <span className="min-w-0 flex-1"><span className="block truncate" dir="auto">{item.subject || t('dashboard.widgets.ledger.noSubject')}</span><span className="block truncate text-muted-foreground" dir="auto">{item.counterparty}</span></span>
              <bdi dir="ltr" className="shrink-0 font-mono text-muted-foreground">{formatDmy(item.entry_date)}</bdi>
            </Link></li>)}
          </ul>
          <MoreRecords count={mail.count - visible.length} to={MAIL_URL} labelKey="dashboard.widgets.ledger.more" />
        </>}
        <footer className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-[0.75em] leading-tight text-muted-foreground">
          <span className="min-w-0"><span aria-hidden="true" className={`me-1 inline-block size-1.5 rounded-full ${emailSync.enabled ? 'bg-success' : 'bg-warning'}`} />{!emailSync.enabled ? t('dashboard.widgets.ledger.syncOff') : emailSync.last_synced_at ? t('dashboard.widgets.ledger.synced', { age: recordAge(emailSync.last_synced_at, isAr) }) : t('dashboard.widgets.ledger.neverSynced')}</span>
          {emailSync.enabled && canReadMail ? <button type="button" className={`${INLINE_LINK} text-primary disabled:opacity-50`} disabled={sync.isPending} onClick={() => sync.mutate()}>{t(sync.isPending ? 'dashboard.widgets.ledger.syncing' : 'dashboard.widgets.ledger.syncNow')}</button> : has('settings.view') && <Link to="/settings" className={`${INLINE_LINK} text-primary`}>{t('dashboard.widgets.ledger.configure')}</Link>}
          {sync.isError && canReadMail && <span role="alert">{t('dashboard.widgets.ledger.syncError')} <button type="button" className={`${INLINE_LINK} text-primary`} onClick={() => sync.mutate()}>{t('common.retry')}</button></span>}
        </footer>
      </>}
    </WidgetFrame>
  )
}
