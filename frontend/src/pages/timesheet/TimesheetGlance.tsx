/**
 * The sheet's margin column: two views, a rail, and no state of its own
 * (design §"Side glance").
 *
 * It reads as a note pinned to the desk BESIDE the paper rather than a second
 * card on top of it — `bg-background`, no border of its own, the sheet card's
 * own edge doing the separating. That is the whole reason the page can afford a
 * permanent column here: nothing about it competes with the workbook it
 * annotates, so an operator's eye stays on the roster until they want a number.
 *
 * `TimesheetPage` owns the active view, the collapsed flag, the code index and
 * the filter; this column prints what it is handed and reports three
 * intentions. So collapsing, hiding for a bottom panel and coming back cannot
 * lose the view — there is nothing here to lose.
 *
 * Two decisions worth the words:
 *
 * 1. **The rail still carries the blocking count.** At 36px there is no room
 *    for a meaning, and the one number that stops the month from being
 *    downloaded is worth every one of those pixels. Collapsing the column is
 *    not a reason to stop being told the download is blocked.
 *
 * 2. **A bottom panel stands the whole column down.** The panel opens UPWARD
 *    over the sheet and would cover this strip, so the page takes the track to
 *    zero and the contents unmount: a 400px column of live controls behind an
 *    open panel is a tab stop into something invisible, and it would put a
 *    second `code-badge-<slug>` in the document while the bottom Codes panel
 *    prints the same eight badges from the same index.
 *
 * No colour is named here. A badge renders `data-code={slug}` and `index.css`
 * resolves the workbook's own conditional format (UI spec §3.2), so this is a
 * third surface reading the same fills rather than a third palette.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { TimesheetIssue, TimesheetRemoved } from '@/lib/api'
import { cn } from '@/lib/utils'

import { CODES, type CodeSlug } from './codes'
import type { TimesheetCodeIndex } from './timesheetCodeIndex'
import type { RosterEdge } from './useTimesheet'
import { ChecksPanel } from './panels/ChecksPanel'

/** The two views. `codes` is the printed tally; `checks` is what is wrong. */
export type GlanceTab = 'codes' | 'checks'

export interface TimesheetGlanceProps {
  /** One page-owned pass, shared with the bottom panel and the filter bar. */
  index: TimesheetCodeIndex
  /** The code the sheet is filtered by, so the list can mark it. */
  activeCode: CodeSlug | null
  blocking: TimesheetIssue[]
  warnings: TimesheetIssue[]
  /** Derived by `TimesheetPage` from `rows`; not fields on the payload. */
  joined: RosterEdge[]
  leaving: RosterEdge[]
  /** The one movement the server has to report: these people have no row. */
  removed: TimesheetRemoved[]
  /** Who has a row on the sheet on screen — what makes a jump honourable. */
  rosterEmployeeIds: ReadonlySet<string>
  tab: GlanceTab
  collapsed: boolean
  /** A bottom panel is open, so this column stands down entirely. */
  dockOpen: boolean
  /**
   * Roster edit owns the sheet and the page ignores filter activation while it
   * lasts, so the codes refuse here exactly as the bottom trigger does — a
   * live-looking control calling an ignored callback is a dead control.
   */
  filterDisabled?: boolean
  year: number
  month: number
  closed: boolean
  canEdit: boolean
  onTab: (tab: GlanceTab) => void
  onCollapse: (next: boolean) => void
  onFilterCode: (code: CodeSlug) => void
  onShowRow: (employeeId: string) => void
  onAcknowledge: (employeeId: string) => void
}

/** The `-` code prints as a hyphen but reads as an en dash on screen. */
const glyphOf = (slug: CodeSlug): string => (slug === '-' ? '–' : slug)

