import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { usePrintFilename } from '@/hooks/usePrintFilename'
import type { CompanyStats, CompanyStatsTotals } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'

import { companyDisplayName, formatStatsDate, formatStatsNumber, formatStatsPercent, formatStatsPermitHours, formatStatsQuantity } from './companyStatsFormat'
import { deltaPercent, DISCIPLINE_METRICS, disciplineValue, TREND_METRICS, type CountUnit, type RankingSort } from './companyStatsModel'
import { StatsPeriodLabel } from './PeriodSummary'
import { trendValue } from './trendModel'

const LEAVE_COLUMNS = ['annual', 'administrative', 'sick', 'exit_permits', 'duty', 'national_service'] as const

interface PrintRow {
  key: string
  label: ReactNode
  values: ReactNode[]
}

function PrintTable({ title, columns, rows, empty }: { title: string; columns: string[]; rows: PrintRow[]; empty?: string }) {
  return (
    <section className="mt-[4mm]">
      <h2 className="mb-[1.5mm] break-after-avoid text-[11pt] font-bold">{title}</h2>
      {rows.length === 0 ? <p className="text-muted-foreground">{empty}</p> : (
        <table aria-label={title} className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              {columns.map((label, index) => (
                <th key={label} scope="col" className={`border-y px-1.5 py-1 ${index === 0 ? 'w-1/5 text-start' : 'text-end'}`}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, values }) => (
              <tr key={key}>
                <th scope="row" className="border-b px-1.5 py-1 text-start font-semibold [overflow-wrap:anywhere]">{label}</th>
                {values.map((value, index) => (
                  <td key={columns[index + 1]} className="border-b px-1.5 py-1 text-end [overflow-wrap:anywhere]">
                    <bdi>{value}</bdi>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export function CompanyStatsPrintSheet({ data, unit, sort }: { data: CompanyStats; unit: CountUnit; sort: RankingSort }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const language = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const scope = data.duty_unit === null ? t('companyStats.filters.all') : companyDisplayName(data.duty_unit, t)
  const title = t('companyStats.title')
  const { period, previous_comparable: comparable } = data
  const { current, previous } = data.summary
  const filenameScope = scope.replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]+/gu, ' ').trim()
  usePrintFilename([title, filenameScope, period.from_date, period.to_date].filter(Boolean).join('_'))

  const metricLabels = DISCIPLINE_METRICS.map((metric) => t(`companyStats.metric.${metric}`))
  const leaveLabels = LEAVE_COLUMNS.map((kind) => t(`companyStats.leaves.${kind}`))
  const changeCells = (value: number, before: number, display: ReactNode = formatStatsNumber(value)): ReactNode[] => {
    if (!comparable) return [display]
    const change = deltaPercent(value, before)
    return [display, formatStatsNumber(before), change === null ? '—' : `${change > 0 ? '+' : ''}${formatStatsPercent(change)}`]
  }
  const permitNote = (totals: CompanyStatsTotals): ReactNode => {
    const permits = totals.leaves.exit_permits
    const hours = formatStatsPermitHours(permits, t)
    return (
      <>
        <bdi>{formatStatsQuantity('permit', permits.count, t)}</bdi>
        {hours !== null && <> · <bdi>{hours}</bdi></>}
      </>
    )
  }
  const other = current.leaves.other
  const summaryRows: PrintRow[] = [
    ...DISCIPLINE_METRICS.map((metric, index) => ({
      key: metric,
      label: metricLabels[index],
      values: changeCells(disciplineValue(current, metric, unit), disciplineValue(previous, metric, unit)),
    })),
    ...LEAVE_COLUMNS.map((kind, index) => ({
      key: kind,
      label: leaveLabels[index],
      values: kind === 'exit_permits'
        ? changeCells(current.leaves.exit_permits.count, previous.leaves.exit_permits.count, permitNote(current))
        : changeCells(current.leaves[kind][unit], previous.leaves[kind][unit]),
    })),
  ]
  const comparisonValues = (totals: CompanyStatsTotals): ReactNode[] => [
    ...LEAVE_COLUMNS.map((kind) => kind === 'exit_permits' ? permitNote(totals) : formatStatsNumber(totals.leaves[kind][unit])),
    ...DISCIPLINE_METRICS.map((metric) => formatStatsNumber(disciplineValue(totals, metric, unit))),
    totals.absence_rate === null ? '—' : formatStatsPercent(totals.absence_rate, 1),
  ]
  const comparisonRows: PrintRow[] = data.companies.map((row) => ({
    key: `company:${row.key}`,
    label: (
      <>
        <bdi>{companyDisplayName(row.key, t)}</bdi>
        {row.small_sample ? <span className="block font-normal text-muted-foreground">{t('companyStats.status.smallSample')}</span>
          : row.status.overall !== null && <span className="block font-normal text-muted-foreground">{t(`companyStats.status.${row.status.overall}`)}</span>}
      </>
    ),
    values: comparisonValues(row.totals),
  }))
  comparisonRows.push({ key: 'report-total', label: t('companyStats.comparison.total'), values: comparisonValues(data.overall) })

  const employees = new Map(data.ranking.rows.map((row) => [row.employee_id, row]))
  const rankingRows: PrintRow[] = []
  for (const key of data.ranking.order[sort]) {
    const row = employees.get(key)
    if (!row) continue
    const badge = row.small_sample ? t('companyStats.status.smallSample') : row.tier ? t(`companyStats.tier.${row.tier}`) : null
    rankingRows.push({
      key,
      label: <bdi>{pickEmployeeName(row, language)}</bdi>,
      values: [
        companyDisplayName(row.duty_unit, t),
        formatStatsNumber(unit === 'days' || sort === 'absence' ? row.absence_days : row.absence_episodes),
        formatStatsNumber(row.single_punch),
        formatStatsNumber(row.late_count),
        formatStatsNumber(row.sick_days),
        formatStatsNumber(unit === 'days' ? row.leave_days : row.leave_count),
        <><bdi dir="ltr">{formatStatsNumber(row.score)}</bdi>{badge !== null && <span className="block text-muted-foreground">{badge}</span>}</>,
      ],
    })
  }

  return (
    <article className="print-company-stats hidden text-[9pt] leading-snug text-black tabular-nums print:block" lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'} aria-label={title}>
      <div className="flex break-inside-avoid items-center gap-[3mm] border-b pb-[2mm]">
        <img src="/brand/gssg-logo.png" alt="" className="size-[14mm] shrink-0 object-contain" />
        <div className="min-w-0">
          <h1 className="text-[15pt] font-bold">{title}</h1>
          <p className="text-[11pt] font-semibold"><bdi>{scope}</bdi></p>
          <p><StatsPeriodLabel period={period} /></p>
          <p className="text-muted-foreground">{t(unit === 'days' ? 'companyStats.unit.byDays' : 'companyStats.unit.byCount')}</p>
        </div>
      </div>
      <p className="mt-[2mm] text-muted-foreground">
        {comparable ? <>{t('companyStats.summary.previousPeriod')} <StatsPeriodLabel period={data.previous_period} /></> : t('companyStats.coverage.notEnough')}
      </p>
      <PrintTable
        title={t('companyStats.summary.title')}
        columns={[
          t('companyStats.print.metric'), t('companyStats.print.current'),
          ...(comparable ? [t('companyStats.print.previous'), t('companyStats.print.change')] : []),
        ]}
        rows={summaryRows}
      />
      <p className="mt-[1mm] text-muted-foreground">
        {t('companyStats.leaves.other')}: <bdi>{formatStatsQuantity('day', other.days, t)}</bdi> · <bdi>{formatStatsQuantity('record', other.count, t)}</bdi>
      </p>
      <PrintTable
        title={t('companyStats.comparison.title')}
        columns={[t('companyStats.filters.company'), ...leaveLabels, ...metricLabels, t('companyStats.companies.rate')]}
        rows={comparisonRows}
      />
      <PrintTable
        title={t('companyStats.trend.title')}
        columns={[t('companyStats.filters.period'), ...TREND_METRICS.map((metric) => t(`companyStats.metric.${metric}`))]}
        rows={data.series.map((bucket) => ({
          key: bucket.start,
          label: <StatsPeriodLabel period={{ from_date: bucket.start, to_date: bucket.end, clamped: false }} />,
          values: TREND_METRICS.map((metric) => formatStatsNumber(trendValue(bucket, metric, unit))),
        }))}
        empty={t('companyStats.states.empty')}
      />
      <PrintTable
        title={t('companyStats.leaves.national_service')}
        columns={[t('companyStats.ranking.employee'), t('companyStats.filters.company'), t('companyStats.print.returnDate'), t('companyStats.print.daysRemaining')]}
        empty={t('companyStats.nationalService.empty')}
        rows={data.national_service.enrolled.map((row) => ({
          key: row.employee_id,
          label: <bdi>{pickEmployeeName(row, language)}</bdi>,
          values: [companyDisplayName(row.duty_unit, t), formatStatsDate(row.return_date, language), formatStatsNumber(row.days_remaining)],
        }))}
      />
      <p className="mt-[1mm] text-muted-foreground">
        {t('companyStats.nationalService.absenceDays')}: <bdi dir="ltr">{formatStatsNumber(data.national_service.absence_days)}</bdi>
      </p>
      <PrintTable
        title={t('companyStats.ranking.title')}
        columns={[
          t('companyStats.ranking.employee'), t('companyStats.filters.company'), ...metricLabels,
          t('companyStats.ranking.sickDays'), t('companyStats.ranking.leaves'), t('companyStats.ranking.score'),
        ]}
        rows={rankingRows}
        empty={t('companyStats.ranking.empty')}
      />
    </article>
  )
}
