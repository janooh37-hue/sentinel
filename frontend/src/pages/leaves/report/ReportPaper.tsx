/**
 * ReportPaper — the leave report as an A4 document, in the UI language.
 *
 * Two hosts: the Report view shows it on screen as a 1:1 preview of the paper
 * (`onScreen`), and the Register view mounts it paper-only while the browser
 * prints (Ctrl+P). Either way `print-register` is the named @page with a 12mm
 * margin, and everything around it carries `data-print-hide`, so this is the
 * only thing that reaches the printer.
 *
 * The sheet pins its own ink and paper (not theme tokens): a dark-theme
 * operator still previews and prints dark text on a light sheet.
 */
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import type { LeaveListItem } from '@/lib/api'
import { splitBilingual } from '@/lib/bilingualValue'
import { cn } from '@/lib/utils'

import { displayState } from '../lifecycle'
import { leaveEmployeeName } from '../leaveEmployeeName'
import { PeriodRun } from './PeriodRun'
import { dateLocale, fmtDayMonthYear, fmtMonthYear } from './fmt'
import { kindMeta } from './kinds'
import {
  employeeTotals, groupRows, tableTotals, REGISTER_COLUMNS,
  type GroupMode, type SortSpec,
} from './reportData'

const CELL = 'border border-neutral-400 px-1.5 py-1 text-start align-middle'
const HEAD_ROW = 'bg-neutral-100'

interface ReportPaperProps {
  rows: LeaveListItem[]
  group: GroupMode
  sort: SortSpec
  today: string
  title: string
  /** Already-translated scope lines (period, types, staff, …); empty = everything. */
  facts: string[]
  employeeTotals?: boolean
  signatures?: boolean
  /** Also show the sheet on screen (the Report view's preview). */
  onScreen?: boolean
}

export function ReportPaper({
  rows,
  group,
  sort,
  today,
  title,
  facts,
  employeeTotals: showEmployeeTotals = false,
  signatures = false,
  onScreen = false,
}: ReportPaperProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = dateLocale(i18n.language)
  const groups = groupRows(rows, group, sort)
  const totals = tableTotals(rows)
  const sortColumn = REGISTER_COLUMNS.find((c) => c.key === sort.key)
  const colCount = REGISTER_COLUMNS.length + 1

  return (
    <div
      className={cn(
        'print-register text-[10px] text-[#1c1f24]',
        onScreen
          ? 'mx-auto w-full max-w-[210mm] bg-[#fffdf8] px-[12mm] py-[12mm] shadow-sm ring-1 ring-border print:max-w-none print:p-0 print:shadow-none print:ring-0'
          : 'hidden print:block',
      )}
    >
      <div className="mb-2 flex items-center gap-3 border-b border-[#1c1f24] pb-1.5">
        <img src="/brand/gssg-logo.png" alt="" className="h-10 w-auto" />
        <div>
          <h1 className="text-base font-bold">{title}</h1>
          <p>{facts.length > 0 ? facts.join(' · ') : t('leaves.report.printAll')}</p>
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
          <tr className={HEAD_ROW}>
            <th className={cn(CELL, 'w-6 text-center')}>#</th>
            {REGISTER_COLUMNS.map((c) => (
              <th key={c.key} className={CELL}>
                {t(c.labelKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className={cn(CELL, 'py-3 text-center text-neutral-600')} colSpan={colCount}>
                {t('leaves.report.emptyReport')}
              </td>
            </tr>
          )}
          {rows.length > 0 &&
            groups.map((g) => (
              <Fragment key={g.key}>
                {group !== 'none' && (
                  <tr className="break-inside-avoid bg-neutral-50 font-semibold">
                    <td className={CELL} colSpan={colCount}>
                      {g.kind !== null
                        ? t(kindMeta(g.kind).i18nKey)
                        : g.month !== null
                          ? fmtMonthYear(g.month, locale)
                          : leaveEmployeeName(g.rows[0], i18n.language)}
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

      {showEmployeeTotals && rows.length > 0 && (
        <section className="mt-4 break-inside-avoid">
          <h2 className="mb-1 text-[11px] font-bold">{t('leaves.report.totalsByEmployee')}</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr className={HEAD_ROW}>
                <th className={cn(CELL, 'w-6 text-center')}>#</th>
                <th className={CELL}>{t('leaves.columns.employee')}</th>
                <th className={cn(CELL, 'w-20 text-end')}>{t('leaves.report.colRecords')}</th>
                <th className={cn(CELL, 'w-20 text-end')}>{t('leaves.report.colDays')}</th>
              </tr>
            </thead>
            <tbody>
              {employeeTotals(rows).map((e, i) => (
                <tr key={e.row.employee_id} className="break-inside-avoid">
                  <td className={cn(CELL, 'text-center tabular-nums')}>{i + 1}</td>
                  <td className={CELL}>
                    {leaveEmployeeName(e.row, i18n.language)}{' '}
                    <bdi dir="ltr" className="font-mono text-neutral-600">
                      {e.row.employee_id}
                    </bdi>
                  </td>
                  <td className={cn(CELL, 'text-end tabular-nums')}>{e.records}</td>
                  <td className={cn(CELL, 'text-end font-bold tabular-nums')}>{e.days}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className={CELL} colSpan={2}>
                  {t('leaves.report.totalRow')}
                </td>
                <td className={cn(CELL, 'text-end tabular-nums')}>{totals.records}</td>
                <td className={cn(CELL, 'text-end tabular-nums')}>{totals.days}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {signatures && (
        <section className="mt-8 grid break-inside-avoid grid-cols-2 gap-10">
          {(['preparedBy', 'approvedBy'] as const).map((role) => (
            <div key={role} className="flex flex-col gap-3">
              <p className="font-bold">{t(`leaves.report.${role}`)}</p>
              {(['sigName', 'sigSignature', 'sigDate'] as const).map((line) => (
                <p key={line} className="flex items-end gap-2">
                  <span className="shrink-0 text-neutral-600">{t(`leaves.report.${line}`)}</span>
                  <span className="h-4 flex-1 border-b border-neutral-500" />
                </p>
              ))}
            </div>
          ))}
        </section>
      )}

      <p className="mt-6 text-[9px] text-neutral-600">
        {t('leaves.report.printedOn', { date: fmtDayMonthYear(today, locale) })}
      </p>
    </div>
  )
}
