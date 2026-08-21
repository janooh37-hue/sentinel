/**
 * The dock: fixed furniture below the grid, four groups, ONE panel host
 * (UI spec §16.2).
 *
 * It reads at a glance without opening anything — contracted posts and the
 * implied count, all eight code counts, the selected employee, and the two
 * download buttons — and each group is a button carrying `aria-expanded` that
 * opens its panel **upward over the grid**. The upward direction is the whole
 * point: A3's premise is that the page never scrolls and only the grid does, so
 * a panel may not push the grid down, and reaching a download may never mean
 * scrolling past 275 employees. `.ts-panelhost` / `.ts-panel` in `index.css` own
 * that geometry from one declaration; nothing here names a physical side.
 *
 * One host, one open panel. `ui.panel` is the single source of truth and lives
 * on `TimesheetPage`, because the grid highlights the same selection and the
 * head's search field opens the employee panel. `Escape` closes whatever is
 * open, from anywhere on the page.
 *
 * Amendment A3's capability split runs through here: `timesheet.view` gets a
 * complete, usable dock — the posts readout, the code tally, the checks, the
 * per-employee extract — and every affordance that WRITES or FREEZES (the post
 * count, the month downloads, close, reopen, start-ack, the red block) is
 * absent rather than disabled, because a disabled control still answers Enter
 * and Space (UI spec §14).
 */

import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { TimesheetGridResponse, TimesheetRemoved, TimesheetVariant } from '@/lib/api'
import { cn } from '@/lib/utils'

import { CODES, type CodeSlug, slugOf } from './codes'
import type { TimesheetUiState } from './TimesheetPage'
import type { RosterEdge } from './useTimesheet'
import { ChecksPanel } from './panels/ChecksPanel'
import { CodesPanel } from './panels/CodesPanel'
import { EmployeePanel } from './panels/EmployeePanel'
import { PostsPanel } from './panels/PostsPanel'
import { ReleasePanel } from './panels/ReleasePanel'

type Panel = TimesheetUiState['panel']

export interface TimesheetDockProps {
  /** The whole GET payload, including `removed`. */
  grid: TimesheetGridResponse
  /** The operator holds `timesheet.edit` (amendment A3). */
  canEdit: boolean
  /** Derived by `TimesheetPage` from `rows`; not fields on the payload. */
  joined: RosterEdge[]
  leaving: RosterEdge[]
  ui: TimesheetUiState
  onOpenPanel: (panel: Panel) => void
  onSelect: (employeeId: string | null) => void
  onQuery: (query: string) => void
  onAcknowledge: (employeeId: string) => void
  onSetPostCount: (postCount: number) => void
  onDownload: (variant: TimesheetVariant) => void
  onEmployeeDownload: (args: {
    employeeId: string
    year: number
    month: number
    months: 1 | 2
  }) => void
  /** The red-block helper: one call carrying every day to block, edges excluded. */
  onFillRedBlock: (employeeId: string, days: number[]) => void
  onClose: () => void
  onReopen: () => void
}

/** The `-` code prints as a hyphen but reads as an en dash on screen. */
const glyphOf = (slug: CodeSlug): string => (slug === '-' ? '–' : slug)

const EMPTY_REMOVED: TimesheetRemoved[] = []

