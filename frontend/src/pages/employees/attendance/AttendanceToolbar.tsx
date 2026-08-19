/**
 * AttendanceToolbar — one day, one shift, three views.
 *
 * Every control here exists to make the next action informed rather than
 * exploratory: the day stepper carries a seven-day strip whose red slice is the
 * exception count for that day, and each shift button carries its own
 * `seen/due`, so switching is a decision, not a probe.
 */

import { useTranslation } from 'react-i18next'

import type { AttendanceRow, ShiftCount } from './attendanceModel'
import { shiftCounts } from './attendanceModel'

export type AttendanceView = 'register' | 'board' | 'timeline'

const VIEWS: readonly AttendanceView[] = ['register', 'board', 'timeline']

export interface DayStripEntry {
  iso: string
  weekday: string
  label: string
  /** Exceptions on that day; `null` for a day that has not happened yet. */
  exceptions: number | null
  total: number
}

interface Props {
  operationalDate: string
  dayStrip: readonly DayStripEntry[]
  rows: readonly AttendanceRow[]
  now: Date
  shiftCode: string | null
  view: AttendanceView
  search: string
  onDateChange: (iso: string) => void
  onShiftChange: (shiftCode: string | null) => void
  onViewChange: (view: AttendanceView) => void
  onSearchChange: (value: string) => void
  onPrint: () => void
}

const SHIFT_ORDER: readonly string[] = ['morning', 'noon', 'night', 'office_day']

function orderedShifts(counts: Record<string, ShiftCount>): string[] {
  const present = Object.keys(counts)
  return [
    ...SHIFT_ORDER.filter((code) => present.includes(code)),
    ...present.filter((code) => !SHIFT_ORDER.includes(code)).sort(),
  ]
}

export function AttendanceToolbar({
  operationalDate,
  dayStrip,
  rows,
  now,
  shiftCode,
  view,
  search,
  onDateChange,
  onShiftChange,
  onViewChange,
  onSearchChange,
  onPrint,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const counts = shiftCounts(rows, { now })
  const shifts = orderedShifts(counts)
  const today = dayStrip.at(-1)?.iso ?? operationalDate

  return (
    <div data-print-hide>
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2.5 rounded-2xl border border-hairline bg-surface p-2.5 shadow-[0_10px_26px_-22px_rgba(13,40,69,.4)]">
        <div className="flex items-center overflow-hidden rounded-xl border border-border">
          <button
            type="button"
            aria-label={t('attendance.toolbar.previousDay')}
            onClick={() => onDateChange(shiftDay(operationalDate, -1))}
            className="px-2.5 py-1.5 text-muted-foreground hover:bg-surface-tinted"
          >
            ‹
          </button>
          <span className="border-x border-border px-3 py-1.5 font-mono text-[0.82em] font-bold tabular-nums">
            {operationalDate}
          </span>
          <button
            type="button"
            aria-label={t('attendance.toolbar.nextDay')}
            onClick={() => onDateChange(shiftDay(operationalDate, 1))}
            className="px-2.5 py-1.5 text-muted-foreground hover:bg-surface-tinted"
          >
            ›
          </button>
        </div>

        <button
          type="button"
          onClick={() => onDateChange(today)}
          className="rounded-xl border border-border px-3 py-1.5 text-[0.78em] font-semibold text-primary hover:bg-primary-soft"
        >
          {t('attendance.toolbar.today')}
        </button>

        <div role="group" aria-label={t('attendance.title')} className="flex overflow-hidden rounded-xl border border-border">
          {shifts.map((code) => {
            const count = counts[code] ?? { seen: 0, due: 0 }
            const active = shiftCode === code
            return (
              <button
                key={code}
                type="button"
                aria-pressed={active}
                onClick={() => onShiftChange(active ? null : code)}
                className={`flex items-center gap-1.5 border-e border-border px-3 py-1.5 text-[0.78em] last:border-e-0 ${
                  active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-tinted'
                }`}
              >
                {t(`attendance.shift.${code}`, code)}
                <span className="font-mono text-[0.88em] font-bold opacity-75">
                  {count.due === 0 ? '—' : `${count.seen}/${count.due}`}
                </span>
              </button>
            )
          })}
        </div>

        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-border px-2.5 py-1.5 md:max-w-[280px]">
          <span aria-hidden>🔍</span>
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t('attendance.toolbar.search')}
            aria-label={t('attendance.toolbar.search')}
            className="min-w-0 flex-1 border-0 bg-transparent text-[0.82em] outline-none placeholder:text-faint"
          />
          <kbd className="rounded border border-border px-1 font-mono text-[0.7em] text-faint">/</kbd>
        </label>

        <div role="group" aria-label={t('attendance.toolbar.viewsHint')} className="ms-auto flex gap-0.5 rounded-xl bg-surface-tinted p-[3px]">
          {VIEWS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={view === candidate}
              onClick={() => onViewChange(candidate)}
              className={`rounded-lg px-2.5 py-1 text-[0.78em] ${
                view === candidate
                  ? 'bg-surface font-bold text-primary shadow-sm'
                  : 'text-muted-foreground'
              }`}
            >
              {t(`attendance.views.${candidate}`)}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onPrint}
          className="rounded-xl border border-border px-3 py-1.5 text-[0.78em] font-semibold text-primary hover:bg-primary-soft"
        >
          {t('attendance.toolbar.print')}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1.5 md:grid-cols-7">
        {dayStrip.map((day) => {
          const active = day.iso === operationalDate
          const ratio = day.exceptions === null || day.total === 0 ? 0 : day.exceptions / day.total
          return (
            <button
              key={day.iso}
              type="button"
              onClick={() => onDateChange(day.iso)}
              aria-current={active ? 'date' : undefined}
              className={`rounded-xl border bg-surface px-2 py-1.5 text-start ${
                active ? 'border-primary shadow-[0_0_0_2px_var(--primary-soft)]' : 'border-hairline'
              } ${day.exceptions === null ? 'opacity-50' : ''}`}
            >
              <div className="text-[0.68em] uppercase tracking-[.08em] text-faint">{day.weekday}</div>
              <div className="mt-0.5 font-mono text-[0.82em] font-bold tabular-nums">{day.label}</div>
              <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-surface-tinted">
                {day.exceptions === null ? null : (
                  <>
                    <i className="h-full bg-success" style={{ width: `${(1 - ratio) * 100}%` }} />
                    <i className="h-full bg-accent" style={{ width: `${ratio * 100}%` }} />
                  </>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-3.5 px-1 text-[0.7em] text-faint">
        <span>
          <Kbd>←</Kbd> <Kbd>→</Kbd> {t('attendance.toolbar.keyboardDay')}
        </span>
        <span>
          <Kbd>1</Kbd>–<Kbd>4</Kbd> {t('attendance.toolbar.keyboardShift')}
        </span>
        <span>
          <Kbd>/</Kbd> {t('attendance.toolbar.keyboardSearch')}
        </span>
        <span className="ms-auto">{t('attendance.toolbar.viewsHint')}</span>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="rounded border border-border px-1 font-mono text-[0.95em] text-muted-foreground">
      {children}
    </kbd>
  )
}

/** Local-time day step, kept here so the toolbar owns no date library. */
function shiftDay(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const at = new Date(year, (month ?? 1) - 1, day ?? 1)
  at.setDate(at.getDate() + days)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}
