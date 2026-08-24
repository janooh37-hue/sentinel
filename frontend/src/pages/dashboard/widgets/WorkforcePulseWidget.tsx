import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, CircleAlert, Clock3, ShieldAlert, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type WorkforceAccess, type WorkforceSnapshot } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'

export type MissingReadiness = 'schedules' | 'policy' | 'mappings' | 'integration'

export type PulseState =
  | { kind: 'self'; snapshot: WorkforceSnapshot }
  | { kind: 'aggregate'; snapshot: WorkforceSnapshot }
  | { kind: 'no_scope' }
  | { kind: 'setup'; missing: MissingReadiness[] }
  | { kind: 'stale' }
  | { kind: 'withheld'; snapshot: WorkforceSnapshot }

export interface WorkforcePulseWidgetProps {
  onOpenCoverage: () => void
}

export function derivePulseState(access: WorkforceAccess, snapshot: WorkforceSnapshot): PulseState {
  if (access.workforce_access_tier === 'none') return { kind: 'no_scope' }

  const missing: MissingReadiness[] = []
  if (snapshot.readiness) {
    if (!snapshot.readiness.schedules_ready) missing.push('schedules')
    if (!snapshot.readiness.policy_ready) missing.push('policy')
    if (!snapshot.readiness.mappings_ready) missing.push('mappings')
    if (!snapshot.readiness.integration_ready) missing.push('integration')
  }
  if (missing.length > 0) return { kind: 'setup', missing }
  if (snapshot.sync_health?.punches?.state === 'stale') return { kind: 'stale' }
  if (snapshot.current_shift.working == null && snapshot.current_shift.scheduled > 0) {
    return { kind: 'withheld', snapshot }
  }
  return snapshot.aggregate ? { kind: 'aggregate', snapshot } : { kind: 'self', snapshot }
}

function Metric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="rounded-lg bg-surface-tinted px-3 py-2">
      <dt className="font-mono text-[0.68em] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

function StateMessage({ icon: Icon, title, detail }: { icon: typeof AlertTriangle; title: string; detail: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 px-5 py-5" role="status" aria-live="polite">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-warning" strokeWidth={1.8} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

export function WorkforcePulseWidget({ onOpenCoverage }: WorkforcePulseWidgetProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { has, isLoading: capabilitiesLoading } = useCapabilities()
  const canViewSelf = has('workforce.self.view')
  const canViewAggregate = has('workforce.dashboard.view')
  const canView = canViewSelf || canViewAggregate

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

  if (capabilitiesLoading || !canView) return null

  const state: PulseState | null =
    accessQuery.data?.workforce_access_tier === 'none'
      ? { kind: 'no_scope' }
      : accessQuery.data && snapshotQuery.data
        ? derivePulseState(accessQuery.data, snapshotQuery.data)
        : null

  return (
    <section className="mb-6 rounded-2xl border border-hairline bg-surface" aria-label={t('dashboard.workforcePulse.title')}>
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" strokeWidth={1.8} aria-hidden />
          <h3 className="text-[0.86em] font-semibold text-foreground">{t('dashboard.workforcePulse.title')}</h3>
        </div>
        {state?.kind === 'aggregate' ? (
          <Button type="button" variant="ghost" size="sm" onClick={onOpenCoverage}>
            {t('dashboard.workforcePulse.openCoverage')}
          </Button>
        ) : null}
      </div>

      {!state && (accessQuery.isPending || snapshotQuery.isPending) ? (
        <div className="space-y-3 px-5 py-5" aria-label={t('common.loading')}>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : accessQuery.isError || snapshotQuery.isError ? (
        <EmptyState icon={CircleAlert} message={t('common.loadError')} className="py-8" />
      ) : state?.kind === 'no_scope' ? (
        <StateMessage icon={ShieldAlert} title={t('dashboard.workforcePulse.noScope.title')} detail={t('dashboard.workforcePulse.noScope.detail')} />
      ) : state?.kind === 'setup' ? (
        <StateMessage
          icon={CalendarClock}
          title={t('dashboard.workforcePulse.setup.title', { missing: t(`dashboard.workforcePulse.setup.missing.${state.missing[0]}`) })}
          detail={t('dashboard.workforcePulse.setup.detail', { missing: state.missing.map((item) => t(`dashboard.workforcePulse.setup.missing.${item}`)).join(', ') })}
        />
      ) : state?.kind === 'stale' ? (
        <StateMessage icon={AlertTriangle} title={t('dashboard.workforcePulse.stale.title')} detail={t('dashboard.workforcePulse.stale.detail')} />
      ) : state?.kind === 'withheld' ? (
        <StateMessage icon={Clock3} title={t('dashboard.workforcePulse.withheld.title')} detail={t('dashboard.workforcePulse.withheld.detail')} />
      ) : state?.kind === 'aggregate' ? (
        <PulseMetrics
          heading={t('dashboard.workforcePulse.aggregate.heading')}
          snapshot={state.snapshot}
          scheduledLabel={t('dashboard.workforcePulse.metrics.scheduled')}
          workingLabel={t('dashboard.workforcePulse.metrics.working')}
          coverageLabel={t('dashboard.workforcePulse.metrics.coverage')}
        />
      ) : state?.kind === 'self' ? (
        <PulseMetrics
          heading={t('dashboard.workforcePulse.self.heading')}
          snapshot={state.snapshot}
          scheduledLabel={t('dashboard.workforcePulse.metrics.scheduled')}
          workingLabel={t('dashboard.workforcePulse.metrics.working')}
          coverageLabel={t('dashboard.workforcePulse.metrics.coverage')}
        />
      ) : null}
    </section>
  )
}

function PulseMetrics({
  heading,
  snapshot,
  scheduledLabel,
  workingLabel,
  coverageLabel,
}: {
  heading: string
  snapshot: WorkforceSnapshot
  scheduledLabel: string
  workingLabel: string
  coverageLabel: string
}): React.JSX.Element {
  const coverage = snapshot.current_shift.verified_coverage_percent
  return (
    <div className="px-5 py-5" role="status" aria-live="polite">
      <p className="mb-3 text-sm font-semibold text-foreground">{heading}</p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label={scheduledLabel} value={snapshot.current_shift.scheduled} />
        <Metric label={workingLabel} value={snapshot.current_shift.working ?? 0} />
        {coverage != null ? <Metric label={coverageLabel} value={coverage} /> : null}
      </dl>
    </div>
  )
}
