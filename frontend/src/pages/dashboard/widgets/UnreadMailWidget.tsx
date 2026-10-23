import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { api } from '@/lib/api'
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
    onSuccess: (result) => {
      toast.success(t('dashboard.widgets.ledger.syncSuccess', { imported: result.imported, skipped: result.skipped_duplicate }))
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      void qc.invalidateQueries({ queryKey: ['email-account'] })
      void qc.invalidateQueries({ queryKey: ['ledger'] })
    },
    onError: () => toast.error(t('dashboard.widgets.ledger.syncError')),
  })
  const mail = query.data?.unread_mail
  const emailSync = query.data?.email_sync
  const visible = mail?.latest.slice(0, rows) ?? []
  const list = tier === 'list' || tier === 'tall'
  return (
    <WidgetFrame title={t('dashboard.widgets.ledger.title')} viewAllTo={MAIL_URL}>
      {query.isPending || query.isError || !mail || !emailSync ? <WidgetFeedback pending={query.isPending} retry={query.refetch} /> : <>
        <Link to={MAIL_URL} className={`${INLINE_LINK} flex shrink-0 items-baseline gap-2`}><bdi dir="ltr" className={BIG_NUMBER}>{mail.count}</bdi>{' '}<span className="text-[0.75em] text-muted-foreground">{t('dashboard.widgets.ledger.unread')}</span></Link>
        {tier === 'summary' && <p className="pt-1 text-[0.7em] text-muted-foreground">{t('dashboard.widgets.ledger.receivedToday', { count: emailSync.incoming_today })}</p>}
        {mail.count === 0 ? <p className="pt-1 text-[0.72em] text-muted-foreground">{t('dashboard.widgets.ledger.empty')}</p> : list && <>
          <ul className="min-h-0 flex-1 overflow-hidden divide-y divide-hairline pt-1">
            {visible.map((item) => <li key={item.id}><Link to={`/ledger?mail=${item.id}`} className={RECORD_ROW}>
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
              <span className="min-w-0 flex-1"><span className="block truncate" dir="auto">{item.subject || t('dashboard.widgets.ledger.noSubject')}</span><span className="block truncate text-[0.9em] text-muted-foreground" dir="auto">{item.counterparty}</span></span>
              <bdi dir="ltr" className="shrink-0 font-mono text-[0.85em] text-muted-foreground">{item.entry_date}</bdi>
            </Link></li>)}
          </ul>
          <MoreRecords count={mail.count - visible.length} to={MAIL_URL} labelKey="dashboard.widgets.ledger.more" />
        </>}
        <footer className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-[0.65em] text-muted-foreground">
          <span className="min-w-0"><span aria-hidden="true" className={`me-1 inline-block size-1.5 rounded-full ${emailSync.enabled ? 'bg-success' : 'bg-warning'}`} />{!emailSync.enabled ? t('dashboard.widgets.ledger.syncOff') : emailSync.last_synced_at ? t('dashboard.widgets.ledger.synced', { age: recordAge(emailSync.last_synced_at, isAr) }) : t('dashboard.widgets.ledger.neverSynced')}</span>
          {emailSync.enabled && canReadMail ? <button type="button" className={`${INLINE_LINK} text-primary disabled:opacity-50`} disabled={sync.isPending} onClick={() => sync.mutate()}>{t(sync.isPending ? 'dashboard.widgets.ledger.syncing' : 'dashboard.widgets.ledger.syncNow')}</button> : has('settings.view') && <Link to="/settings" className={`${INLINE_LINK} text-primary`}>{t('dashboard.widgets.ledger.configure')}</Link>}
          {sync.isError && canReadMail && <span role="alert">{t('dashboard.widgets.ledger.syncError')} <button type="button" className={`${INLINE_LINK} text-primary`} onClick={() => sync.mutate()}>{t('common.retry')}</button></span>}
        </footer>
      </>}
    </WidgetFrame>
  )
}
