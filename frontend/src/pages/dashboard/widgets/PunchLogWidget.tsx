import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { WidgetFrame, WIDGET_SUPPORT } from '@/components/dashboard/WidgetFrame'
import { siteToday } from '@/components/employees/useAttendanceAttention'
import { api } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { useCapabilities } from '@/lib/useCapabilities'
import { canViewAttendanceRoster } from '@/lib/workforceAttendance'
import { siteTime } from '@/pages/employees/attendance/attendanceModel'
import { PeopleFeedback } from './peopleWidgetParts'
import type { WidgetProps } from './types'

export function PunchLogWidget({ tier }: WidgetProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const { has, isLoading } = useCapabilities()
  const allowed = !isLoading && canViewAttendanceRoster(has)
  const today = siteToday()
  const query = useQuery({
    queryKey: ['attendance-punches', today],
    queryFn: () => api.listAttendancePunches({ operational_date: today, limit: 20 }),
    enabled: allowed,
    staleTime: 60_000,
  })
  if (!allowed) return null
  const punches = [...(query.data?.items ?? [])].sort((a, b) =>
    new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime() || b.punch_id - a.punch_id)
  return (
    <WidgetFrame title={t('dashboard.widgets.punch_log.title')} viewAllTo="/employees/attendance" compact={tier === 'glance'}>
      {query.isPending || query.isError ? <div className="[&_button]:inline-flex [&_button]:min-h-11 [&_button]:items-center"><PeopleFeedback pending={query.isPending} retry={query.refetch} /></div> : punches.length === 0 ? (
        <p className={`${WIDGET_SUPPORT} text-muted-foreground`}>{t('dashboard.widgets.punch_log.empty')}</p>
      ) : (
        <>
          <p className={`${WIDGET_SUPPORT} mb-2 text-muted-foreground`}>{t('dashboard.widgets.punch_log.subtitle')}</p>
          <div aria-hidden="true" className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] gap-2 border-b border-hairline pb-1 text-[0.75em] text-muted-foreground @[32rem]/widget:grid-cols-[3.5rem_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <span>{t('dashboard.widgets.punch_log.time')}</span><span>{t('dashboard.widgets.punch_log.employee')}</span>
            <span className="hidden @[32rem]/widget:block">{t('dashboard.widgets.punch_log.post')}</span>
            <span className="hidden @[32rem]/widget:block">{t('dashboard.widgets.punch_log.device')}</span>
            <span>{t('dashboard.widgets.punch_log.directionLabel')}</span>
          </div>
          <ul aria-label={t('dashboard.widgets.punch_log.title')} className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto">
            {punches.map((punch) => (
              <li key={punch.punch_id} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-start gap-2 py-2 text-[0.75em] @[32rem]/widget:grid-cols-[3.5rem_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <bdi dir="ltr" className="font-mono tabular-nums">{siteTime(punch.occurred_at)}</bdi>
                <span className="min-w-0">
                  {/* Inline `bdi` inside a block: isolates the name without letting
                      an Arabic name flip its own cell's alignment in an English UI. */}
                  <span className="block break-words font-medium"><bdi>{pickEmployeeName(punch, i18n.language)}</bdi></span>
                  <bdi dir="ltr" className="block font-mono text-muted-foreground">{punch.employee_id}</bdi>
                  <span className="block break-words text-muted-foreground @[32rem]/widget:hidden">{punch.duty_post ?? '—'} · {punch.device ?? '—'}</span>
                </span>
                <span className="hidden break-words text-muted-foreground @[32rem]/widget:block"><bdi>{punch.duty_post ?? '—'}</bdi></span>
                <span className="hidden break-words text-muted-foreground @[32rem]/widget:block"><bdi>{punch.device ?? '—'}</bdi></span>
                <span className="font-medium">{t(`dashboard.widgets.punch_log.direction.${punch.direction}`)}</span>
              </li>
            ))}
          </ul>
          <p className={`${WIDGET_SUPPORT} shrink-0 border-t border-hairline pt-2 text-muted-foreground`}>{t('dashboard.widgets.punch_log.footer')}</p>
        </>
      )}
    </WidgetFrame>
  )
}
