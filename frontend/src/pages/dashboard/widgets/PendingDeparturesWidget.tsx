import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'
import { WidgetEmpty, WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { useFitCount } from '@/components/dashboard/useFitCount'
import { siteToday } from '@/components/employees/useAttendanceAttention'
import { api, apiErrorMessage, ApiError } from '@/lib/api'
import { computeDaysBetween } from '@/lib/leaveDateMath'
import { pickEmployeeName } from '@/lib/employeeName'
import { useCapabilities } from '@/lib/useCapabilities'
import type { WidgetProps } from './types'
import { MorePeople, PEOPLE_BIG, PEOPLE_LINK, PEOPLE_META, PEOPLE_NAME, PeopleAvatar, PeopleFeedback } from './peopleWidgetParts'

const TO = '/employees?pending=1'

async function pendingEmployees() {
  const first = await api.listEmployees({ pending: true, limit: 100 })
  const items = [...first.items]
  let total = first.total
  while (items.length < total) {
    const next = await api.listEmployees({ pending: true, limit: 100, offset: items.length })
    if (next.items.length === 0) break
    items.push(...next.items)
    total = next.total
  }
  return { items, total }
}

export function PendingDeparturesWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const { has } = useCapabilities()
  const query = useQuery({ queryKey: ['employees', 'pending'], queryFn: pendingEmployees, staleTime: 60_000 })
  const cancel = useMutation({
    // Clearing only the date cannot reactivate a departure already applied by the server.
    mutationFn: (id: string) => api.updateEmployee(id, { end_date: null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employees'] })
      toast.success(t('pendingDepartures.cancelled'))
    },
    onError: (error) => {
      void qc.invalidateQueries({ queryKey: ['employees'] })
      toast.error(error instanceof ApiError && error.code === 'EMPLOYEE_INVALID_STATUS_END_DATE' ? t('pendingDepartures.alreadyApplied') : apiErrorMessage(error))
    },
  })
  const all = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const list = tier === 'list' || tier === 'tall'
  const { listRef, visibleCount } = useFitCount(Math.min(all.length, rows))
  const visible = all.slice(0, visibleCount)
  const more = total - visible.length
  const today = siteToday()
  const due = all.filter((item) => {
    const days = item.end_date ? computeDaysBetween(today, item.end_date) - 1 : -1
    return days >= 0 && days <= 7
  }).length
  return (
    <WidgetFrame title={t('dashboard.widgets.pending_departures.title')} count={list && query.isSuccess ? total : undefined} viewAllTo={TO} compact={tier === 'glance'}>
      {query.isPending || query.isError ? <PeopleFeedback pending={query.isPending} retry={query.refetch} /> : total === 0 ? (
        <WidgetEmpty message={t('dashboard.widgets.pending_departures.empty')} to={TO} action={t('dashboard.widgets.pending_departures.emptyAction')} />
      ) : list ? (
        <>
          <ul ref={listRef} className="min-h-0 flex-1 overflow-hidden">{visible.map((item) => {
            const name = pickEmployeeName(item, i18n.language)
            const days = item.end_date ? computeDaysBetween(today, item.end_date) - 1 : null
            const when = days === null ? '' : days < 0 ? t('pendingDepartures.overdue') : days === 0 ? t('pendingDepartures.dueToday') : t('pendingDepartures.daysLeft', { count: days })
            return <li key={item.id} className="flex min-w-0 items-center gap-1 py-1">
              <Link to={`/employees/${encodeURIComponent(item.id)}`} className={`${PEOPLE_LINK} flex min-w-0 flex-1 items-center gap-2 py-1`}>
                <PeopleAvatar name={name} /><span className="min-w-0"><bdi className={PEOPLE_NAME}>{name}</bdi><span className={`${PEOPLE_META} block truncate`}><bdi className="font-mono">{item.id}</bdi> · {item.pending_status ? t(`employees.status.${item.pending_status}`) : ''}{item.pending_status === 'Transferred' && item.transfer_site ? ` · ${item.transfer_site}` : ''}</span><span className="block text-[0.75em] leading-tight text-warning">{when}</span></span>
              </Link>
              {has('employees.edit') && <button type="button" className={`${PEOPLE_LINK} shrink-0 text-[0.75em] disabled:opacity-50`} disabled={cancel.isPending} onClick={() => cancel.mutate(item.id)} aria-label={t('dashboard.widgets.pending_departures.cancelFor', { name })}>{t('pendingDepartures.cancel')}</button>}
            </li>
          })}</ul>
          <MorePeople count={more} to={TO} label={t('dashboard.widgets.pending_departures.more', { count: more })} />
        </>
      ) : (
        <>
          <Link to={TO} className={`${PEOPLE_LINK} ${PEOPLE_BIG}`}>{total}</Link>
          <p className="pt-2 text-[0.75em] leading-tight text-warning">{t('dashboard.widgets.pending_departures.due', { count: due })}</p>
        </>
      )}
    </WidgetFrame>
  )
}
