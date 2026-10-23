import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { useFitCount } from '@/components/dashboard/useFitCount'
import { api } from '@/lib/api'
import { useRecordDelete } from '@/pages/books/RecordDeleteProvider'
import { BIG_NUMBER, INLINE_LINK, MoreRecords, RECORD_ROW, WidgetFeedback } from './recordWidgetParts'
import type { WidgetProps } from './types'

const STATES = [
  ['approved', 'bg-success'], ['pending', 'bg-info'], ['awaiting_scan', 'bg-warning'],
  ['returned', 'bg-accent'], ['rejected', 'bg-primary'], ['not_submitted', 'bg-faint'],
] as const

export function MyDocumentsWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const query = useQuery({ queryKey: ['dashboard'], queryFn: api.getDashboardSummary, staleTime: 60_000 })
  const records = query.data?.my_records
  const { pendingIds } = useRecordDelete()
  const month = records ? new Intl.DateTimeFormat(isAr ? 'ar' : 'en', { month: 'long', timeZone: 'UTC' }).format(new Date(`${records.month}-01T00:00:00Z`)) : ''
  const title = records ? t('dashboard.widgets.pending.monthTitle', { month }) : t('dashboard.widgets.pending.title')
  const stateUrl = (state: string) => `/books?${new URLSearchParams({ mine: '1', status: state === 'not_submitted' ? 'none' : state, from: records!.from_date, to: records!.to_date })}`
  const to = records ? stateUrl('approved') : undefined
  const parts = records ? STATES.filter(([state]) => records[state] > 0) : []
  const total = records ? parts.reduce((sum, [state]) => sum + records[state], 0) : 0
  const candidates = records?.latest_approved.filter((row) => !pendingIds.has(row.book_id)) ?? []
  const { listRef, visibleCount } = useFitCount(Math.min(candidates.length, rows))
  const visible = candidates.slice(0, visibleCount)
  const list = tier === 'list' || tier === 'tall'
  const legendParts = tier === 'glance' ? parts.filter(([state]) => state !== 'approved') : parts
  const shownParts = list ? legendParts : legendParts.slice(0, tier === 'glance' ? 1 : 2)
  const hiddenParts = legendParts.length - shownParts.length
  const breakdownTo = records ? `/books?${new URLSearchParams({ mine: '1', from: records.from_date, to: records.to_date })}` : '/books?mine=1'
  return (
    <WidgetFrame title={title} viewAllTo={to}>
      {query.isPending || query.isError || !records ? <WidgetFeedback pending={query.isPending} retry={query.refetch} /> : (
        <>
          <Link to={to!} className={`${INLINE_LINK} flex shrink-0 items-baseline gap-2`}>
            <bdi dir="ltr" className={BIG_NUMBER}>{records.approved}</bdi>
            {' '}
            <span className="min-w-0 truncate text-[0.75em] text-muted-foreground" title={t('dashboard.widgets.pending.approved')}>{t('dashboard.widgets.pending.approved')}</span>
          </Link>
          {total === 0 ? <p className="truncate pt-2 text-[0.75em] text-muted-foreground" title={t('dashboard.widgets.pending.empty')}>{t('dashboard.widgets.pending.empty')}</p> : tier === 'glance' ? (
            <div className="flex min-w-0 shrink-0 gap-x-2 pt-2 text-[0.7em] text-muted-foreground">
              {shownParts.map(([state]) => <Link key={state} to={stateUrl(state)} title={`${records[state]} ${t(`dashboard.widgets.pending.${state}`)}`} className={`${INLINE_LINK} min-w-0 flex-1 truncate`}>{records[state]} {t(`dashboard.widgets.pending.${state}`)}</Link>)}
              {hiddenParts > 0 && <Link to={breakdownTo} className={`${INLINE_LINK} shrink-0`} aria-label={t('dashboard.widgets.pending.more', { count: hiddenParts })}>+{hiddenParts}</Link>}
            </div>
          ) : (
            <>
              <div aria-hidden="true" className="mt-2 flex h-1.5 shrink-0 overflow-hidden rounded-full">
                {parts.map(([state, color]) => <span key={state} className={color} style={{ width: `${records[state] / total * 100}%` }} />)}
              </div>
              <div className={`flex min-w-0 shrink-0 gap-x-3 gap-y-1 py-2 text-[0.68em] text-muted-foreground ${list ? 'flex-wrap' : ''}`}>
                {shownParts.map(([state, color]) => <Link key={state} to={stateUrl(state)} title={`${records[state]} ${t(`dashboard.widgets.pending.${state}`)}`} className={`${INLINE_LINK} inline-flex min-w-0 items-center gap-1 ${list ? '' : 'flex-1'}`}><span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${color}`} /><bdi dir="ltr" className="shrink-0 font-mono font-semibold text-foreground">{records[state]}</bdi><span className="truncate">{t(`dashboard.widgets.pending.${state}`)}</span></Link>)}
                {hiddenParts > 0 && <Link to={breakdownTo} className={`${INLINE_LINK} shrink-0`} aria-label={t('dashboard.widgets.pending.more', { count: hiddenParts })}>+{hiddenParts}</Link>}
              </div>
            </>
          )}
          {list && records.approved > 0 && <>
            <ul ref={listRef} className="min-h-0 flex-1 overflow-hidden divide-y divide-hairline">
              {visible.map((row) => <li key={row.book_id}><Link to={`/books?open=${row.book_id}`} className={RECORD_ROW}>
                <span className="min-w-0 flex-1"><span className="block truncate" dir="auto"><bdi dir="ltr" className="font-mono text-primary">{row.ref_number}</bdi> · {row.subject}</span><span className="block truncate text-[0.9em] text-muted-foreground" dir="auto">{(isAr ? row.employee_name_ar || row.employee_name_en : row.employee_name_en) || t('dashboard.widgets.pending.general')}</span></span>
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-[0.85em]"><span className="text-success">{t('dashboard.widgets.pending.approved')}</span><bdi dir="ltr" className="font-mono text-muted-foreground">{row.created_at.slice(0, 10)}</bdi></span>
              </Link></li>)}
            </ul>
            <MoreRecords count={records.approved - visible.length} to={to!} labelKey="dashboard.widgets.pending.more" />
          </>}
        </>
      )}
    </WidgetFrame>
  )
}