export function TimesheetDock({
  grid,
  canEdit,
  joined,
  leaving,
  ui,
  onOpenPanel,
  onSelect,
  onQuery,
  onAcknowledge,
  onSetPostCount,
  onDownload,
  onEmployeeDownload,
  onFillRedBlock,
  onClose,
  onReopen,
}: TimesheetDockProps): React.JSX.Element {
  const { t } = useTranslation()
  const open = ui.panel
  const closed = grid.closed_at !== null
  const blocked = grid.blocking.length > 0 && !closed
  const daysInMonth = grid.days_in_month

  /**
   * On `document`, not on the panel: `Escape` has to close the panel from
   * wherever the focus happens to be — the head's search field, a dock button,
   * or nothing at all. Only bound while something is open, so it cannot
   * interfere with the grid's own `Escape` (which cancels a sweep and closes
   * the cell picker).
   */
  useEffect(() => {
    if (open === null) return
    const shut = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onOpenPanel(null)
    }
    document.addEventListener('keydown', shut)
    return () => document.removeEventListener('keydown', shut)
  }, [onOpenPanel, open])

  /** Every code counted across the workbook on screen, for the strip. */
  const counts = useMemo(() => {
    const out: Record<CodeSlug, number> = { P: 0, AL: 0, SL: 0, AB: 0, TR: 0, NG: 0, '-': 0, X: 0 }
    for (const row of grid.rows) {
      const codes = ui.variant === 'statistics' ? row.stat_codes : row.codes
      for (let day = 1; day <= daysInMonth; day += 1) {
        const slug = slugOf(codes[day - 1] ?? null)
        if (slug !== '') out[slug] += 1
      }
    }
    return out
  }, [daysInMonth, grid.rows, ui.variant])

  /**
   * Implied posts: the mean daily manned headcount, which is the same number
   * the grid's headcount footer adds up column by column.
   */
  const impliedPosts = daysInMonth === 0 ? 0 : counts.P / daysInMonth
  const drift = impliedPosts > grid.post_count

  const group =
    'inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[0.75em] transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:border-primary aria-expanded:bg-primary-soft'
  const caps = 'shrink-0 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-faint'
  const datum = 'shrink-0 font-mono text-[0.78em] font-semibold tabular-nums [unicode-bidi:isolate]'
  const chip = 'shrink-0 rounded-full px-1.5 py-0.5 text-[0.62rem] font-semibold'

  const toggle = (panel: Exclude<Panel, null>) => () => onOpenPanel(open === panel ? null : panel)

  const selectedRow = ui.selected
    ? (grid.rows.find((row) => row.employee_id === ui.selected) ?? null)
    : null

  /** The open panel's title, which is also the region's accessible name. */
  const title =
    open === 'posts'
      ? t('timesheet.postsLabel')
      : open === 'codes'
        ? t('timesheet.cellsByCode')
        : open === 'checks'
          ? t('timesheet.panelChecks')
          : open === 'employee'
            ? t('timesheet.employee.sheet')
            : open === 'release'
              ? t('timesheet.release.title')
              : ''

  return (
    <div
      data-testid="timesheet-dock"
      className="ts-panelhost shrink-0 border-t border-border bg-surface"
    >
      <div className="flex min-h-[54px] flex-wrap items-center gap-2 px-4 py-2 md:px-6">
        <button
          type="button"
          aria-expanded={open === 'posts'}
          onClick={toggle('posts')}
          className={group}
        >
          <span data-ts-caps className={caps}>
            {t('timesheet.postsLabel')}
          </span>
          <span dir="ltr" className={datum}>
            {grid.post_count} · {impliedPosts.toFixed(1)}
          </span>
          {/* A compact flag, because a whole sentence in a 54px bar pushes the
              other three groups off the line (UI spec §14's narrow-column
              trap). The glyph is not the only channel: the words ride along in
              the trigger's accessible name, and the panel states them in full
              beside the number. */}
          <span
            className={cn(chip, drift ? 'bg-accent-soft text-accent' : 'bg-success-soft text-success')}
          >
            <span aria-hidden>{drift ? '▲' : '✓'}</span>
            <span className="sr-only">
              {drift ? t('timesheet.impliedDrift') : t('timesheet.impliedOk')}
            </span>
          </span>
          <span aria-hidden className="text-[0.6rem] text-faint">
            ▲
          </span>
        </button>

        {/*
          An explicit `aria-label`, so the button has a NAME rather than a run of
          glyphs and digits — and so the code labels stay out of it. Those labels
          belong to the tally inside the panel, where each one sits beside its
          own count; repeated in the trigger they would be eight words the
          operator has to hear before reaching the number.
        */}
        <button
          type="button"
          aria-expanded={open === 'codes'}
          aria-label={`${t('timesheet.codesLabel')} — ${t('timesheet.cellsByCode')}`}
          onClick={toggle('codes')}
          className={group}
        >
          <span data-ts-caps className={caps} aria-hidden>
            {t('timesheet.codesLabel')}
          </span>
          <span data-testid="dock-codes" className="flex shrink-0 items-center gap-1.5">
            {CODES.map((spec) => (
              <span
                key={spec.slug}
                dir="ltr"
                className={cn(
                  'inline-flex items-center gap-1 font-mono text-[0.68rem] [unicode-bidi:isolate]',
                  counts[spec.slug] === 0 && 'opacity-40',
                )}
              >
                <span
                  data-code={spec.slug}
                  aria-hidden
                  className="grid h-[0.9rem] w-[1.3rem] place-items-center rounded-[3px] border border-border text-[0.58rem] font-semibold"
                >
                  {glyphOf(spec.slug)}
                </span>
                <span data-testid={`dock-count-${spec.slug}`} className="tabular-nums">
                  {counts[spec.slug]}
                </span>
              </span>
            ))}
          </span>
          <span aria-hidden className="text-[0.6rem] text-faint">
            ▲
          </span>
        </button>

        <button
          type="button"
          aria-expanded={open === 'employee'}
          onClick={toggle('employee')}
          className={group}
        >
          <span data-ts-caps className={caps}>
            {t('timesheet.employee.sheet')}
          </span>
          <span dir="ltr" className={datum}>
            {selectedRow ? selectedRow.employee_id : `⌕ ${t('common.search')}`}
          </span>
          {selectedRow && (
            <span className={cn(chip, 'bg-primary-soft text-primary')}>
              {t('timesheet.employee.twoMonths')}
            </span>
          )}
          <span aria-hidden className="text-[0.6rem] text-faint">
            ▲
          </span>
        </button>

        <span className="ms-auto flex flex-wrap items-center gap-2">
          {closed && (
            <span
              data-testid="dock-seal"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[0.72em] font-semibold text-success"
            >
              <span
                aria-hidden
                className="grid h-3.5 w-3.5 place-items-center rounded-full border border-success text-[0.55rem]"
              >
                ✓
              </span>
              {t('timesheet.closed')}
            </span>
          )}

          {/* Producing either workbook FREEZES the month, so both buttons are
              `timesheet.edit` and are not rendered without it. */}
          {canEdit && (
            <>
              {blocked && (
                <span className="shrink-0 text-[0.74em] font-semibold text-accent">
                  {t('timesheet.blocking')}
                </span>
              )}
              <button
                type="button"
                disabled={blocked}
                onClick={() => onDownload('attendance')}
                className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-[0.76em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <span aria-hidden>↓ </span>
                {t('timesheet.attendance')}
              </button>
              <button
                type="button"
                disabled={blocked}
                onClick={() => onDownload('statistics')}
                className="shrink-0 rounded-full border border-border-strong bg-surface px-3 py-1.5 text-[0.76em] font-semibold text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <span aria-hidden>↓ </span>
                {t('timesheet.statistics')}
              </button>
            </>
          )}

          <button
            type="button"
            aria-expanded={open === 'release'}
            onClick={toggle('release')}
            className={group}
          >
            <span data-ts-caps className={caps}>
              {t('timesheet.filesLabel')}
            </span>
            <span dir="ltr" className={datum}>
              2
            </span>
            <span aria-hidden className="text-[0.6rem] text-faint">
              ▲
            </span>
          </button>
        </span>
      </div>

      {open !== null && (
        <div role="region" aria-label={title} className="ts-panel">
          <header className="mb-2.5 flex items-start gap-3">
            <h2 className="text-[0.92em] font-semibold">{title}</h2>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={() => onOpenPanel(null)}
              className="ms-auto shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              ✕
            </button>
          </header>

          {open === 'posts' && (
            <PostsPanel
              postCount={grid.post_count}
              impliedPosts={impliedPosts}
              canEdit={canEdit}
              closed={closed}
              onSetPostCount={onSetPostCount}
            />
          )}
          {open === 'codes' && (
            <CodesPanel rows={grid.rows} daysInMonth={daysInMonth} variant={ui.variant} />
          )}
          {open === 'checks' && (
            <ChecksPanel
              blocking={grid.blocking}
              warnings={grid.warnings}
              joined={joined}
              leaving={leaving}
              removed={grid.removed ?? EMPTY_REMOVED}
              year={grid.year}
              month={grid.month}
              closed={closed}
              canEdit={canEdit}
              onAcknowledge={onAcknowledge}
              onSelect={onSelect}
            />
          )}
          {open === 'employee' && (
            <EmployeePanel
              rows={grid.rows}
              year={grid.year}
              month={grid.month}
              closed={closed}
              canEdit={canEdit}
              variant={ui.variant}
              selected={ui.selected}
              query={ui.query}
              onQuery={onQuery}
              onSelect={onSelect}
              onEmployeeDownload={onEmployeeDownload}
              onFillRedBlock={onFillRedBlock}
            />
          )}
          {open === 'release' && (
            <ReleasePanel
              year={grid.year}
              month={grid.month}
              closed={closed}
              closedAt={grid.closed_at}
              closedBy={grid.closed_by}
              blocking={grid.blocking}
              canEdit={canEdit}
              onDownload={onDownload}
              onClose={onClose}
              onReopen={onReopen}
            />
          )}
        </div>
      )}
    </div>
  )
}
