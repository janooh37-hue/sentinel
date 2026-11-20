import { useId } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'

import type { CompanyStats, CompanyStatsBucket } from '@/lib/api'

import {
  formatStatsDate, formatStatsDuration, formatStatsNumber, formatStatsPercent, formatStatsPermitHours, formatStatsQuantity,
} from './companyStatsFormat'
import { DISCIPLINE_METRICS, disciplineValue, deltaPercent, deltaTone, METRIC_TOKENS, type CountUnit, type DisciplineMetric } from './companyStatsModel'
import { isPartialBucket, trendValue } from './trendModel'

const LEAVE_TILES = ['annual', 'administrative', 'sick', 'exit_permits', 'duty', 'national_service'] as const
const DELTA_CLASS = {
  good: 'bg-success-soft text-success',
  bad: 'bg-accent-soft text-destructive-text',
  neutral: 'bg-surface-tinted text-muted-foreground',
}

type SummaryData = Pick<CompanyStats, 'summary' | 'previous_period' | 'previous_comparable' | 'series' | 'granularity'>

export function StatsPeriodLabel({ period }: { period: Pick<CompanyStats['period'], 'from_date' | 'to_date' | 'clamped'> }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { from_date: from, to_date: to, clamped } = period
  const end = formatStatsDate(to, i18n.language)
  if (from === to && !clamped) {
    return <time dateTime={to}><bdi>{end}</bdi></time>
  }
  const start = formatStatsDate(from, i18n.language, from.slice(0, 4) !== to.slice(0, 4))
  return (
    <Trans
      t={t}
      i18nKey={clamped ? 'companyStats.header.clampedRange' : 'companyStats.header.range'}
      components={{
        fromDate: <bdi className="whitespace-nowrap" />,
        toDate: <bdi className="whitespace-nowrap" />,
      }}
      values={{ from: start, to: end }}
    />
  )
}

function Delta({ current, previous, kind }: { current: number; previous: number; kind: 'discipline' | 'leave' }) {
  const { t } = useTranslation()
  const change = deltaPercent(current, previous)
  if (change === null) return null
  const tone = deltaTone(kind, change)
  const value = formatStatsPercent(Math.abs(change))
  const Icon = change > 0 ? ArrowUp : ArrowDown
  return (
    <span className={`inline-flex w-fit items-center gap-0.5 rounded-full px-1.5 text-xs font-semibold ${DELTA_CLASS[tone]}`}>
      {change === 0 ? t('companyStats.delta.noChange') : (
        <>
          <span className="sr-only">{t(change > 0 ? 'companyStats.delta.up' : 'companyStats.delta.down', { change: value })}</span>
          <Icon aria-hidden="true" className="size-3" />
          <bdi dir="ltr" aria-hidden="true" className="tabular-nums">{value}</bdi>
        </>
      )}
    </span>
  )
}

function Sparkline({ series, granularity, metric, unit }: {
  series: CompanyStatsBucket[]
  granularity: CompanyStats['granularity']
  metric: DisciplineMetric
  unit: CountUnit
}) {
  let max = 1
  let latestFull = -1
  const bars: { value: number; partial: boolean; start: string }[] = []
  for (const bucket of series) {
    const value = trendValue(bucket, metric, unit)
    const partial = isPartialBucket(bucket, granularity)
    max = Math.max(max, value)
    if (!partial) latestFull = bars.length
    bars.push({ value, partial, start: bucket.start })
  }
  const color = METRIC_TOKENS[metric]
  return (
    <div aria-hidden="true" className="mb-1 mt-auto flex h-6 w-full items-end gap-[3px]">
      {bars.map(({ start, value, partial }, index) => (
        <span
          key={start}
          className="flex-1 rounded-ss-[2px] rounded-se-[2px]"
          style={!value ? undefined : {
            height: `${value / max * 100}%`,
            background: partial
              ? `repeating-linear-gradient(135deg, ${color} 0 1px, transparent 1px 4px)`
              : index === latestFull ? color : `color-mix(in srgb, ${color} 74%, var(--surface))`,
            ...(partial ? { border: `1px solid ${color}` } : {}),
          }}
        />
      ))}
    </div>
  )
}

