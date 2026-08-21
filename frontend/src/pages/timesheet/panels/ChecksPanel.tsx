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
 * Which is also why an issue is NOT a row-as-button. The only action that would
 * work for every issue is a navigation away from the month, and the roster
 * movement below — where a row exists by construction, because `joined` and
 * `leaving` are DERIVED from `rows` — is where `Show row` belongs.
 *
 * `Confirm starting point` is `timesheet.edit` and is offered on a **closed**
 * month too: accepting a starting point creates no override row and changes no
 * cell, so it is not a correction to a sealed workbook.
 */

import { useTranslation } from 'react-i18next'

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
  onAcknowledge: (employeeId: string) => void
  onSelect: (employeeId: string | null) => void
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
  onAcknowledge,
  onSelect,
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
   * One finding. The level is text plus shape, never colour alone (UI spec §6),
   * and the 3px reading-start rule is the level again in a third channel.
   */
  const issue = (item: TimesheetIssue, stop: boolean): React.JSX.Element => (
    <div
      key={`${item.employee_id}|${item.kind}|${item.detail}`}
      className={cn(
        line,
        'border-s-[3px]',
        stop ? 'border-accent bg-accent-soft/45' : 'border-warning bg-warning-soft/45',
      )}
    >
      <span className={cn(chip, stop ? 'bg-accent-soft text-accent' : 'bg-warning-soft text-warning')}>
        {stop ? t('timesheet.blocking') : t('timesheet.warning')}
      </span>
      <span dir="ltr" className={who}>
        {item.employee_id}
      </span>
      {/* `kind` is the stable machine string and this panel owns the words. A
          kind nobody has translated yet falls back to the server's own
          sentence rather than printing `timesheet.issues.whatever`. */}
      <b className="shrink-0 font-semibold">
        {t(`timesheet.issues.${item.kind}`, { defaultValue: '' }) || item.detail}
      </b>
      <span className="min-w-0 text-muted-foreground">{item.detail}</span>
    </div>
  )

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
            <div key={edge.employee_id} className={cn(line, 'bg-surface-tinted')}>
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
                  onClick={() => onSelect(edge.employee_id)}
                  className={action}
                >
                  {t('timesheet.showRow')}
                </button>
              </span>
            </div>
          ))}

          {leaving.map((edge) => (
            <div key={edge.employee_id} className={cn(line, 'bg-surface-tinted')}>
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
                onClick={() => onSelect(edge.employee_id)}
                className={cn(action, 'ms-auto')}
              >
                {t('timesheet.showRow')}
              </button>
            </div>
          ))}

          {/* Removed people have no row on this sheet by construction, so there
              is nothing to show and nothing to confirm — only the reason. */}
          {removed.map((gone) => (
            <div key={gone.employee_id} className={cn(line, 'bg-surface-tinted')}>
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

      {/* The month the movement is being read against, so `day 17 of June`
          beside a July sheet is unambiguous. */}
      <span className="text-[0.7em] text-faint [unicode-bidi:isolate]">
        {monthName(month, year)} {year}
      </span>
    </div>
  )
}
