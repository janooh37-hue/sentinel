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
  graceFor,
  isUnpaired,
  minutesPastGrace,
  parseInstant,
  rowState,
  siteTime,
} from '@/pages/employees/attendance/attendanceModel'
import type { RowState } from '@/pages/employees/attendance/attendanceModel'

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

/**
 * What one month cell shows.
 *
 * The judged states come straight from the shared ladder, so a day in this file
 * is coloured by exactly the rule the register applies to the same case.
 * `seen` and `off` are calendar facts this view adds: a day the device saw with
 * no roster behind it, and a day nobody was rostered at all.
 */
type DayOutcome = RowState | 'seen' | 'off'

const SHIFT_LETTER: Record<string, string> = {
  morning: 'M',
  noon: 'N',
  night: 'L',
  office_day: 'O',
}

const CELL: Record<DayOutcome, string> = {
  verified: 'bg-success-soft border-success/25',
  grace: 'bg-caution-soft border-caution/40',
  late: 'bg-warning-soft border-warning/25',
  unpaired: 'bg-destructive/10 border-destructive/30',
  absent: 'bg-accent-soft border-accent/40',
  leave: 'bg-info-soft border-info/25',
  pending: 'border-dashed border-border-strong bg-transparent',
  seen: 'border-dashed border-info/40 bg-info-soft/40',
  off: 'border-dashed border-border-strong bg-transparent text-faint',
}

/** Worst first: one cell can hold two shifts, and trouble must win the colour. */
const CELL_ORDER: readonly DayOutcome[] = [
  'absent',
  'unpaired',
  'late',
  'grace',
  'verified',
  'pending',
  'leave',
]

/**
 * The device record is read from the start of the year, not from the roster's
 * install date: the point of the whole-record band is to show the months the
 * roster never covered, so they can be checked against the device itself.
 */
const RECORD_FROM = `${new Date().getUTCFullYear()}-01-01`

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

/**
 * Judge one day of this employee's month.
 *
 * `now` is the wall clock rather than the month being viewed: the boundaries the
 * server publishes decide whether a case is still running, and the current month
 * is the only one that can contain a duty in progress.
 */
function dayOutcome(day: EmployeeAttendanceDay, now: Date): DayOutcome {
  return rowState(day, { now })
}

