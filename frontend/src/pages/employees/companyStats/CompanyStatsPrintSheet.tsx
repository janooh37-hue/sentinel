import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { usePrintFilename } from '@/hooks/usePrintFilename'
import type { CompanyStats, CompanyStatsTotals } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'

import { companyDisplayName, formatStatsDate, formatStatsDuration, formatStatsHours, formatStatsNumber, formatStatsPercent, formatStatsPermitHours, formatStatsQuantity } from './companyStatsFormat'
import { deltaPercent, DISCIPLINE_METRICS, disciplineValue, LEAVE_COLUMNS, rankingAbsenceField, rankingBadge, TREND_METRICS, type CountUnit, type RankingSort } from './companyStatsModel'
import { NewDeltaChip, StatsPeriodLabel } from './PeriodSummary'
import { trendValue } from './trendModel'

type PrintValue = string | ReactElement

interface PrintRow {
  key: string
  label: ReactNode
  values: PrintValue[]
}

function PrintTable({ title, columns, rows, empty, columnWidths }: {
  title: string
  columns: string[]
  rows: PrintRow[]
  empty?: string
  columnWidths?: Readonly<Record<number, string>>
}) {
  return (
    <section className="mt-[4mm]">
      <h2 className="mb-[1.5mm] break-after-avoid text-[11pt] font-bold">{title}</h2>
      {rows.length === 0 ? <p className="text-muted-foreground">{empty}</p> : (
        <table aria-label={title} className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              {columns.map((label, index) => (
                <th
                  key={label}
                  scope="col"
                  className={`border-y px-1.5 py-1 [overflow-wrap:normal] [word-break:normal] ${index === 0 ? 'text-start' : '[direction:ltr] text-end'}`}
                  style={{ inlineSize: columnWidths?.[index] ?? (index === 0 ? '20%' : undefined) }}
                >
                  <bdi>{label}</bdi>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, values }) => (
              <tr key={key}>
                <th scope="row" className="border-b px-1.5 py-1 text-start font-semibold [overflow-wrap:anywhere]">{label}</th>
                {values.map((value, index) => (
                  <td key={columns[index + 1]} className="border-b px-1.5 py-1 [direction:ltr] text-end [overflow-wrap:anywhere]">
                    {typeof value === 'string' ? <bdi>{value}</bdi> : value}
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
  const changeCells = (
    value: number | null,
    before: number | null,
    display: PrintValue = value === null ? '—' : formatStatsNumber(value),
    previousDisplay = before === null ? '—' : formatStatsNumber(before),
  ): PrintValue[] => {
    if (!comparable) return [display]
    const change = deltaPercent(value, before)
    const delta = change === 'new' ? <NewDeltaChip /> : change === null ? '—' : `${change > 0 ? '+' : ''}${formatStatsPercent(change)}`
    return [display, previousDisplay, delta]
  }
  const permitNote = (totals: CompanyStatsTotals): PrintValue => {
    const permits = totals.leaves.exit_permits
    if (permits.count === 0) return formatStatsNumber(0)
    const hours = formatStatsPermitHours(permits, t)
    return (
      <bdi>
        <span className="whitespace-nowrap">{formatStatsQuantity('permit', permits.count, t)}{hours !== null && ' ·'}</span>
        {hours !== null && <> {hours}</>}
      </bdi>
    )
  }
  const other = current.leaves.other
  const currentHours = current.leaves.exit_permits.hours
  const previousHours = previous.leaves.exit_permits.hours
  const summaryRows: PrintRow[] = [
    ...DISCIPLINE_METRICS.map((metric, index) => ({
      key: metric,
      label: metricLabels[index],
      values: changeCells(disciplineValue(current, metric, unit), disciplineValue(previous, metric, unit)),
    })),
    {
      key: 'late-duration',
      label: t('companyStats.summary.lateDuration'),
      values: changeCells(
        current.late.minutes, previous.late.minutes,
        formatStatsDuration(current.late.minutes, t), formatStatsDuration(previous.late.minutes, t),
      ),
    },
  ]
  for (const [index, kind] of LEAVE_COLUMNS.entries()) {
    summaryRows.push({
      key: kind,
      label: leaveLabels[index],
      values: kind === 'exit_permits'
        ? changeCells(current.leaves.exit_permits.count, previous.leaves.exit_permits.count, permitNote(current))
        : changeCells(current.leaves[kind][unit], previous.leaves[kind][unit]),
    })
    if (kind === 'exit_permits' && comparable && (currentHours !== null || previousHours !== null)) {
      summaryRows.push({
        key: 'exit-permit-duration',
        label: t('companyStats.leaves.exitPermitDuration'),
        values: changeCells(
          currentHours, previousHours,
          currentHours === null ? '—' : formatStatsHours(currentHours, t),
          previousHours === null ? '—' : formatStatsHours(previousHours, t),
        ),
      })
    }
  }
  const comparisonValues = (totals: CompanyStatsTotals): PrintValue[] => [
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

  const absenceField = rankingAbsenceField(unit, sort)
  const showAbsenceUnit = unit === 'count' && absenceField === 'absence_days'
  const rankingMetricLabels = showAbsenceUnit
    ? metricLabels.map((label, index) => DISCIPLINE_METRICS[index] === 'absence' ? t('companyStats.ranking.absenceDays') : label)
    : metricLabels
  const employees = new Map(data.ranking.rows.map((row) => [row.employee_id, row]))
  const rankingRows: PrintRow[] = []
  for (const key of data.ranking.order[sort]) {
    const row = employees.get(key)
    if (!row) continue
    const { labelKey } = rankingBadge(row)
    const absence = row[absenceField]
    rankingRows.push({
      key,
      label: <bdi>{pickEmployeeName(row, language)}</bdi>,
      values: [
        companyDisplayName(row.duty_unit, t),
        showAbsenceUnit && absence > 0 ? (
          <><bdi dir="ltr">{formatStatsNumber(absence)}</bdi>{' · '}<bdi>{formatStatsQuantity('episode', row.absence_episodes, t)}</bdi></>
        ) : formatStatsNumber(absence),
        formatStatsNumber(row.single_punch),
        formatStatsNumber(row.late_count),
        formatStatsNumber(row.sick_days),
        formatStatsNumber(unit === 'days' ? row.leave_days : row.leave_count),
        labelKey === null ? formatStatsNumber(row.score) : (
          <>
            <bdi dir="ltr">{formatStatsNumber(row.score)}</bdi>
            <span className="block text-muted-foreground">{t(labelKey)}</span>
          </>
        ),
      ],
    })
  }

  return (
    <article className="print-company-stats hidden text-[9pt] leading-snug text-black print:block" lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'} aria-label={title}>
      <div className="flex break-inside-avoid items-center gap-5 border-b-[1.5px] pb-[2mm]" style={{ borderColor: 'var(--primary)' }}>
        <img src="/brand/gssg-wordmark.png" alt="GSSG" className="h-[9mm] w-auto shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="whitespace-nowrap text-[15pt] font-bold">{title}</h1>
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
        {t('companyStats.leaves.other')}: {other.days === 0 && other.count === 0 ? <bdi dir="ltr">{formatStatsNumber(0)}</bdi> : (
          <><bdi>{formatStatsQuantity('day', other.days, t)}</bdi> · <bdi>{formatStatsQuantity('record', other.count, t)}</bdi></>
        )}
      </p>
      <PrintTable
        title={t('companyStats.comparison.title')}
        columns={[t('companyStats.filters.company'), ...leaveLabels, ...metricLabels, t('companyStats.companies.rate')]}
        columnWidths={{
          0: '15%',
          [LEAVE_COLUMNS.indexOf('administrative') + 1]: '28mm',
          [LEAVE_COLUMNS.indexOf('exit_permits') + 1]: '36mm',
        }}
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
          t('companyStats.ranking.employee'), t('companyStats.filters.company'), ...rankingMetricLabels,
          t('companyStats.ranking.sickDays'), t('companyStats.ranking.leaves'), t('companyStats.ranking.score'),
        ]}
        rows={rankingRows}
        empty={t('companyStats.ranking.empty')}
      />
    </article>
  )
}
