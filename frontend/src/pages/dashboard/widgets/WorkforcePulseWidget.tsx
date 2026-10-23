import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { useDashboardRuntime } from './dashboardWidgetContext'
import { derivePulseState, type PulseState } from './workforcePulseState'
import type { WidgetProps } from './types'

function formatShiftTime(value: string | null | undefined, locale: string, timezone: string): string {
  if (!value) return '…'
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    numberingSystem: 'latn',
    timeZone: hasOffset ? timezone : 'UTC',
  }).format(new Date(hasOffset ? value : `${value}Z`))
}

const actionClass = 'self-start rounded-sm text-[0.72em] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function WorkforcePulseWidget({ tier }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { onOpenCoverage } = useDashboardRuntime()
  const { has, isLoading: capabilitiesLoading } = useCapabilities()
  const canView = has('workforce.self.view') || has('workforce.dashboard.view')
  const accessQuery = useQuery({
    queryKey: ['workforce', 'access'],
    queryFn: api.getWorkforceAccess,
    enabled: canView,
    staleTime: 60_000,
  })
  const canRequestSnapshot = canView && accessQuery.data != null && accessQuery.data.workforce_access_tier !== 'none'
  const snapshotQuery = useQuery({
    queryKey: ['workforce', 'snapshot'],
    queryFn: api.getWorkforceSnapshot,
    enabled: canRequestSnapshot,
    staleTime: 60_000,
  })
  const state: PulseState | null = !capabilitiesLoading && (!canView || accessQuery.data?.workforce_access_tier === 'none')
    ? { kind: 'no_scope' }
    : accessQuery.data && snapshotQuery.data
      ? derivePulseState(accessQuery.data, snapshotQuery.data)
      : null
  const loading = capabilitiesLoading || (!state && !accessQuery.isError && !snapshotQuery.isError)
  const unknown = t('dashboard.workforcePulse.self.presence.unknown')
  let message: { title: string; detail: string } | undefined
  if (state?.kind === 'no_scope') {
    message = { title: t('dashboard.workforcePulse.noScope.title'), detail: t('dashboard.workforcePulse.noScope.detail') }
  } else if (state?.kind === 'setup') {
    message = {
      title: t('dashboard.workforcePulse.setup.title', { missing: t(`dashboard.workforcePulse.setup.missing.${state.missing[0]}`) }),
      detail: t('dashboard.workforcePulse.setup.detail', { missing: state.missing.map((item) => t(`dashboard.workforcePulse.setup.missing.${item}`)).join(', ') }),
    }
  } else if (state?.kind === 'stale' || state?.kind === 'withheld') {
    message = { title: t(`dashboard.workforcePulse.${state.kind}.title`), detail: t(`dashboard.workforcePulse.${state.kind}.detail`) }
  }

  return (
    <WidgetFrame title={t('dashboard.widgets.workforce_pulse.title')}>
      {accessQuery.isError || snapshotQuery.isError ? (
        <div className="flex min-h-0 flex-col gap-2" role="alert">
          <p className="text-[0.75em] text-muted-foreground">{t('common.loadError')}</p>
          <button type="button" className={actionClass} onClick={() => void (accessQuery.isError ? accessQuery.refetch() : snapshotQuery.refetch())}>{t('common.retry')}</button>
        </div>
      ) : loading ? (
        <div className="space-y-2" aria-label={t('common.loading')}>
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ) : message ? (
        <div role="status" className="space-y-1">
          <p className="text-[0.8em] font-semibold text-foreground">{message.title}</p>
          <p className="text-[0.72em] text-muted-foreground">{message.detail}</p>
        </div>
      ) : state?.kind === 'aggregate' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5" role="status">
          {tier === 'glance' ? (
            <>
              <p className="text-3xl font-semibold tabular-nums text-foreground">{state.snapshot.current_shift.verified_coverage_percent == null ? unknown : `${state.snapshot.current_shift.verified_coverage_percent}%`}<span className="ms-2 text-xs font-normal text-muted-foreground">{t('dashboard.workforcePulse.metrics.coverage')}</span></p>
              <p className="text-[0.7em] text-muted-foreground">{state.snapshot.current_shift.working == null ? unknown : t('dashboard.widgets.workforce_pulse.onDutyOf', { working: state.snapshot.current_shift.working, scheduled: state.snapshot.current_shift.scheduled })}</p>
            </>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-2">
                {[
                  [t('dashboard.workforcePulse.metrics.scheduled'), state.snapshot.current_shift.scheduled],
                  [t('dashboard.workforcePulse.metrics.working'), state.snapshot.current_shift.working ?? unknown],
                  [t('dashboard.workforcePulse.metrics.coverage'), state.snapshot.current_shift.verified_coverage_percent == null ? unknown : `${state.snapshot.current_shift.verified_coverage_percent}%`],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dd className="text-xl font-semibold tabular-nums text-foreground">{value}</dd>
                    <dt className="text-[0.65em] text-muted-foreground">{label}</dt>
                  </div>
                ))}
              </dl>
              <p className="text-[0.65em] text-muted-foreground">{t('dashboard.widgets.workforce_pulse.updated', { time: formatShiftTime(state.snapshot.as_of, i18n.language, state.snapshot.timezone) })}</p>
            </>
          )}
          <button type="button" className={`${actionClass} mt-auto`} onClick={onOpenCoverage}>{t('dashboard.workforcePulse.openCoverage')}</button>
        </div>
      ) : state?.kind === 'self' ? (
        <div className="flex min-h-0 flex-col gap-1" role="status">
          <p className="sr-only">{t('dashboard.workforcePulse.self.heading')}</p>
          <p className="text-[0.9em] font-semibold text-foreground">{t(`dashboard.workforcePulse.self.presence.${state.snapshot.self?.presence_state ?? 'unknown'}`)}</p>
          <p className="text-[0.72em] text-muted-foreground">{t([
            `dashboard.widgets.workforce_pulse.reasons.${state.snapshot.self?.reason_code?.toLowerCase()}`,
            `attendance.review.reasons.${state.snapshot.self?.reason_code?.toLowerCase()}`,
            'dashboard.widgets.workforce_pulse.reasonUnknown',
          ])}</p>
          {tier !== 'glance' && (
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[0.7em]">
              <div><dt className="text-muted-foreground">{t('dashboard.workforcePulse.self.start')}</dt><dd>{formatShiftTime(state.snapshot.self?.scheduled_start_at, i18n.language, state.snapshot.timezone)}</dd></div>
              <div><dt className="text-muted-foreground">{t('dashboard.workforcePulse.self.end')}</dt><dd>{formatShiftTime(state.snapshot.self?.scheduled_end_at, i18n.language, state.snapshot.timezone)}</dd></div>
            </dl>
          )}
        </div>
      ) : (
        <p className="text-[0.75em] text-muted-foreground">{unknown}</p>
      )}
    </WidgetFrame>
  )
}
