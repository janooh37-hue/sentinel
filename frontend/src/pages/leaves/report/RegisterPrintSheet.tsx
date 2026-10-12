/**
 * RegisterPrintSheet — the register as paper: exactly the rows on screen (every
 * active filter, same sort, same grouping), in the UI language. Mounted only
 * while printing (LeavesReport flushes it in, prints, unmounts) and revealed by
 * the global print stylesheet: `print-register` is the named @page with a 12mm
 * margin, and the screen report beside it carries `data-print-hide`.
 */
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import type { LeaveListItem } from '@/lib/api'
import { splitBilingual } from '@/lib/bilingualValue'
import { cn } from '@/lib/utils'

import { displayState } from '../lifecycle'
import { leaveEmployeeName } from '../leaveEmployeeName'
import { PeriodRun } from './PeriodRun'
import { dateLocale, fmtMonthYear } from './fmt'
import { kindMeta } from './kinds'
import { groupRows, tableTotals, REGISTER_COLUMNS, type GroupMode, type SortSpec } from './reportData'

const CELL = 'border border-neutral-400 px-1.5 py-1 text-start align-middle'

interface RegisterPrintSheetProps {
  rows: LeaveListItem[]
  group: GroupMode
  sort: SortSpec
  year: number
  today: string
  /** Already-translated labels of the active filters; empty = everything. */
  filters: string[]
}

export function RegisterPrintSheet({
  rows,
  group,
  sort,
  year,
  today,
  filters,
}: RegisterPrintSheetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = dateLocale(i18n.language)
  const groups = groupRows(rows, group, sort)
  const totals = tableTotals(rows)
  const sortColumn = REGISTER_COLUMNS.find((c) => c.key === sort.key)

  return (
    <div className="print-register hidden bg-white text-[10px] text-black print:block">
      <div className="mb-2 flex items-center gap-3 border-b border-black pb-1.5">
        <img src="/brand/gssg-logo.png" alt="" className="h-10 w-auto" />
        <div>
          <h1 className="text-base font-bold">{t('leaves.report.printTitle', { year })}</h1>
          <p>{filters.length > 0 ? filters.join(' · ') : t('leaves.report.printAll')}</p>
          {sortColumn && (
            <p className="text-neutral-600">
              {t('leaves.report.printSort', {
                column: t(sortColumn.labelKey),
                arrow: sort.dir === 'asc' ? '▲' : '▼',
              })}
            </p>
          )}
        </div>
      </div>

      <table className="w-full border-collapse">
        <thead className="[display:table-header-group]">
          <tr className="bg-neutral-100">
            <th className={cn(CELL, 'w-6 text-center')}>#</th>
            {REGISTER_COLUMNS.map((c) => (
              <th key={c.key} className={CELL}>
                {t(c.labelKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.key}>
              {group !== 'none' && (
                <tr className="break-inside-avoid bg-neutral-50 font-semibold">
                  <td className={CELL} colSpan={REGISTER_COLUMNS.length + 1}>
                    {g.kind !== null ? t(kindMeta(g.kind).i18nKey) : fmtMonthYear(g.month ?? '', locale)}
                    {' · '}
                    {t('leaves.report.totalsRecords', { count: g.rows.length })}
                    {' · '}
                    {t('leaves.report.totalsDays', { count: g.days })}
                  </td>
                </tr>
              )}
              {g.rows.map((row, i) => (
                <tr key={row.id} className="break-inside-avoid">
                  <td className={cn(CELL, 'text-center tabular-nums')}>{i + 1}</td>
                  <td className={CELL}>
                    {leaveEmployeeName(row, i18n.language)}{' '}
                    <bdi dir="ltr" className="font-mono text-neutral-600">
                      {row.employee_id}
                    </bdi>
                  </td>
                  <td className={CELL}>
                    {t(`leaves.type.${row.leave_type}`, {
                      defaultValue: splitBilingual(row.leave_type, i18n.language),
                    })}
                  </td>
                  <td className={CELL}>
                    <PeriodRun start={row.start_date} end={row.end_date} locale={locale} />
                  </td>
                  <td className={cn(CELL, 'text-end font-bold tabular-nums')}>{row.days}</td>
                  <td className={CELL}>
                    {t(
                      `leaves.display.${displayState(row.leave_type, row.status, row.end_date, today, row.has_certificate)}`,
                    )}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>

      <p className="mt-1.5 font-mono tabular-nums">
        {[
          t('leaves.report.totalsRecords', { count: totals.records }),
          t('leaves.report.totalsDays', { count: totals.days }),
          t('leaves.report.totalsEmployees', { count: totals.employees }),
        ].join(' · ')}
      </p>
    </div>
  )
}
