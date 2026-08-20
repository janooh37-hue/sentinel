/**
 * Monthly time sheet — the A3 locked shell (UI spec §16).
 *
 * The page is an app shell, and the ONE thing that scrolls is the grid. Head,
 * toolbar, ribbon and notice line are fixed above it; the dock is fixed below
 * it. That shape exists for one reason: reaching the release actions must never
 * mean scrolling past 275 employees. Everything here follows from it —
 * `overflow-hidden` on the shell, `flex-1 min-h-0 overflow-auto` on the grid
 * wrapper, and `min-h-0` on every flex ancestor in between, because a flex child
 * will not shrink below its content without it.
 *
 * `min-block-size-0` is NOT a Tailwind utility (v4.3.0 emits nothing for it), so
 * the block-axis release is spelled `min-h-0` — the same class the other 30
 * one-screen layouts in this app use. In a horizontal writing mode the two are
 * the same property; only one of them exists.
 *
 * Route: `/employees/timesheet`. The time sheet is a subpage under Employees,
 * not an eighth top-nav entry — see `TimesheetEntry` for the reasoning.
 *
 * Capability split (backend `_OPERATOR_CAPS` / `_MANAGER_CAPS`): `timesheet.view`
 * reads the month, `timesheet.edit` corrects it and produces the workbooks —
 * which freezes it. A viewer therefore gets a complete, read-only page: the
 * ribbon becomes the legend it looks like, and no edit affordance is rendered at
 * all (a disabled control still answers Enter and Space — UI spec §14).
 */

