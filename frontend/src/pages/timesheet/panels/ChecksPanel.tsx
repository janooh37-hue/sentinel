/**
 * Everything wrong with the month, then everyone who moved (UI spec §16.4,
 * §16.5).
 *
 * **Keyed by employee, never joined to `rows`.** `MonthGrid.warnings` is
 * recomputed live even on a sealed month, so an `Issue.employee_id` may name
 * somebody with no row in the same payload — `departed_but_active` is
 * deliberately reported for exactly those people. So an issue is rendered whole
 * from what the issue itself carries: the id, the localised `kind`, and the
 * server's own `detail`. Nothing here looks a row up, and nothing here assumes
 * one exists.
 *
 * Which is why the row jump is CONDITIONAL rather than universal.
 * `rosterEmployeeIds` is the page handing over the ids the sheet is actually
 * printing, so a finding that names somebody with no row here is offered the
 * record and nothing else — a `Show row` that cannot honour itself is worse
 * than no control at all. Nothing in this file joins an issue to a row.
 *
 * The jump and the record are separate CONTROLS. As a `<Link>` wrapping a
 * `Show row` button — which is what this panel used to be — one gesture fires
 * the other, and a click meant to scroll the sheet leaves the month instead.
 *
 * `Confirm starting point` is `timesheet.edit` and is offered on a **closed**
 * month too: accepting a starting point creates no override row and changes no
 * cell, so it is not a correction to a sealed workbook.
 */

import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import type { TimesheetIssue, TimesheetRemoved } from '@/lib/api'
import { cn } from '@/lib/utils'

import type { RosterEdge } from '../useTimesheet'

export interface ChecksPanelProps {
  /** Task 3's `Issue`: `{ employee_id, kind, detail }`. No level, no prose. */
  blocking: TimesheetIssue[]
  warnings: TimesheetIssue[]
  /** Derived by `TimesheetPage` from `rows`; not fields on the payload. */
  joined: RosterEdge[]
  leaving: RosterEdge[]
  /** The one movement the server has to report: these people have no row. */
  removed: TimesheetRemoved[]
  year: number
  month: number
  /**
   * Sealed. Deliberately NOT a gate on `Confirm starting point` — see the file
   * header — but it is why the blocking checks cannot be corrected here.
   */
  closed: boolean
  canEdit: boolean
  /**
   * Who has a row on the sheet on screen. A set rather than the rows
   * themselves: this panel must not be able to join an issue to a row, only to
   * ask whether jumping to one is possible.
   */
  rosterEmployeeIds: ReadonlySet<string>
  onAcknowledge: (employeeId: string) => void
  /** Clears any code filter, selects the row, scrolls to it, marks it. */
  onShowRow: (employeeId: string) => void
}

