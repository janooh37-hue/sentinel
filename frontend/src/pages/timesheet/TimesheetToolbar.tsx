/**
 * The month bar: which month, which roster, which deliverable, how big.
 *
 * Every control is a pattern from UI spec §6 — §2.7c icon-buttons for the month
 * step, and one tinted-pill segmented control per axis. `aria-pressed` carries
 * the selection, so nothing here is signalled by colour alone.
 *
 * The sheet zoom is deliberately its own control rather than the Aa slider:
 * 31 columns is a fixed count, and a sheet that tracked the content scale would
 * stop fitting at the second stop (UI spec §3.3).
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { TimesheetSheet, TimesheetVariant } from '@/lib/api'
import { cn } from '@/lib/utils'

export type TimesheetDensity = 'compact' | 'default' | 'roomy'

interface SegmentedProps<T extends string> {
  /** Names the group for assistive tech; the options are its buttons. */
  label: string
  value: T
  options: readonly { value: T; label: string; ariaLabel?: string }[]
  onChange: (value: T) => void
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex shrink-0 gap-0.5 rounded-full bg-surface-tinted p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          aria-label={option.ariaLabel}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-full px-3 py-1 text-[0.78em] font-medium text-muted-foreground transition-colors',
            'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-tinted',
            option.value === value && 'bg-surface font-semibold text-primary shadow-sm',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * `‹ month ›`. Also rendered inside the empty state, because "no one was
 * employed this month" is only actionable next to the way out of the month.
 */
export function MonthStepper({
  year,
  month,
  onStep,
}: {
  year: number
  month: number
  onStep: (delta: -1 | 1) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const monthName = new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(
    new Date(year, month - 1, 1),
  )
  return (
    <div className="inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-label={t('timesheet.prevMonth')}
        onClick={() => onStep(-1)}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={2} aria-hidden />
      </button>
      <b className="min-w-[8ch] text-center font-mono text-[0.8em] font-semibold tabular-nums">
        {monthName} {year}
      </b>
      <button
        type="button"
        aria-label={t('timesheet.nextMonth')}
        onClick={() => onStep(1)}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={2} aria-hidden />
      </button>
    </div>
  )
}

export interface TimesheetToolbarProps {
  year: number
  month: number
  sheet: TimesheetSheet
  variant: TimesheetVariant
  density: TimesheetDensity
  rowCount: number
  daysInMonth: number
  onStepMonth: (delta: -1 | 1) => void
  onSheetChange: (sheet: TimesheetSheet) => void
  onVariantChange: (variant: TimesheetVariant) => void
  onDensityChange: (density: TimesheetDensity) => void
}

export function TimesheetToolbar({
  year,
  month,
  sheet,
  variant,
  density,
  rowCount,
  daysInMonth,
  onStepMonth,
  onSheetChange,
  onVariantChange,
  onDensityChange,
}: TimesheetToolbarProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-full border border-border bg-surface px-2.5 py-1.5">
      <MonthStepper year={year} month={month} onStep={onStepMonth} />
      <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
      <Segmented
        label={t('timesheet.roster')}
        value={sheet}
        onChange={onSheetChange}
        options={[
          { value: 'main', label: t('timesheet.sheetMain') },
          { value: 'drivers', label: t('timesheet.sheetDrivers') },
        ]}
      />
      <Segmented
        label={t('timesheet.deliverable')}
        value={variant}
        onChange={onVariantChange}
        options={[
          { value: 'attendance', label: t('timesheet.attendance') },
          { value: 'statistics', label: t('timesheet.statistics') },
        ]}
      />
      <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
      <span
        data-ts-caps
        className="shrink-0 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-faint"
      >
        {t('timesheet.zoom')}
      </span>
      <Segmented
        label={t('timesheet.zoom')}
        value={density}
        onChange={onDensityChange}
        options={[
          // S / M / L are glyphs, not copy — the accessible name carries the
          // meaning, in whichever language the operator is reading.
          { value: 'compact', label: 'S', ariaLabel: t('timesheet.zoomCompact') },
          { value: 'default', label: 'M', ariaLabel: t('timesheet.zoomDefault') },
          { value: 'roomy', label: 'L', ariaLabel: t('timesheet.zoomRoomy') },
        ]}
      />
      {/* Each phrase is isolated so the `·` between two numerals cannot pull
          one of them to the wrong end of an Arabic line (UI spec §14). */}
      <span className="ms-auto flex shrink-0 items-center gap-1.5 text-[0.75em] text-muted-foreground">
        <span className="[unicode-bidi:isolate]">{t('timesheet.rows', { count: rowCount })}</span>
        <span aria-hidden>·</span>
        <span className="[unicode-bidi:isolate]">{t('timesheet.days', { count: daysInMonth })}</span>
      </span>
    </div>
  )
}