export function TimesheetGlance({
  index,
  activeCode,
  blocking,
  warnings,
  joined,
  leaving,
  removed,
  rosterEmployeeIds,
  tab,
  collapsed,
  dockOpen,
  filterDisabled = false,
  year,
  month,
  closed,
  canEdit,
  onTab,
  onCollapse,
  onFilterCode,
  onShowRow,
  onAcknowledge,
}: TimesheetGlanceProps): React.JSX.Element {
  const toggleRef = useRef<HTMLButtonElement>(null)
  const restoreToggleFocus = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (restoreToggleFocus.current && !dockOpen) {
      toggleRef.current?.focus()
      restoreToggleFocus.current = false
    }
  }, [collapsed, dockOpen])

  const { t } = useTranslation()
  const railLabel =
    blocking.length > 0
      ? `${t('timesheet.glance.expand')} — ${t('timesheet.toFix', { count: blocking.length })}`
      : t('timesheet.glance.expand')
  const lockReason = filterDisabled ? ` — ${t('timesheet.rosterEdit.cellsLocked')}` : ''

  /**
   * The blocking count, in both places it appears — the rail and the Checks
   * view's own pill. The numeral is the datum and the words ride along for
   * anyone who cannot see the accent (UI spec §6: never colour alone).
   */
  const badge =
    blocking.length > 0 ? (
      <span
        data-testid="glance-blocking"
        className="inline-flex shrink-0 items-center rounded-full bg-accent-soft px-1.5 py-0.5 text-[0.62rem] font-semibold text-accent"
      >
        <span dir="ltr" aria-hidden className="font-mono tabular-nums">
          {blocking.length}
        </span>
        <span className="sr-only">{t('timesheet.toFix', { count: blocking.length })}</span>
      </span>
    ) : null

  return (
    <aside
      data-testid="timesheet-glance"
      aria-label={t('timesheet.glance.label')}
      aria-hidden={dockOpen ? true : undefined}
      inert={dockOpen}
      className="flex min-h-0 flex-col overflow-hidden bg-background"
    >
      {dockOpen ? null : collapsed ? (
        // The rail: the way back, and the number that blocks the month. The
        // whole 36px strip is the control, because a 14px chevron inside a 36px
        // column is a target nobody hits on the first try.
        <button
          ref={toggleRef}
          type="button"
          data-testid="glance-toggle"
          aria-expanded={false}
          aria-label={railLabel}
          onClick={() => {
            restoreToggleFocus.current = true
            onCollapse(false)
          }}
          className="flex min-h-0 flex-1 flex-col items-center gap-2 pt-2 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {/* Points INTO the sheet, which is the direction it opens — one
              declaration, mirrored by the engine under `rtl`. */}
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={2} aria-hidden />
          {badge}
        </button>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-1 pb-1 ps-3">
            <span
              data-ts-caps
              className="min-w-0 truncate text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-faint"
            >
              {t('timesheet.glance.label')}
            </span>
            <button
              ref={toggleRef}
              type="button"
              data-testid="glance-toggle"
              aria-expanded
              aria-label={t('timesheet.glance.collapse')}
              onClick={() => {
                restoreToggleFocus.current = true
                onCollapse(true)
              }}
              className="ms-auto shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} aria-hidden />
            </button>
          </div>

          {/* The two views, as the pill pair the toolbar already uses for every
              other either/or on this page. */}
          <div className="mx-3 flex shrink-0 gap-0.5 rounded-full bg-surface-tinted p-0.5">
            <button
              type="button"
              aria-pressed={tab === 'codes'}
              onClick={() => onTab('codes')}
              className={cn(
                'flex flex-1 items-center justify-center rounded-full px-2 py-0.5 text-[0.7em] font-medium text-muted-foreground transition-colors',
                'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-tinted',
                tab === 'codes' && 'bg-surface font-semibold text-primary shadow-sm',
              )}
            >
              {t('timesheet.cellsByCode')}
            </button>
            <button
              type="button"
              aria-pressed={tab === 'checks'}
              onClick={() => onTab('checks')}
              className={cn(
                'flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[0.7em] font-medium text-muted-foreground transition-colors',
                'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-tinted',
                tab === 'checks' && 'bg-surface font-semibold text-primary shadow-sm',
              )}
            >
              {t('timesheet.panelChecks')}
              {badge}
            </button>
          </div>

          {/* THE COLUMN'S OWN SCROLLER. It is not the sheet's: the roster keeps
              exactly one scroll region (locked rule 6), and a long list of
              findings must not lengthen the page. */}
          <div
            data-testid="glance-scroll"
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pt-1.5"
          >
            {tab === 'codes' ? (
              <div className="flex flex-col gap-px">
                {CODES.map((spec) => {
                  const cells = index.cellCounts[spec.slug]
                  // Zero MATCHES, not zero cells: the list navigates employees,
                  // so a code no row carries has nothing to walk. Refused and
                  // still printed — the tally is the month's own arithmetic and
                  // a missing line reads as a missing code (design §"Counts
                  // and colors").
                  const carried = index.employeeIds[spec.slug].length > 0
                  return (
                    <button
                      key={spec.slug}
                      type="button"
                      data-testid={`glance-code-${spec.slug}`}
                      disabled={!carried || filterDisabled}
                      aria-pressed={activeCode === spec.slug}
                      // The letter is decoration for the meaning beside it, so
                      // the NAME is the meaning and its count.
                      aria-label={`${t(spec.labelKey)} · ${t('timesheet.cells', {
                        count: cells,
                      })}${lockReason}`}
                      onClick={() => onFilterCode(spec.slug)}
                      className={cn(
                        'grid grid-cols-[1.4rem_minmax(0,1fr)_auto] items-center gap-1.5 rounded-sm px-1 py-0.5 text-start text-[0.72em] transition-colors',
                        'hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                        'disabled:cursor-not-allowed disabled:hover:bg-transparent',
                        activeCode === spec.slug && 'bg-primary-soft font-semibold text-primary',
                        (!carried || filterDisabled) && 'opacity-45',
                      )}
                    >
                      <span
                        data-testid={`code-badge-${spec.slug}`}
                        data-code={spec.slug}
                        aria-hidden
                        className="grid h-[1.05rem] place-items-center rounded-[3px] border border-border font-mono text-[0.6rem] font-semibold"
                      >
                        {glyphOf(spec.slug)}
                      </span>
                      <span className="truncate">{t(spec.labelKey)}</span>
                      <span
                        dir="ltr"
                        data-testid={`glance-count-${spec.slug}`}
                        className="text-end font-mono tabular-nums text-muted-foreground [unicode-bidi:isolate]"
                      >
                        {cells}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <ChecksPanel
                blocking={blocking}
                warnings={warnings}
                joined={joined}
                leaving={leaving}
                removed={removed}
                year={year}
                month={month}
                closed={closed}
                canEdit={canEdit}
                rosterEmployeeIds={rosterEmployeeIds}
                onAcknowledge={onAcknowledge}
                onShowRow={onShowRow}
              />
            )}
          </div>
        </>
      )}
    </aside>
  )
}