export function ChecksPanel({
  blocking,
  warnings,
  joined,
  leaving,
  removed,
  year,
  month,
  closed,
  canEdit,
  rosterEmployeeIds,
  onAcknowledge,
  onShowRow,
}: ChecksPanelProps): React.JSX.Element {
  const { t, i18n } = useTranslation()

  const monthName = (m: number, y: number): string =>
    new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(new Date(y, m - 1, 1))

  const chip = 'shrink-0 rounded-full px-2 py-0.5 text-[0.62rem] font-semibold'
  const line =
    'flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-sm px-2.5 py-1.5 text-[0.78em]'
  const who =
    'shrink-0 font-mono text-[0.7rem] font-semibold text-muted-foreground [unicode-bidi:isolate]'
  const action =
    'shrink-0 rounded-full border border-border-strong bg-surface px-2.5 py-0.5 text-[0.72em] font-semibold text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  /**
   * One finding: its level, who it is about, what is wrong, the server's own
   * sentence — and up to two actions, never nested.
   *
   * The record link is the one action that works for EVERY issue, including
   * the ones naming somebody with no row on this sheet: it goes to the person,
   * not to a grid row. The jump is offered beside it only when the sheet is
   * printing that person.
   *
   * The level is text plus shape, never colour alone (UI spec §6), and the 3px
   * reading-start rule is the level again in a third channel.
   */
  const issue = (item: TimesheetIssue, stop: boolean): React.JSX.Element => {
    // Bound once. When no translation exists the `<b>` shows the server's
    // sentence, so rendering `detail` again beside it would print the same
    // sentence twice — in exactly the case the fallback exists for.
    const kind = t(`timesheet.issues.${item.kind}`, { defaultValue: '' })
    const jumpable = rosterEmployeeIds.has(item.employee_id)
    return (
      <div
        key={`${item.employee_id}|${item.kind}|${item.detail}`}
        data-testid={`check-issue-${item.employee_id}-${item.kind}`}
        className={cn(
          line,
          'border-s-[3px]',
          stop ? 'border-accent bg-accent-soft/45' : 'border-warning bg-warning-soft/45',
        )}
      >
        <span
          className={cn(chip, stop ? 'bg-accent-soft text-accent' : 'bg-warning-soft text-warning')}
        >
          {stop ? t('timesheet.blocking') : t('timesheet.warning')}
        </span>
        {/* The id is the shortest way to the row, for the operator who reads
            the number before the sentence. */}
        {jumpable ? (
          <button
            type="button"
            dir="ltr"
            onClick={() => onShowRow(item.employee_id)}
            className={cn(
              who,
              'rounded-sm underline-offset-2 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            {item.employee_id}
          </button>
        ) : (
          <span dir="ltr" className={who}>
            {item.employee_id}
          </span>
        )}
        <b className="shrink-0 font-semibold">{kind || item.detail}</b>
        {kind !== '' && <span className="min-w-0 text-muted-foreground">{item.detail}</span>}
        <span className="ms-auto flex shrink-0 items-center gap-1.5">
          {jumpable && (
            <button type="button" onClick={() => onShowRow(item.employee_id)} className={action}>
              {t('timesheet.showRow')}
            </button>
          )}
          {/* §9: the rows link to the employee that fixes it. */}
          <Link to={`/employees/${encodeURIComponent(item.employee_id)}`} className={action}>
            {t('timesheet.openRecord')}
          </Link>
        </span>
      </div>
    )
  }

  const movement = joined.length + leaving.length + removed.length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        {blocking.length === 0 && warnings.length === 0 ? (
          <p className="text-[0.8em] font-medium text-success">✓ {t('timesheet.allClear')}</p>
        ) : (
          <>
            {blocking.map((item) => issue(item, true))}
            {warnings.map((item) => issue(item, false))}
            {/* A sealed month cannot be corrected, so say why the fixes above
                are not reachable from here rather than leaving the operator to
                click at a frozen grid. */}
            {closed && blocking.length > 0 && (
              <p className="px-2.5 text-[0.74em] text-muted-foreground">{t('timesheet.frozen')}</p>
            )}
          </>
        )}
      </div>

      {movement > 0 && (
        <div className="flex flex-col gap-1 border-t border-hairline pt-2.5">
          <span
            data-ts-caps
            className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-faint"
          >
            {t('timesheet.rosterMovement')}
          </span>

          {joined.map((edge) => (
            <div
              key={edge.employee_id}
              data-testid={`check-joined-${edge.employee_id}`}
              className={cn(line, 'bg-surface-tinted')}
            >
              <span className={cn(chip, 'bg-warning-soft text-warning')}>
                {t('timesheet.newEmployee')}
              </span>
              <span dir="ltr" className={who}>
                {edge.employee_id}
              </span>
              <b className="shrink-0 font-semibold">{edge.name_en}</b>
              <span className="min-w-0 text-muted-foreground">
                {t('timesheet.startedOn', {
                  day: edge.day,
                  before: Math.max(1, edge.day - 1),
                })}
              </span>
              <span className="ms-auto flex shrink-0 items-center gap-1.5">
                {edge.confirmed ? (
                  <span className={cn(chip, 'bg-success-soft text-success')}>
                    ✓ {t('timesheet.startConfirmed')}
                  </span>
                ) : (
                  canEdit && (
                    <button
                      type="button"
                      onClick={() => onAcknowledge(edge.employee_id)}
                      className={action}
                    >
                      {t('timesheet.confirmStart')}
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => onShowRow(edge.employee_id)}
                  className={action}
                >
                  {t('timesheet.showRow')}
                </button>
                {/* §16.4: the page flags a date of joining inside the month and
                    links to the record, where the date itself is corrected. */}
                <Link
                  to={`/employees/${encodeURIComponent(edge.employee_id)}`}
                  className={action}
                >
                  {t('timesheet.openRecord')}
                </Link>
              </span>
            </div>
          ))}

          {leaving.map((edge) => (
            <div
              key={edge.employee_id}
              data-testid={`check-leaving-${edge.employee_id}`}
              className={cn(line, 'bg-surface-tinted')}
            >
              <span className={cn(chip, 'bg-accent-soft text-accent')}>
                {t('timesheet.leaving')}
              </span>
              <span dir="ltr" className={who}>
                {edge.employee_id}
              </span>
              <b className="shrink-0 font-semibold">{edge.name_en}</b>
              <span className="min-w-0 text-muted-foreground">
                {t('timesheet.lastWorked', { day: edge.day })}
              </span>
              <button
                type="button"
                onClick={() => onShowRow(edge.employee_id)}
                className={cn(action, 'ms-auto')}
              >
                {t('timesheet.showRow')}
              </button>
            </div>
          ))}

          {/* Removed people have no row on this sheet by construction, so there
              is nothing to show and nothing to confirm — only the reason. */}
          {removed.map((gone) => (
            <div
              key={gone.employee_id}
              data-testid={`check-removed-${gone.employee_id}`}
              className={cn(line, 'bg-surface-tinted')}
            >
              <span className={cn(chip, 'bg-primary-soft text-primary')}>
                {t('timesheet.removedLabel')}
              </span>
              <span dir="ltr" className={who}>
                {gone.employee_id}
              </span>
              <b className="shrink-0 font-semibold">{gone.name_en}</b>
              <span className="min-w-0 text-muted-foreground">
                {t('timesheet.removedReason', {
                  day: gone.last_day,
                  month: monthName(gone.month, gone.year),
                })}
              </span>
            </div>
          ))}
        </div>
      )}

      {year > 0 && (
        <span className="text-[0.7em] text-faint [unicode-bidi:isolate]">
          {monthName(month, year)} {year}
        </span>
      )}
    </div>
  )
}