function MetricTitle({ label, color }: { label: string; color: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold sm:text-sm">
      <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

function Figure({ value, kind, large = false, note = null }: {
  value: number
  kind: 'day' | 'episode' | 'occurrence' | 'permit'
  large?: boolean
  note?: string | null
}) {
  const { t } = useTranslation()
  return (
    <p className="text-xs text-muted-foreground">
      <strong className={`font-bold leading-tight text-foreground ${large ? 'text-[1.4rem] sm:text-[1.6rem]' : 'text-xl'}`}>
        <bdi dir="ltr" className="tabular-nums">{formatStatsNumber(value)}</bdi>
      </strong>
      {value !== 0 && <> <span>{t(`companyStats.unit.figure.${kind}`, { count: value })}</span></>}
      {note !== null && <> · <bdi>{note}</bdi></>}
    </p>
  )
}

export function PeriodSummary({ data, unit }: { data: SummaryData; unit: CountUnit }): React.JSX.Element {
  const { t } = useTranslation()
  const heading = useId()
  const discipline = `${heading}-discipline`
  const leave = `${heading}-leave`
  const { current } = data.summary
  const previous = data.previous_comparable ? data.summary.previous : null
  const byDays = unit === 'days'
  const { other, exit_permits: permits } = current.leaves
  const details = {
    absence: byDays
      ? formatStatsQuantity('episode', current.absence.episodes, t)
      : formatStatsQuantity('day', current.absence.days, t),
    single_punch: t('companyStats.summary.unpairedHelp'),
    late: t('companyStats.summary.lateHelp', { time: formatStatsDuration(current.late.minutes, t) }),
  }
  return (
    <section aria-labelledby={heading} className="min-w-0">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={heading} className="flex items-baseline gap-2 text-base font-bold">
          <bdi dir="ltr" className="text-xs font-semibold text-muted-foreground" aria-hidden="true">01</bdi>
          {t('companyStats.summary.title')}
        </h2>
        <span className="self-center border-t" style={{ flex: '1 1 1rem' }} aria-hidden="true" />
        <p className="basis-full text-xs text-muted-foreground sm:basis-auto">
          {previous === null ? t('companyStats.coverage.notEnough') : (
            <>{t('companyStats.summary.previousPeriod')} <StatsPeriodLabel period={data.previous_period} /></>
          )}
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <article aria-labelledby={discipline} className="flex min-w-0 flex-col rounded-md border bg-surface p-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 id={discipline} className="text-sm font-bold">{t('companyStats.summary.discipline')}</h3>
            <p className="text-xs text-muted-foreground">{t('companyStats.summary.disciplineHelp')}</p>
          </div>
          <div className="mt-3 grid flex-1 grid-cols-3">
            {DISCIPLINE_METRICS.map((metric, index) => {
              const value = disciplineValue(current, metric, unit)
              return (
                <div
                  key={metric}
                  className="flex min-w-0 flex-col items-start gap-1 px-1.5 first:ps-0 last:pe-0 sm:px-3"
                  style={index === 0 ? undefined : { borderInlineStart: '1px solid var(--hairline)' }}
                >
                  <MetricTitle label={t(`companyStats.metric.${metric}`)} color={METRIC_TOKENS[metric]} />
                  <Figure value={value} kind={metric === 'absence' ? (byDays ? 'day' : 'episode') : 'occurrence'} large />
                  <div className="min-h-8 flex-1 text-xs text-muted-foreground">
                    {value !== 0 && <bdi>{details[metric]}</bdi>}
                  </div>
                  <Sparkline series={data.series} granularity={data.granularity} metric={metric} unit={unit} />
                  {previous !== null && (
                    <div className="min-h-5">
                      <Delta current={value} previous={disciplineValue(previous, metric, unit)} kind="discipline" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </article>
        <article aria-labelledby={leave} className="min-w-0 rounded-md border bg-surface p-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 id={leave} className="text-sm font-bold">{t('companyStats.summary.leaves')}</h3>
            <p className="text-xs text-muted-foreground">{t(byDays ? 'companyStats.unit.byDays' : 'companyStats.unit.byCount')}</p>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {LEAVE_TILES.map((key) => {
              const permit = key === 'exit_permits'
              const value = permit ? permits.count : current.leaves[key][unit]
              const before = previous === null ? null : permit ? previous.leaves.exit_permits.count : previous.leaves[key][unit]
              const isService = key === 'national_service'
              return (
                <div
                  key={key}
                  className="flex min-w-0 flex-col gap-0.5 rounded-sm px-2.5 py-2"
                  style={{ backgroundColor: `color-mix(in srgb, var(${isService ? '--smart-soft' : '--info-soft'}) 32%, var(--surface-raised))` }}
                >
                  <MetricTitle label={t(`companyStats.leaves.${key}`)} color={isService ? 'var(--smart)' : METRIC_TOKENS.sick} />
                  <Figure
                    value={value}
                    kind={permit ? 'permit' : byDays ? 'day' : 'occurrence'}
                    note={permit ? formatStatsPermitHours(permits, t) : null}
                  />
                  <div className="mt-auto flex flex-wrap items-end justify-between gap-1 text-xs text-muted-foreground">
                    {!permit && value > 0 && (
                      <bdi>{byDays ? formatStatsQuantity('occurrence', current.leaves[key].count, t) : formatStatsQuantity('day', current.leaves[key].days, t)}</bdi>
                    )}
                    {before !== null && <Delta current={value} previous={before} kind="leave" />}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-2 border-t pt-1.5 text-xs text-muted-foreground" style={{ borderColor: 'var(--hairline)' }}>
            {t('companyStats.leaves.other')}: {other.days > 0 || other.count > 0 ? (
              <><bdi>{formatStatsQuantity('day', other.days, t)}</bdi> · <bdi>{formatStatsQuantity('record', other.count, t)}</bdi></>
            ) : <bdi dir="ltr">0</bdi>}
          </p>
        </article>
      </div>
    </section>
  )
}