/** The worst outcome among the shifts a single calendar day holds. */
function worstOutcome(days: readonly EmployeeAttendanceDay[], now: Date): DayOutcome | null {
  let worst: DayOutcome | null = null
  for (const day of days) {
    const outcome = dayOutcome(day, now)
    if (worst === null || CELL_ORDER.indexOf(outcome) < CELL_ORDER.indexOf(worst)) worst = outcome
  }
  return worst
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

  // The whole record, from the first day of the year the punches reach back to.
  // Judged days only exist where a roster did, so this is the band that can be
  // checked against the device's own dashboard: every month it saw this person.
  const record = useQuery({
    queryKey: ['employee-attendance-record', employeeId, RECORD_FROM, bounds.to] as const,
    queryFn: () =>
      api.getEmployeeAttendanceHistory(employeeId, { from_date: RECORD_FROM, to_date: bounds.to }),
    enabled: allowed,
    staleTime: 300_000,
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

  // One entry per month the device saw this person: the band that can be read
  // beside the provider's own dashboard without opening it.
  const recordMonths = useMemo(() => {
    const counts = new Map<string, number>()
    for (const day of record.data?.days ?? []) {
      const iso = day.operational_date.slice(0, 7)
      counts.set(iso, (counts.get(iso) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([iso, days]) => ({
        iso,
        days,
        label: new Date(`${iso}-01T00:00:00Z`).toLocaleDateString(i18n.language, {
          month: 'short',
          timeZone: 'UTC',
        }),
      }))
  }, [record.data, i18n.language])

  const habits = useMemo(() => query.data?.habits ?? [], [query.data])
  const rosterMismatch =
    habits.find((habit) => habit.suggested_shift_code)?.suggested_shift_code ?? null

  /** A signed offset as words, because a bare sign reads badly right-to-left. */
  const edgePhrase = (offset: number, edge: 'start' | 'end'): string => {
    const minutes = Math.abs(offset)
    if (edge === 'start') {
      return offset <= 0
        ? t('attendance.tab.beforeStart', { minutes })
        : t('attendance.tab.afterStart', { minutes })
    }
    return offset <= 0
      ? t('attendance.tab.beforeEnd', { minutes })
      : t('attendance.tab.afterEnd', { minutes })
  }

  const sightings = useMemo(() => {
    const map = new Map<string, EmployeeAttendanceHistoryDay>()
    for (const day of history.data?.days ?? []) map.set(day.operational_date, day)
    return map
  }, [history.data])

  // One clock for the whole render, taken from the instant the payload was
  // produced - the same rule the register's counts use. The tiles and the grid
  // then agree about whether a duty was still running when the server answered,
  // and the memo below has a dependency that only moves when the data does.
  // `dataUpdatedAt` is 0 before the first payload; with no days there is nothing
  // to judge, so the epoch value never decides anything.
  const judgedAt = useMemo(() => new Date(query.dataUpdatedAt), [query.dataUpdatedAt])

  // Every number here is judged by the shared ladder, so the tiles, the month
  // grid and the register can never disagree about one day. Leave and duties
  // still running leave the denominator: punctuality is a share of the shifts
  // this person has actually been judged on.
  const kpis = useMemo(() => {
    const now = judgedAt
    let judged = 0
    let onTime = 0
    let late = 0
    let absent = 0
    let unpaired = 0
    let lateMinutes = 0
    let worked = 0
    for (const day of days) {
      const outcome = dayOutcome(day, now)
      if (outcome === 'leave' || outcome === 'pending') continue
      judged += 1
      if (day.punch_count > 0) worked += 1
      if (isUnpaired(day, { now })) unpaired += 1
      if (outcome === 'absent') {
        absent += 1
        continue
      }
      // Minutes past the GRACE, not past the start: the grace exists so an
      // arrival inside it costs nothing.
      lateMinutes += minutesPastGrace(day)
      if (outcome === 'late') late += 1
      else onTime += 1
    }
    return {
      judged,
      onTime,
      late,
      absent,
      unpaired,
      lateMinutes,
      worked,
      punctuality: judged === 0 ? null : Math.round((onTime / judged) * 100),
    }
  }, [days, judgedAt])

  if (!allowed) {
    return (
      <p className="rounded-2xl border border-hairline bg-surface p-5 text-sm text-muted-foreground">
        {t('attendance.loadFailed')}
      </p>
    )
  }

  const selectedDays = selected ? (byDate.get(selected) ?? []) : []
  const lastDay = new Date(bounds.year, bounds.month, 0).getDate()

  // The audit line: the device saw punches this day's cases never claimed. Both
  // counts come from the same day, one from the provider and one from our own
  // attribution, so a gap is exactly the discrepancy worth investigating.
  const unattributed = (() => {
    if (selected === null || selectedDays.length === 0) return null
    const seen = sightings.get(selected)
    if (seen === undefined) return null
    const judged = selectedDays.reduce((total, day) => total + day.punch_count, 0)
    return seen.punch_count > judged ? { device: seen.punch_count, judged } : null
  })()
  const firstWeekday = new Date(bounds.year, bounds.month - 1, 1).getDay()
  // 4 Jan 1970 was a Sunday, so index 0 lines up with `getDay()` and with the
  // padding cells that push the 1st into its column.
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(1970, 0, 4 + index)).toLocaleDateString(i18n.language, {
      weekday: 'short',
      timeZone: 'UTC',
    }),
  )

  return (
    <div className="grid gap-3.5">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <Kpi
          id="punctuality"
          label={t('attendance.tab.punctuality')}
          value={kpis.punctuality === null ? '—' : `${kpis.punctuality}%`}
          detail={`${kpis.onTime}/${kpis.judged}`}
          tone="text-success"
        />
        <Kpi
          id="late-minutes"
          label={t('attendance.tab.lateMinutes')}
          value={String(kpis.lateMinutes)}
          detail={String(kpis.late)}
          tone="text-warning"
        />
        <Kpi
          id="absent"
          label={t('attendance.tab.absentDays')}
          value={String(kpis.absent)}
          tone="text-accent"
        />
        <Kpi
          id="missing-punches"
          label={t('attendance.tab.missingPunches')}
          value={String(kpis.unpaired)}
          tone="text-destructive"
        />
        <Kpi
          id="shifts-worked"
          label={t('attendance.tab.shiftsWorked')}
          value={String(kpis.worked)}
        />
      </div>

      {recordMonths.length > 0 && (
        <section className="rounded-2xl border border-hairline bg-surface px-4 py-3">
          <header className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-[0.85em] font-bold">{t('attendance.tab.wholeRecord')}</h3>
            <p className="text-[0.72em] text-muted-foreground">
              {t('attendance.tab.wholeRecordHint')}
            </p>
          </header>
          <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="attendance-record-band">
            {recordMonths.map((entry) => (
              <li key={entry.iso}>
                <button
                  type="button"
                  onClick={() => setMonth(`${entry.iso}-01`)}
                  aria-current={entry.iso === month.slice(0, 7) ? 'true' : undefined}
                  className={`rounded-lg border px-2 py-1 text-[0.72em] ${
                    entry.iso === month.slice(0, 7)
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-border text-muted-foreground hover:bg-surface-muted'
                  }`}
                >
                  <span className="font-bold">{entry.label}</span>
                  <span className="ms-1.5 font-mono">{entry.days}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {habits.length > 0 && (
        <section className="rounded-2xl border border-hairline bg-surface px-4 py-3">
          <h3 className="text-[0.85em] font-bold">{t('attendance.tab.habit')}</h3>
          <ul className="mt-1.5 grid gap-1" data-testid="attendance-habits">
            {habits.map((habit) => (
              <li key={habit.shift_code} className="text-[0.78em] text-muted-foreground">
                <span className="font-bold text-primary">
                  {t(`attendance.shift.${habit.shift_code}`, habit.shift_code)}
                </span>{' '}
                {edgePhrase(habit.arrival_typical_offset, 'start')}
                {' · '}
                {edgePhrase(habit.departure_typical_offset ?? 0, 'end')}
                {' · '}
                {t('attendance.tab.sampleDays', { count: habit.sample_days })}
              </li>
            ))}
          </ul>
          {rosterMismatch && (
            <p
              role="status"
              className="mt-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[0.75em] text-warning"
            >
              {t('attendance.tab.rosterMismatch', {
                shift: t(`attendance.shift.${rosterMismatch}`, rosterMismatch),
              })}
            </p>
          )}
        </section>
      )}

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
          <>
            {/* Weekday header. In RTL the grid itself flows right-to-left, so
              * these labels sit over the same columns the day cells land in
              * without a single directional override. */}
            <div
              className="grid grid-cols-7 gap-1.5 px-3 pt-3"
              data-testid="attendance-month-weekdays"
            >
              {weekdays.map((name) => (
                <div
                  key={name}
                  // `uppercase` does nothing to Arabic and letter-spacing breaks
                  // its cursive joining, so both are LTR-only.
                  className="truncate text-center text-[0.64em] font-bold text-faint ltr:uppercase ltr:tracking-[.08em]"
                >
                  {name}
                </div>
              ))}
            </div>

            <div
              className="grid grid-cols-7 gap-1.5 px-3 pb-3 pt-1.5"
              data-testid="attendance-month-grid"
            >
              {Array.from({ length: firstWeekday }, (_, index) => (
                <div key={`pad-${index}`} />
              ))}
              {Array.from({ length: lastDay }, (_, index) => {
                const dayNumber = index + 1
                const iso = `${bounds.from.slice(0, 8)}${String(dayNumber).padStart(2, '0')}`
                const entries = byDate.get(iso) ?? []
                const seen = sightings.get(iso)
                const judged = worstOutcome(entries, judgedAt)
                const outcome: DayOutcome = judged ?? (seen ? 'seen' : 'off')
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
                    <span className="font-mono text-[0.72em] text-muted-foreground">
                      {dayNumber}
                    </span>
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
          </>
        )}
      </section>

      {selectedDays.map((day) => (
        <DayTimeline key={`${day.operational_date}-${day.shift_code}`} day={day} />
      ))}

      {unattributed !== null && (
        <p
          role="status"
          data-testid="attendance-unattributed"
          className="rounded-2xl border border-info/25 bg-info-soft px-4 py-2.5 text-[0.78em] text-info"
        >
          {t('attendance.tab.deviceSawMore', {
            device: unattributed.device,
            judged: unattributed.judged,
          })}
        </p>
      )}

      {selectedDays.length === 0 && selected !== null && sightings.get(selected) ? (
        <SeenOnlyDay day={sightings.get(selected)!} />
      ) : null}
    </div>
  )
}

function Kpi({
  id,
  label,
  value,
  detail,
  tone,
}: {
  id: string
  label: string
  value: string
  detail?: string
  tone?: string
}): React.JSX.Element {
  return (
    <div
      data-testid={`attendance-kpi-${id}`}
      className="rounded-2xl border border-hairline bg-surface px-3.5 py-3"
    >
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
  const grace = graceFor(day)
  const graceEnd = start === null ? null : start + grace * 60_000
  // The instant this start would have become an absence. Drawn because it is the
  // other half of the site's rule: everything left of it is an arrival, however
  // late, and a start that reached it with no punch is an absence.
  const absenceAt = parseInstant(day.absence_due_at)
  const pastGrace = minutesPastGrace(day)
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
          {t('attendance.tab.grace', { minutes: grace })}
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
                  width: `${pct(graceEnd ?? start) - pct(start)}%`,
                  background:
                    'repeating-linear-gradient(45deg, var(--warning-soft) 0 4px, transparent 4px 8px)',
                }}
              />
              {absenceAt !== null && (
                <i
                  aria-hidden
                  data-testid="attendance-day-absence"
                  className="absolute top-[46px] h-6 w-[2px] bg-accent/70"
                  style={{ left: `${pct(absenceAt)}%` }}
                />
              )}
            </>
          )}
          {day.punches.map((punch) => {
            const at = parseInstant(punch.occurred_at)
            if (at === null) return null
            return (
              <span
                key={punch.occurred_at}
                data-testid="attendance-day-punch"
                // Centred with a transform, not a logical margin: a negative
                // `-ms-12` is absorbed by the solved-for `right` under RTL, so
                // the label drifted half its width away from its own tick while
                // the grace band and the absence line stayed put.
                className="absolute top-0 w-24 -translate-x-1/2 text-center"
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
        {pastGrace > 0 && (
          <span className="font-mono font-bold text-warning">
            {t('attendance.pastGrace', { minutes: pastGrace })}
          </span>
        )}
        {day.presence_state === 'absent' && (
          <span className="font-bold text-accent">{t('attendance.state.absent')}</span>
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