import { useCallback, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/ui/empty-state'
import type { TimesheetSheet, TimesheetVariant } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'

import { CodeRibbon } from './CodeRibbon'
import { TimesheetNotice } from './TimesheetNotice'
import { MonthStepper, TimesheetToolbar, type TimesheetDensity } from './TimesheetToolbar'
import type { Code } from './codes'
import { useSetCell, useTimesheetGrid } from './useTimesheet'

export interface TimesheetUiState {
  variant: TimesheetVariant
  /** The armed code, painted by a click or a keystroke on a cell. */
  brush: Code | null
  /** `employee_id` of the row the extract and the picker are pointed at. */
  selected: string | null
  panel: 'checks' | 'posts' | 'codes' | 'employee' | 'release' | null
  /** The employee search, forgiving: `7141`, `g7141`, `rasel` all match. */
  query: string
  density: TimesheetDensity
}

/** One correction, kept so `Undo last change` does not need the cell found again. */
interface Correction {
  employeeId: string
  day: number
  previous: Code | null
}

/** Enough rows to fill the tallest sane viewport; the skeleton is never scrolled. */
const SKELETON_ROWS = Array.from({ length: 14 }, (_, i) => i)

/**
 * The month the operator works on is the one that just ended: the workbooks are
 * produced after the month closes, not during it. The stepper goes anywhere.
 */
function lastMonth(): { year: number; month: number } {
  const now = new Date()
  const month = now.getMonth() // 0-based, so this IS last month 1-based
  return month === 0 ? { year: now.getFullYear() - 1, month: 12 } : { year: now.getFullYear(), month }
}

export function TimesheetPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const canEdit = has('timesheet.edit')

  const [params, setParams] = useState<{ year: number; month: number; sheet: TimesheetSheet }>(
    () => ({ ...lastMonth(), sheet: 'main' }),
  )
  const [ui, setUi] = useState<TimesheetUiState>({
    variant: 'attendance',
    brush: null,
    selected: null,
    panel: null,
    query: '',
    density: 'default',
  })
  const [corrections, setCorrections] = useState<Correction[]>([])

  const grid = useTimesheetGrid(params)
  const setCell = useSetCell(params)

  // Cells are correctable only on the attendance grid of an open month, by
  // someone holding `timesheet.edit`. The statistics grid is derived: the fix
  // belongs upstream, in the attendance grid or the filler assignment.
  const editable = canEdit && !grid.closed && ui.variant === 'attendance'

  const stepMonth = useCallback((delta: -1 | 1) => {
    setParams((prev) => {
      const raw = prev.month + delta
      if (raw < 1) return { ...prev, year: prev.year - 1, month: 12 }
      if (raw > 12) return { ...prev, year: prev.year + 1, month: 1 }
      return { ...prev, month: raw }
    })
    setCorrections([])
  }, [])

  const undo = useCallback(() => {
    const last = corrections[corrections.length - 1]
    if (!last) return
    setCorrections((stack) => stack.slice(0, -1))
    setCell.mutate({ employeeId: last.employeeId, day: last.day, code: last.previous })
  }, [corrections, setCell])

  const monthStamp = `${String(params.month).padStart(2, '0')} · ${params.year}`
  const arabicMonth = new Intl.DateTimeFormat('ar', { month: 'long' }).format(
    new Date(params.year, params.month - 1, 1),
  )
  const hint = grid.closed
    ? t('timesheet.closedOn', {
        date: grid.closedAt
          ? new Date(grid.closedAt).toLocaleDateString(i18n.language, {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })
          : '',
        who: grid.closedBy ?? '',
      })
    : ui.variant === 'statistics'
      ? t('timesheet.derivedHint')
      : canEdit
        ? t('timesheet.brushHint')
        : t('timesheet.readOnlyHint')

  return (
    <div
      data-testid="timesheet-shell"
      data-ts-density={ui.density}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
    >
      <div className="flex shrink-0 flex-col gap-2 px-4 pb-2 pt-3 md:px-6">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div
              data-ts-caps
              className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-faint"
            >
              {t('timesheet.eyebrow')}
            </div>
            <h1 className="text-[1.35em] font-bold tracking-tight text-foreground">
              {t('timesheet.title')}
            </h1>
          </div>
          <p className="min-w-0 max-w-[38ch] text-[0.78em] text-muted-foreground">
            {t('timesheet.lede')}
          </p>

          <div className="ms-auto flex flex-wrap items-center gap-3">
            <div>
              <label className="sr-only" htmlFor="timesheet-search">
                {t('timesheet.searchLabel')}
              </label>
              <input
                id="timesheet-search"
                type="search"
                value={ui.query}
                placeholder={t('timesheet.searchPlaceholder')}
                onChange={(e) =>
                  setUi((prev) => ({ ...prev, query: e.target.value, panel: 'employee' }))
                }
                className="w-[13rem] rounded-full border border-border-strong bg-surface px-3 py-1.5 text-[0.78em] text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            {/* The month as a mono datum, not a heading: it is compared against a
                filename. `07 · 2026` is one LTR run, so the leaf is isolated or
                bidi splits it around the separator (UI spec §14). */}
            <div className="text-end">
              <div
                dir="ltr"
                className="font-mono text-[1.15em] font-semibold tracking-tight tabular-nums [unicode-bidi:isolate]"
              >
                {monthStamp}
              </div>
              <div className="text-[0.7em] text-muted-foreground">{arabicMonth}</div>
            </div>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.72em] font-semibold',
                grid.closed
                  ? 'bg-primary-soft text-primary'
                  : grid.blocking.length > 0
                    ? 'bg-accent-soft text-accent'
                    : 'bg-success-soft text-success',
              )}
            >
              {grid.closed
                ? t('timesheet.closed')
                : grid.blocking.length > 0
                  ? t('timesheet.toFix', { count: grid.blocking.length })
                  : t('timesheet.ready')}
            </span>
          </div>
        </header>

        <TimesheetToolbar
          year={params.year}
          month={params.month}
          sheet={params.sheet}
          variant={ui.variant}
          density={ui.density}
          rowCount={grid.rows.length}
          daysInMonth={grid.daysInMonth}
          onStepMonth={stepMonth}
          onSheetChange={(sheet) => setParams((prev) => ({ ...prev, sheet }))}
          onVariantChange={(variant) => setUi((prev) => ({ ...prev, variant, brush: null }))}
          onDensityChange={(density) => setUi((prev) => ({ ...prev, density }))}
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CodeRibbon
            brush={ui.brush}
            onArm={(brush) => setUi((prev) => ({ ...prev, brush }))}
            readOnly={!editable}
          />
          <span className="text-[0.75em] text-muted-foreground">{hint}</span>
          <span className="ms-auto flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-tinted px-2.5 py-1 text-[0.72em] font-semibold text-muted-foreground">
              {t('timesheet.corrections', { count: corrections.length })}
            </span>
            <button
              type="button"
              onClick={undo}
              disabled={corrections.length === 0}
              className="text-[0.78em] font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40"
            >
              ↩ {t('timesheet.undo')}
            </button>
          </span>
        </div>

        <TimesheetNotice
          blocking={grid.blocking.length}
          warnings={grid.warnings.length}
          joined={grid.joined.length}
          leaving={grid.leaving.length}
          removed={grid.removed.length}
          onOpenChecks={() => setUi((prev) => ({ ...prev, panel: 'checks' }))}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 md:px-6">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-2xl border border-b-0 border-hairline bg-surface">
          {/* THE ONLY SCROLL REGION ON THE PAGE. The grid itself is Task 8; the
              loading and empty states are designed states and live here. */}
          <div data-testid="timesheet-scroll" className="min-h-0 flex-1 overflow-auto">
            {grid.isPending ? (
              <>
                <span role="status" className="sr-only">
                  {t('timesheet.loading')}
                </span>
                {/* Skeleton at the real metrics: the identity block and the 31
                    day columns are known before the month is, so the grid does
                    not resize when the data lands (UI spec §9). */}
                <div
                  data-testid="timesheet-skeleton"
                  aria-hidden
                  style={{ '--ts-days': grid.daysInMonth } as React.CSSProperties}
                  className="flex flex-col gap-1.5 p-3"
                >
                  {SKELETON_ROWS.map((n) => (
                    <div
                      key={n}
                      className="flex items-center gap-2"
                      style={{ blockSize: 'var(--row)' }}
                    >
                      <div className="h-3 w-[568px] shrink-0 animate-pulse rounded bg-surface-tinted" />
                      <div className="ts-skeleton-cells shrink-0 animate-pulse rounded" />
                    </div>
                  ))}
                </div>
              </>
            ) : grid.isError ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <p className="text-[0.82em] text-muted-foreground">{t('common.loadError')}</p>
                <button
                  type="button"
                  onClick={() => void grid.refetch()}
                  className="rounded-full border border-border-strong px-3 py-1 text-[0.75em] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('common.retry')}
                </button>
              </div>
            ) : grid.rows.length === 0 ? (
              // Not a shrug: the reason, and the way out of the month.
              <div
                data-testid="timesheet-empty"
                className="flex flex-col items-center gap-2 pb-10"
              >
                <EmptyState
                  icon={CalendarClock}
                  message={t('timesheet.emptyTitle')}
                  description={t('timesheet.emptyReason')}
                />
                <MonthStepper year={params.year} month={params.month} onStep={stepMonth} />
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {/* The dock: fixed furniture below the scroll region, so opening a panel
          costs no layout shift and reaching a download costs no scrolling. Its
          four groups — contracted posts, codes, employee sheet, files and
          downloads — are Task 9's `TimesheetDock`; the region is the shell's. */}
      <div
        data-testid="timesheet-dock"
        className="flex min-h-[54px] shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface px-4 py-2 md:px-6"
      />
    </div>
  )
}
