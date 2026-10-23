import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, CalendarClock, ChevronRight, type LucideIcon } from 'lucide-react'
import { api, type DashboardSummary, type DashboardOnLeaveItem, type DashboardUpcomingItem } from '@/lib/api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { WidgetCard, type BreakdownRow } from '@/components/ui/widget-card'
import { ExpiringSoonWidget } from './ExpiringSoonWidget'
import { PendingDeparturesWidget } from './PendingDeparturesWidget'
import { ViolationMonthsWidget } from './ViolationMonthsWidget'
import { PermitsWidget } from './PermitsWidget'
import { WorkforcePulseWidget } from './WorkforcePulseWidget'
import type { WidgetId } from '@/lib/dashboardLayout'
import type { WidgetProps } from './types'
import { useDashboardRuntime } from './dashboardWidgetContext'


/** Temporary single adapter for the existing widget bodies; remove entries as content migrates. */
export function LegacyWidget({ id }: WidgetProps & { id: Exclude<WidgetId, 'quick_actions'> }): React.JSX.Element {
    const { onNavigate, onOpenCoverage } = useDashboardRuntime()
    const { t, i18n } = useTranslation()
    const isAr = i18n.language.startsWith('ar')
    const navigate = useNavigate()
    const openItem = (target: string, itemId: number | string) => navigate(`/${target}?open=${itemId}`)
    const summaryQuery = useQuery({ queryKey: ['dashboard'], queryFn: api.getDashboardSummary, staleTime: 60_000 })
    const summary: DashboardSummary | undefined = summaryQuery.data
    const body = () => {
    switch (id) {
      case 'workspace':
        return (
          <WorkspaceCard
            staff={summary?.totals.employees_active ?? 0}
            header={t('dashboard.workspace.title')}
            currency={t('dashboard.workspace.total')}
            ourStaff={summary?.totals.our_staff ?? 0}
            onSite={summary?.totals.present_today ?? 0}
            loaned={summary?.totals.loaned ?? 0}
            onLeave={summary?.totals.on_leave_today ?? 0}
            onClick={() => onNavigate('employees')}
            isLoading={summaryQuery.isPending}
          />
        )
      case 'violations': {
        const openViolations = summary?.totals.open_violations_count ?? 0
        return (
          <WidgetCard
            header={t('dashboard.widgets.violations.header')}
            big={openViolations}
            delta={
              openViolations > 0
                ? { tone: 'warn', label: t('dashboard.widgets.violations.deltaWarn', { count: openViolations }) }
                : { tone: 'steady', label: t('dashboard.widgets.violations.deltaSteady') }
            }
            breakdown={[
              { color: 'accent', label: t('dashboard.widgets.violations.active'), value: openViolations },
              { color: 'warning', label: t('dashboard.widgets.violations.escalated'), value: 0 },
              { color: 'success', label: t('dashboard.widgets.violations.pendingClose'), value: 0 },
            ] satisfies BreakdownRow[]}
            actionLabel={t('dashboard.widgets.violations.action')}
            onAction={() => onNavigate('employees')}
          />
        )
      }
      case 'expiring_soon':
        return <ExpiringSoonWidget />
      case 'pending_departures':
        return <PendingDeparturesWidget />
      case 'violation_months':
        return <ViolationMonthsWidget />
      case 'permits':
        return <PermitsWidget />
      case 'workforce_pulse':
        return <WorkforcePulseWidget onOpenCoverage={onOpenCoverage} />
      case 'on_leave_today':
        return (
          <SectionCard icon={CalendarCheck} title={t('dashboard.onLeave.title')} count={summary?.on_leave_today.length}>
            {summaryQuery.isPending ? (
              <PanelSkeleton />
            ) : !summary || summary.on_leave_today.length === 0 ? (
              <EmptyState icon={CalendarCheck} message={t('dashboard.onLeave.empty')} />
            ) : (
              <ul className="flex flex-col">
                {summary.on_leave_today.map((item) => (
                  <OnLeaveRow
                    key={item.leave_id}
                    item={item}
                    isAr={isAr}
                    untilLabel={t('dashboard.onLeave.until', { date: item.end_date })}
                    onOpen={() => openItem('leaves', item.leave_id)}
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        )
      case 'upcoming_leave':
        return (
          <SectionCard icon={CalendarClock} title={t('dashboard.upcoming.title')} count={summary?.upcoming_leave_ends.length}>
            {summaryQuery.isPending ? (
              <PanelSkeleton />
            ) : !summary || summary.upcoming_leave_ends.length === 0 ? (
              <EmptyState icon={CalendarClock} message={t('dashboard.upcoming.empty')} />
            ) : (
              <ul className="flex flex-col">
                {summary.upcoming_leave_ends.map((item) => (
                  <UpcomingRow
                    key={item.leave_id}
                    item={item}
                    isAr={isAr}
                    label={
                      item.days_remaining <= 0
                        ? t('dashboard.upcoming.endsToday')
                        : item.days_remaining === 1
                          ? t('dashboard.upcoming.endsTomorrow')
                          : t('dashboard.upcoming.endsIn', { days: item.days_remaining })
                    }
                    onOpen={() => openItem('leaves', item.leave_id)}
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        )
    }
    }
    return <div className="h-full min-h-0 overflow-hidden [&>*]:!mb-0">{body()}</div>
}

interface NameLike {
  employee_name_en: string
  employee_name_ar: string | null
}

function pickName(item: NameLike, isAr: boolean): string {
  if (isAr && item.employee_name_ar) return item.employee_name_ar
  return item.employee_name_en
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}



interface WorkspaceCardProps {
  staff: number
  header: string
  currency: string
  ourStaff: number
  onSite: number
  loaned: number
  onLeave: number
  onClick: () => void
  isLoading: boolean
}

function WorkspaceCard({
  staff,
  header,
  currency,
  ourStaff,
  onSite,
  loaned,
  onLeave,
  onClick,
  isLoading,
}: WorkspaceCardProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer group relative h-full w-full overflow-hidden rounded-2xl p-5 text-start transition-all duration-200 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      style={{
        background:
          'linear-gradient(140deg, var(--surface) 0%, var(--surface) 55%, var(--surface-tinted) 100%)',
      }}
    >
      <div className="text-[0.86em] font-medium text-muted-foreground">{header}</div>

      <div className="mt-2.5 text-[2.4em] font-bold leading-none tracking-tight text-foreground tabular-nums">
        <span className="me-1.5 text-[0.32em] font-medium text-muted-foreground align-middle">
          {currency}
        </span>
        {isLoading ? <Skeleton className="h-9 w-16" /> : staff}
      </div>

      <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.78em] text-muted-foreground">
        <WorkspaceChip dotClass="bg-primary" count={ourStaff} label={t('dashboard.workspace.ourStaff')} />
        {/* Static status dot. It remounts (via key) only when the on-site
            count changes, replaying a one-shot settle — no ambient pulse
            (Emil: reserve motion for the moment the value changes). */}
        <WorkspaceChip
          key={onSite}
          dotClass="dash-active-dot bg-success"
          count={onSite}
          label={t('dashboard.workspace.onSite')}
        />
        <WorkspaceChip dotClass="bg-info" count={loaned} label={t('dashboard.workspace.loaned')} />
        <WorkspaceChip dotClass="bg-warning" count={onLeave} label={t('dashboard.workspace.onLeave')} />
      </div>

      <ChevronRight
        aria-hidden
        className="absolute end-5 top-5 h-3.5 w-3.5 text-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted-foreground rtl:group-hover:-translate-x-0.5 motion-reduce:!transform-none"
        strokeWidth={1.8}
      />
      <style>{`
        /* One-shot settle: plays once when the dot mounts (i.e. when the
           on-site count changes and React remounts it via key). No infinite
           loop — the dot is otherwise static. */
        @keyframes dash-active-settle {
          0%   { transform: scale(0.4); opacity: 0; }
          45%  { transform: scale(1.15); opacity: 1; }
          70%  { transform: scale(1); }
          100% { transform: scale(1); opacity: 1; }
        }
        .dash-active-dot {
          animation: dash-active-settle 420ms cubic-bezier(0.34, 1.35, 0.64, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .dash-active-dot { animation: none !important; }
        }
      `}</style>
    </button>
  )
}

function WorkspaceChip({
  dotClass,
  count,
  label,
}: {
  dotClass: string
  count: number
  label: string
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
      <span className="font-semibold tabular-nums text-foreground">{count}</span>
      {label}
    </span>
  )
}

/* =========================================================================
 * SECTION CARD + ROWS (preserved from P12, restyled to rounded-2xl)
 * ========================================================================= */

function SectionCard({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: LucideIcon
  title: string
  count: number | undefined
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="h-full rounded-2xl border border-hairline bg-surface" aria-label={title}>
      <div className="flex min-h-[52px] items-center justify-between border-b border-hairline px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} aria-hidden />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {typeof count === 'number' && count > 0 && (
          <Badge shape="pill" tone="neutral">
            {count}
          </Badge>
        )}
      </div>
      <div className="px-3 py-2">{children}</div>
    </section>
  )
}

function PanelSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 p-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

function OnLeaveRow({
  item,
  isAr,
  untilLabel,
  onOpen,
}: {
  item: DashboardOnLeaveItem
  isAr: boolean
  untilLabel: string
  onOpen: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const name = pickName(item, isAr)
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-start text-sm transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 cursor-pointer"
      >
        <Avatar className="h-8 w-8 bg-primary-soft text-primary">
          <AvatarFallback>{initialsFor(name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-2 font-medium text-foreground" title={name}>{name}</span>
          <span className="font-mono text-xs text-muted-foreground">{item.employee_id}</span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge shape="square" tone="info" className="normal-case tracking-normal">
            {t(`leaves.type.${item.leave_type}`, { defaultValue: item.leave_type })}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">{untilLabel}</span>
        </div>
      </button>
    </li>
  )
}

function UpcomingRow({
  item,
  isAr,
  label,
  onOpen,
}: {
  item: DashboardUpcomingItem
  isAr: boolean
  label: string
  onOpen: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const name = pickName(item, isAr)
  const urgent = item.days_remaining <= 1
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-start text-sm transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 cursor-pointer"
      >
        <Avatar className="h-8 w-8 bg-primary-soft text-primary">
          <AvatarFallback>{initialsFor(name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-2 font-medium text-foreground" title={name}>{name}</span>
          <span className="font-mono text-xs text-muted-foreground">{item.employee_id}</span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge shape="square" tone={urgent ? 'warning' : 'neutral'} className="normal-case tracking-normal">
            {t(`leaves.type.${item.leave_type}`, { defaultValue: item.leave_type })}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">{label}</span>
        </div>
      </button>
    </li>
  )
}

