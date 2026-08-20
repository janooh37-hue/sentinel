/**
 * AttendanceTab — one employee's attendance, inside their file.
 *
 * `/employees/:id?tab=attendance`. Three bands: punctuality KPIs, a month grid
 * coloured by outcome with the shift letters actually worked, and the selected
 * day's punch timeline showing the scheduled window, the grace band and every
 * event.
 *
 * Two sources, deliberately distinct. Judged days come from this database and
 * only exist where a roster does. Sightings come from the device record, read
 * live for the displayed month and never stored: they are what lets the months
 * before the schedule existed show when the person was actually at the gate,
 * without pretending anything can be called late or absent there.
 *
 * The register links here, so this is the drill-in for a name.
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/lib/api'
import type { EmployeeAttendanceDay, EmployeeAttendanceHistoryDay } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import {
  DEFAULT_GRACE_MINUTES,
  parseInstant,
  siteTime,
} from '@/pages/employees/attendance/attendanceModel'

interface Props {
  employeeId: string
  /** True when this file belongs to the signed-in user. */
  isSelf?: boolean
  /**
   * Which month to open on, as any ISO date inside it. Defaults to the current
   * month. Injectable so tests (and future deep links) do not depend on the
   * wall clock.
   */
  initialMonth?: string
}

type DayOutcome = 'verified' | 'late' | 'exception' | 'leave' | 'seen' | 'off'

const SHIFT_LETTER: Record<string, string> = {
  morning: 'M',
  noon: 'N',
  night: 'L',
  office_day: 'O',
}

const CELL: Record<DayOutcome, string> = {
  verified: 'bg-success-soft border-success/25',
  late: 'bg-warning-soft border-warning/25',
  exception: 'bg-accent-soft border-accent/25',
  leave: 'bg-info-soft border-info/25',
  seen: 'border-dashed border-info/40 bg-info-soft/40',
  off: 'border-dashed border-border-strong bg-transparent text-faint',
}

