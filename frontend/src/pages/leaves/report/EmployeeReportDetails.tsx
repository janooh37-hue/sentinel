/**
 * EmployeeReportDetails — the report's first sheet when it is scoped to one
 * employee: who they are, whether they are on leave now, their days per leave
 * type in the period, and every leave in the period. The filed General Book
 * carries the same content through `reportBodyHtml`.
 *
 * "On leave now / last leave" reads ALL fetched rows (as the profile strip
 * does); the totals and the list read the report's scoped rows and period.
 */
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api, type LeaveListItem } from '@/lib/api'
import { cn } from '@/lib/utils'

import { addDays, dateLocale, fmtDayMonthYear } from './fmt'
import { kindMeta } from './kinds'
import { employeeProfile, kindAggregates, periodLeaves, type DayWindow } from './reportData'
import { employeeFacts, kindLabel, leaveCells } from './reportDocument'
import { CELL, NAVY } from './ReportPaper'

interface EmployeeReportDetailsProps {
  employeeId: string
  /** Every fetched row: the current/last leave ignores the report's filters. */
  all: LeaveListItem[]
  /** The report's scoped rows. */
  rows: LeaveListItem[]
  window: DayWindow
  today: string
}

/** Leave-list columns after `#`: days end-aligned, dates kept on one line. */
const LEAVE_CELL = ['', 'whitespace-nowrap', 'whitespace-nowrap', 'text-end tabular-nums', '', 'whitespace-nowrap']

export function EmployeeReportDetails({
  employeeId,
  all,
  rows,
  window,
  today,
}: EmployeeReportDetailsProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const locale = dateLocale(lang)
  const { data: emp } = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => api.getEmployee(employeeId),
  })

  const profile = employeeProfile(all, employeeId, today)
  const kinds = kindAggregates(rows, window)
  const leaves = periodLeaves(rows, window)
  const date = (iso: string | null | undefined): React.ReactNode =>
    iso ? <bdi className="tabular-nums">{fmtDayMonthYear(iso, locale)}</bdi> : '—'
  const leaveLine = (r: LeaveListItem): React.ReactNode => (
    <>
      {kindLabel(t, lang, r.leave_type)} · {date(r.start_date)} – {date(r.end_date)}
    </>
  )

  return (
    <>
      <dl className="grid grid-cols-3 gap-x-6 gap-y-2 border border-neutral-400 p-3">
        {employeeFacts(t, lang, locale, employeeId, emp).map(([label, value], i) => (
          <div key={label} className="min-w-0">
            <dt className="text-neutral-600">{label}</dt>
            <dd className="font-bold">
              {/* The first fact is the G-number, set like the month sheets' ID column. */}
              {i === 0 ? (
                <bdi dir="ltr" className="font-mono">
                  {value}
                </bdi>
              ) : (
                <bdi>{value}</bdi>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 grid grid-cols-2 gap-6 break-inside-avoid">
        <div>
          <p className="font-bold" style={{ color: NAVY }}>
            {t('leaves.report.profileCurrent')}
          </p>
          {profile.current ? (
            <p>
              {leaveLine(profile.current)}
              <br />
              {t('leaves.report.expectedReturn')}: {date(addDays(profile.current.end_date, 1))}
            </p>
          ) : (
            <p>{t('leaves.report.profileNotOnLeave')}</p>
          )}
        </div>
        <div>
          <p className="font-bold" style={{ color: NAVY }}>
            {t('leaves.report.profileLast')}
          </p>
          {profile.last ? (
            <p>
              {leaveLine(profile.last)}
              <br />
              {t('leaves.report.colReturn')}: {date(profile.last.return_date)}
            </p>
          ) : (
            <p>{t('leaves.report.profileNone')}</p>
          )}
        </div>
      </div>

      <h2 className="mb-2 mt-6 text-[11px] font-bold" style={{ color: NAVY }}>
        {t('leaves.report.daysByKind')}
      </h2>
      <table className="w-full border-collapse break-inside-avoid">
        <thead>
          <tr className="bg-neutral-100">
            <th className={CELL}>{t('leaves.report.colKind')}</th>
            <th className={cn(CELL, 'w-24 text-end')}>{t('leaves.report.colRecords')}</th>
            <th className={cn(CELL, 'w-24 text-end')}>{t('leaves.report.colTotalDays')}</th>
          </tr>
        </thead>
        <tbody>
          {kinds.map((k) => (
            <tr key={k.kind}>
              <td className={CELL}>{t(kindMeta(k.kind).i18nKey)}</td>
              <td className={cn(CELL, 'text-end tabular-nums')}>{k.records}</td>
              <td className={cn(CELL, 'text-end font-bold tabular-nums')}>{k.days}</td>
            </tr>
          ))}
          <tr className="bg-neutral-50 font-bold">
            <td className={CELL} colSpan={2}>
              {t('leaves.report.total')}
            </td>
            <td className={cn(CELL, 'text-end tabular-nums')}>{kinds.reduce((s, k) => s + k.days, 0)}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mb-2 mt-6 text-[11px] font-bold" style={{ color: NAVY }}>
        {t('leaves.report.leavesInPeriod')}
      </h2>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-neutral-100">
            <th className={cn(CELL, 'w-8 text-center')}>#</th>
            <th className={CELL}>{t('leaves.report.colKind')}</th>
            <th className={CELL}>{t('leaves.report.colFrom')}</th>
            <th className={CELL}>{t('leaves.report.colTo')}</th>
            <th className={cn(CELL, 'text-end')}>{t('leaves.report.colDays')}</th>
            <th className={CELL}>{t('leaves.columns.status')}</th>
            <th className={CELL}>{t('leaves.report.colReturn')}</th>
          </tr>
        </thead>
        <tbody>
          {leaves.map((r, i) => (
            <tr key={r.id} className="break-inside-avoid">
              <td className={cn(CELL, 'text-center tabular-nums')}>{i + 1}</td>
              {leaveCells(t, lang, locale, r).map((c, j) => (
                <td key={j} className={cn(CELL, LEAVE_CELL[j])}>
                  <bdi>{c}</bdi>
                </td>
              ))}
            </tr>
          ))}
          {leaves.length === 0 && (
            <tr>
              <td className={cn(CELL, 'text-center text-neutral-600')} colSpan={7}>
                {t('leaves.report.emptyReport')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  )
}
