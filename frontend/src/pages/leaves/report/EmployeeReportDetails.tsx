/**
 * EmployeeReportDetails — the report's first sheet when it is scoped to one
 * employee: who they are, whether they are on leave now, their days per leave
 * type in the period, and every leave in the period.
 *
 * "On leave now / last leave" reads ALL fetched rows (as the profile strip
 * does); the totals and the list read the report's scoped rows and period.
 */
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api, type LeaveListItem } from '@/lib/api'
import { splitBilingual } from '@/lib/bilingualValue'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'

import { canonStatus } from '../lifecycle'
import { addDays, dateLocale, fmtDayMonthYear } from './fmt'
import { kindMeta } from './kinds'
import { employeeProfile, kindAggregates, periodLeaves, type DayWindow } from './reportData'
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

export function EmployeeReportDetails({
  employeeId,
  all,
  rows,
  window,
  today,
}: EmployeeReportDetailsProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = dateLocale(i18n.language)
  const ar = i18n.language.startsWith('ar')
  const { data: emp } = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => api.getEmployee(employeeId),
  })

  const profile = employeeProfile(all, employeeId, today)
  const kinds = kindAggregates(rows, window)
  const leaves = periodLeaves(rows, window)
  const date = (iso: string | null | undefined): React.ReactNode =>
    iso ? <bdi className="tabular-nums">{fmtDayMonthYear(iso, locale)}</bdi> : '—'
  const kindLabel = (raw: string): string =>
    t(`leaves.type.${raw}`, { defaultValue: splitBilingual(raw, i18n.language) })

  const facts: [string, React.ReactNode][] = [
    [t('employees.fields.id'), <bdi dir="ltr" className="font-mono">{employeeId}</bdi>],
    [t('leaves.report.colName'), emp ? pickEmployeeName(emp, i18n.language) : '—'],
    [t('employees.fields.position'), (ar ? emp?.position_ar || emp?.position : emp?.position) || '—'],
    [t('leaves.report.optCompany'), emp?.duty_unit?.trim() || t('dutyLocations.unassigned')],
    [t('employees.fields.status'), emp ? t(`employees.status.${emp.status}`) : '—'],
    [t('employees.fields.doj'), date(emp?.doj)],
  ]

  return (
    <>
      <dl className="grid grid-cols-3 gap-x-6 gap-y-2 border border-neutral-400 p-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-neutral-600">{label}</dt>
            <dd className="font-bold">{value}</dd>
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
              {kindLabel(profile.current.leave_type)} · {date(profile.current.start_date)} –{' '}
              {date(profile.current.end_date)}
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
              {kindLabel(profile.last.leave_type)} · {date(profile.last.start_date)} –{' '}
              {date(profile.last.end_date)}
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
              <td className={CELL}>{kindLabel(r.leave_type)}</td>
              <td className={cn(CELL, 'whitespace-nowrap')}>{date(r.start_date)}</td>
              <td className={cn(CELL, 'whitespace-nowrap')}>{date(r.end_date)}</td>
              <td className={cn(CELL, 'text-end tabular-nums')}>{r.days}</td>
              <td className={CELL}>
                {t(`leaves.status.${canonStatus(r.status)}`, { defaultValue: canonStatus(r.status) })}
              </td>
              <td className={cn(CELL, 'whitespace-nowrap')}>{date(r.return_date)}</td>
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