/** First and last day of the month containing `iso`, as ISO dates. */
function monthBounds(iso: string): { from: string; to: string; year: number; month: number } {
  const [year, month] = iso.split('-').map(Number)
  const last = new Date(year, month, 0).getDate()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(last)}`,
    year,
    month,
  }
}

function dayOutcome(day: EmployeeAttendanceDay, graceMinutes: number): DayOutcome {
  if (day.presence_state === 'excused_leave') return 'leave'
  if (day.punch_count === 0) return 'exception'
  if (day.punch_count === 1) return 'exception'
  if ((day.late_minutes ?? 0) > graceMinutes) return 'late'
  return 'verified'
}

export function AttendanceTab({
  employeeId,
  isSelf = false,
  initialMonth,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const [month, setMonth] = useState(() => initialMonth ?? new Date().toISOString().slice(0, 10))
  const [selected, setSelected] = useState<string | null>(null)

  const bounds = useMemo(() => monthBounds(month), [month])
  const allowed =
    (isSelf && has('workforce.self.view')) ||
    (has('workforce.people.view') && has('workforce.attendance.review'))

  const query = useQuery({
    queryKey: ['employee-attendance', employeeId, bounds.from, bounds.to] as const,
    queryFn: () => api.getEmployeeAttendance(employeeId, { from_date: bounds.from, to_date: bounds.to }),
    enabled: allowed,
    staleTime: 60_000,
  })

  // The device record for the same month, read live. A provider outage must not
  // blank the judged month, so this query fails quietly on its own.
  const history = useQuery({
    queryKey: ['employee-attendance-history', employeeId, bounds.from, bounds.to] as const,
    queryFn: () =>
      api.getEmployeeAttendanceHistory(employeeId, {
        from_date: bounds.from,
        to_date: bounds.to,
      }),
    enabled: allowed,
    staleTime: 60_000,
    retry: false,
  })

  // Memoized so the two derivations below do not recompute on every render.
  const days = useMemo(() => query.data?.days ?? [], [query.data])
  const byDate = useMemo(() => {
    const map = new Map<string, EmployeeAttendanceDay[]>()
    for (const day of days) {
      map.set(day.operational_date, [...(map.get(day.operational_date) ?? []), day])
    }
    return map
  }, [days])

  const sightings = useMemo(() => {
    const map = new Map<string, EmployeeAttendanceHistoryDay>()
    for (const day of history.data?.days ?? []) map.set(day.operational_date, day)
    return map
  }, [history.data])

  const kpis = useMemo(() => {
    let onTime = 0
    let lateMinutes = 0
    let missing = 0
    for (const day of days) {
      const outcome = dayOutcome(day, DEFAULT_GRACE_MINUTES)
      if (outcome === 'verified') onTime += 1
      if (outcome === 'exception') missing += 1
      lateMinutes += day.late_minutes ?? 0
    }
    const scheduled = days.filter((day) => day.presence_state !== 'excused_leave').length
    return {
      scheduled,
      onTime,
      missing,
      lateMinutes,
      punctuality: scheduled === 0 ? null : Math.round((onTime / scheduled) * 100),
    }
  }, [days])

  if (!allowed) {
    return (
      <p className="rounded-2xl border border-hairline bg-surface p-5 text-sm text-muted-foreground">
        {t('attendance.loadFailed')}
      </p>
    )
  }

  const selectedDays = selected ? (byDate.get(selected) ?? []) : []
  const lastDay = new Date(bounds.year, bounds.month, 0).getDate()
  const firstWeekday = new Date(bounds.year, bounds.month - 1, 1).getDay()

  return (
    <div className="grid gap-3.5">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi
          label={t('attendance.tab.punctuality')}
          value={kpis.punctuality === null ? '—' : `${kpis.punctuality}%`}
          detail={`${kpis.onTime}/${kpis.scheduled}`}
          tone="text-success"
        />
        <Kpi label={t('attendance.tab.lateMinutes')} value={String(kpis.lateMinutes)} tone="text-warning" />
        <Kpi label={t('attendance.tab.missingPunches')} value={String(kpis.missing)} tone="text-accent" />
        <Kpi label={t('attendance.tab.shiftsWorked')} value={String(kpis.scheduled)} />
      </div>

      <section className="rounded-2xl border border-hairline bg-surface">
        <header className="flex flex-wrap items-center gap-2.5 border-b border-hairline px-4 py-3">
          <h3 className="text-[0.85em] font-bold">
            {new Date(bounds.year, bounds.month - 1, 1).toLocaleDateString(i18n.language, {
              month: 'long',
              year: 'numeric',
            })}
          </h3>
          <div className="ms-auto flex gap-1.5">
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, -1))}
              className="rounded-lg border border-border px-2 py-1 text-[0.78em] text-primary hover:bg-primary-soft"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, 1))}
              className="rounded-lg border border-border px-2 py-1 text-[0.78em] text-primary hover:bg-primary-soft"
            >
              ›
            </button>
          </div>
        </header>

        {query.isPending ? (
          <p role="status" className="px-4 py-6 text-center text-[0.82em] text-muted-foreground">
            {t('common.loading', 'Loading…')}
          </p>
        ) : days.length === 0 && sightings.size === 0 ? (
          <p className="px-4 py-6 text-center text-[0.82em] text-muted-foreground">
            {history.data?.linked === false
              ? t('attendance.tab.unenrolled')
              : t('attendance.tab.noSchedule')}
          </p>
        ) : (
          <div className="grid grid-cols-7 gap-1.5 p-3" data-testid="attendance-month-grid">
            {Array.from({ length: firstWeekday }, (_, index) => (
              <div key={`pad-${index}`} />
            ))}
            {Array.from({ length: lastDay }, (_, index) => {
              const dayNumber = index + 1
              const iso = `${bounds.from.slice(0, 8)}${String(dayNumber).padStart(2, '0')}`
              const entries = byDate.get(iso) ?? []
              const seen = sightings.get(iso)
              const outcome: DayOutcome =
                entries.length === 0
                  ? seen
                    ? 'seen'
                    : 'off'
                  : entries.some((day) => dayOutcome(day, DEFAULT_GRACE_MINUTES) === 'exception')
                    ? 'exception'
                    : entries.some((day) => dayOutcome(day, DEFAULT_GRACE_MINUTES) === 'late')
                      ? 'late'
                      : entries.every((day) => dayOutcome(day, DEFAULT_GRACE_MINUTES) === 'leave')
                        ? 'leave'
                        : 'verified'
              return (
                <button
                  key={iso}
                  type="button"
                  data-testid="attendance-month-cell"
                  data-outcome={outcome}
                  aria-pressed={selected === iso}
                  disabled={entries.length === 0 && seen === undefined}
                  onClick={() => setSelected(iso)}
                  className={`min-h-[58px] rounded-xl border p-1.5 text-start ${CELL[outcome]} ${
                    selected === iso ? 'outline outline-2 outline-primary' : ''
                  }`}
                >
                  <span className="font-mono text-[0.72em] text-muted-foreground">{dayNumber}</span>
                  <span className="mt-1 block text-[0.68em] font-bold">
                    {entries.length > 0
                      ? entries.map((day) => SHIFT_LETTER[day.shift_code ?? ''] ?? '?').join(' ')
                      : seen
                        ? t('attendance.tab.seenCount', { count: seen.punch_count })
                        : t('attendance.tab.restDay')}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {selectedDays.map((day) => (
        <DayTimeline key={`${day.operational_date}-${day.shift_code}`} day={day} />
      ))}

      {selectedDays.length === 0 && selected !== null && sightings.get(selected) ? (
        <SeenOnlyDay day={sightings.get(selected)!} />
      ) : null}
    </div>
  )
}

function Kpi({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail?: string
  tone?: string
}): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-hairline bg-surface px-3.5 py-3">
      <div className="text-[0.66em] font-bold uppercase tracking-[.1em] text-faint">{label}</div>
      <div className={`mt-1 font-mono text-[1.6em] font-extrabold tabular-nums ${tone ?? ''}`}>
        {value}
      </div>
      {detail && <div className="mt-0.5 text-[0.7em] text-faint">{detail}</div>}
    </div>
  )
}

/**
 * A day the device recorded but no roster covers.
 *
 * Sightings only: with no scheduled window there is nothing to be late for, and
 * this provider reports no direction, so the first and last events are stated as
 * what they are rather than dressed up as a check-in and a check-out.
 */
function SeenOnlyDay({ day }: { day: EmployeeAttendanceHistoryDay }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <section
      className="rounded-2xl border border-hairline bg-surface"
      data-testid="attendance-seen-only-day"
    >
      <header className="flex flex-wrap items-center gap-2.5 border-b border-hairline px-4 py-3">
        <h3 className="text-[0.85em] font-bold">{day.operational_date}</h3>
        <span className="rounded-full bg-info-soft px-2 py-0.5 text-[0.7em] font-bold text-info">
          {t('attendance.tab.seenOnly')}
        </span>
        <span className="ms-auto text-[0.72em] text-faint">{t('attendance.tab.fromDevice')}</span>
      </header>
      <dl className="grid grid-cols-2 gap-3 px-4 py-3 text-[0.8em] md:grid-cols-4">
        <div>
          <dt className="text-[0.85em] text-muted-foreground">{t('attendance.tab.firstSeen')}</dt>
          <dd className="font-mono font-bold">{siteTime(day.first_seen_at)}</dd>
        </div>
        <div>
          <dt className="text-[0.85em] text-muted-foreground">{t('attendance.tab.lastSeen')}</dt>
          <dd className="font-mono font-bold">{siteTime(day.last_seen_at)}</dd>
        </div>
        <div>
          <dt className="text-[0.85em] text-muted-foreground">{t('attendance.tab.punchCount')}</dt>
          <dd className="font-mono font-bold">{day.punch_count}</dd>
        </div>
        <div>
          <dt className="text-[0.85em] text-muted-foreground">{t('attendance.tab.devices')}</dt>
          <dd className="font-bold">{day.devices.join(' · ') || '—'}</dd>
        </div>
      </dl>
    </section>
  )
}

/** The selected day's punch timeline: window, grace band, one marker per punch. */
function DayTimeline({ day }: { day: EmployeeAttendanceDay }): React.JSX.Element {
  const { t } = useTranslation()
  const start = parseInstant(day.scheduled_start_at)
  const end = parseInstant(day.scheduled_end_at)
  // Axis: 45 minutes before the start to 45 after the end, so an early arrival
  // and a late exit both land on it.
  const axisFrom = (start ?? 0) - 45 * 60_000
  const axisTo = (end ?? 0) + 45 * 60_000
  const span = Math.max(1, axisTo - axisFrom)
  const pct = (instant: number): number => ((instant - axisFrom) / span) * 100

  return (
    <section className="rounded-2xl border border-hairline bg-surface" data-testid="attendance-day-timeline">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-hairline px-4 py-3">
        <h3 className="text-[0.85em] font-bold">
          {day.operational_date} · {t(`attendance.shift.${day.shift_code}`, day.shift_code ?? '')}
        </h3>
        <span className="font-mono text-[0.75em] text-muted-foreground">
          {siteTime(day.scheduled_start_at)} – {siteTime(day.scheduled_end_at)}
        </span>
        <span className="ms-auto text-[0.72em] text-muted-foreground">
          {t('attendance.tab.grace', { minutes: DEFAULT_GRACE_MINUTES })}
        </span>
      </header>

      <div className="px-12 pb-2 pt-4">
        <div className="relative h-[86px]">
          <i aria-hidden className="absolute inset-x-0 top-[52px] h-3 rounded-full bg-surface-tinted" />
          {start !== null && end !== null && (
            <>
              <i
                aria-hidden
                className="absolute top-[52px] h-3 rounded-full bg-primary-soft"
                style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }}
              />
              <i
                aria-hidden
                data-testid="attendance-day-grace"
                className="absolute top-[52px] h-3"
                style={{
                  left: `${pct(start)}%`,
                  width: `${pct(start + DEFAULT_GRACE_MINUTES * 60_000) - pct(start)}%`,
                  background:
                    'repeating-linear-gradient(45deg, var(--warning-soft) 0 4px, transparent 4px 8px)',
                }}
              />
            </>
          )}
          {day.punches.map((punch) => {
            const at = parseInstant(punch.occurred_at)
            if (at === null) return null
            return (
              <span
                key={punch.occurred_at}
                data-testid="attendance-day-punch"
                className="absolute top-0 -ms-12 w-24 text-center"
                style={{ left: `${Math.min(100, Math.max(0, pct(at)))}%` }}
              >
                <b className="block font-mono text-[0.7em] font-bold">{siteTime(punch.occurred_at)}</b>
                <span className="block text-[0.62em] text-faint">{punch.device_name ?? '—'}</span>
                <i aria-hidden className="mx-auto mt-0.5 block h-5 w-px bg-primary" />
              </span>
            )
          })}
        </div>
      </div>

      <p className="flex flex-wrap gap-2.5 border-t border-hairline px-4 py-2.5 text-[0.72em] text-muted-foreground">
        <span>{t('attendance.tab.punchesUnknownDirection', { count: day.punch_count })}</span>
        {day.late_minutes != null && day.late_minutes > 0 && (
          <span className="font-mono font-bold text-warning">+{day.late_minutes}m</span>
        )}
      </p>
    </section>
  )
}

/** Step the month of an ISO date, clamping the day to 1. */
function shiftMonth(iso: string, months: number): string {
  const [year, month] = iso.split('-').map(Number)
  const at = new Date(year, (month ?? 1) - 1 + months, 1)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-01`
}
