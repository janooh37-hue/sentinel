import { useId, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import type { CompanyStats, CompanyStatsBucket } from '@/lib/api'

import { companyDisplayName, formatStatsDate, formatStatsNumber } from './companyStatsFormat'
import { METRIC_TOKENS, TREND_METRICS, type CountUnit, type TrendMetric } from './companyStatsModel'
import { fullBucketAverage, isPartialBucket, monthAxisLabels, trendValue, yAxisTop } from './trendModel'

interface Props {
  data: CompanyStats
  metric: TrendMetric
  unit: CountUnit
  onMetricChange(metric: TrendMetric): void
}

function markFill(kind: 'partial' | 'below' | 'solid', color: string): CSSProperties {
  if (kind === 'partial') {
    return { borderColor: color, backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 1px, transparent 1px 4px)` }
  }
  if (kind === 'below') {
    return { borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 25%, var(--surface))` }
  }
  return { borderColor: color, backgroundColor: color }
}

function BucketDetail({ bucket, partial, weekly, language, shortMonth }: {
  bucket: CompanyStatsBucket
  partial: boolean
  weekly: boolean
  language: string
  shortMonth: Intl.DateTimeFormat
}) {
  const { start, end } = bucket
  if (!partial) return weekly ? <time dateTime={start}>{formatStatsDate(start, language, false)}</time> : null
  if (start.slice(0, 7) !== end.slice(0, 7)) {
    return <><time dateTime={start}>{formatStatsDate(start, language, false)}</time> · <time dateTime={end}>{formatStatsDate(end, language, false)}</time></>
  }
  const first = Number(start.slice(-2))
  const last = Number(end.slice(-2))
  return <><bdi dir="ltr">{first}{last === first ? null : `–${last}`}</bdi>{weekly ? ` ${shortMonth.format(new Date(`${start}T00:00:00Z`))}` : null}</>
}

export function CompanyStatsTrend({ data, metric, unit, onMetricChange }: Props) {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const scrollRef = useRef<HTMLDivElement>(null)
  const language = i18n.language
  const direction = document.documentElement.dir || i18n.dir()
  const { granularity, series, period: { from_date, to_date } } = data
  const weekly = granularity === 'week'
  const labels = useMemo(() => weekly ? null : monthAxisLabels(series, language), [weekly, series, language])
  const shortMonth = useMemo(() => new Intl.DateTimeFormat(language, { month: 'short', timeZone: 'UTC' }), [language])
  const color = METRIC_TOKENS[metric]
  const metricLabel = t(`companyStats.metric.${metric}`)
  const grainLabel = t(weekly ? 'companyStats.trend.weekly' : 'companyStats.trend.monthly')
  const partialLabel = t(weekly ? 'companyStats.trend.partialWeek' : 'companyStats.trend.partialMonth')
  const countBy = metric === 'absence' && unit === 'count'
    ? t('companyStats.trend.episodes')
    : unit === 'days' && (metric === 'absence' || metric === 'sick')
      ? t('companyStats.unit.byDays')
      : t('companyStats.unit.byCount')

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (scroll) scroll.scrollLeft = (direction === 'rtl' ? -1 : 1) * scroll.scrollWidth
  }, [direction, from_date, to_date])

  let maximum = 0
  let hasPartial = false
  const buckets: { bucket: CompanyStatsBucket; value: number; partial: boolean }[] = []
  for (const bucket of series) {
    const value = trendValue(bucket, metric, unit)
    const partial = isPartialBucket(bucket, granularity)
    maximum = Math.max(maximum, value)
    hasPartial ||= partial
    buckets.push({ bucket, value, partial })
  }
  const mean = fullBucketAverage(buckets)
  const meanText = mean === null ? null : formatStatsNumber(mean, Number.isInteger(mean) ? 0 : 1)
  const top = yAxisTop(maximum)
  const ticks = [0, top / 2, top]
  const meanLane = mean === null ? 0 : 56
  const axisWidth = 39
  const gridStyle = { gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`, paddingInlineEnd: meanLane }
  const aboveStyle = markFill('solid', color)
  const belowStyle = markFill('below', color)
  const partialStyle = markFill('partial', color)
  const swatchClass = 'inline-block size-2.5 shrink-0 rounded-[2px] border'

  return (
    <figure aria-labelledby={titleId} className="min-w-0 self-stretch rounded-md border bg-surface p-3.5">
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div>
          <h3 id={titleId} className="flex items-center gap-1.5 text-sm font-semibold">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: color }} />
            {metricLabel}<span className="sr-only"> · {grainLabel}</span>
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {grainLabel} · {countBy} · <bdi dir="auto">{data.duty_unit === null ? t('companyStats.filters.all') : companyDisplayName(data.duty_unit, t)}</bdi>
          </p>
        </div>
        <div role="group" aria-label={t('companyStats.trend.metric')} className="inline-flex max-w-full flex-wrap items-stretch gap-0.5 rounded-md border bg-surface-tinted p-0.5">
          {TREND_METRICS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === metric}
              onClick={() => onMetricChange(option)}
              className="min-h-[44px] min-w-[44px] cursor-pointer rounded-sm px-2 text-xs text-muted-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-surface aria-pressed:font-semibold aria-pressed:text-primary-text md:min-h-8"
            >
              {t(`companyStats.metric.${option}`)}
            </button>
          ))}
        </div>
      </header>
      {buckets.length > 0 && (
        <>
          <ul className="mt-2 mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" role="list">
            <li className="inline-flex items-center gap-1">
              {mean === null ? t(weekly ? 'companyStats.trend.noFullWeeks' : 'companyStats.trend.noFullMonths') : (
                <>
                  <span aria-hidden="true" className="w-3.5 shrink-0 border-t border-dashed" style={{ borderColor: 'var(--text-muted)' }} />
                  {t(weekly ? 'companyStats.trend.fullWeeks' : 'companyStats.trend.fullMonths')}
                  <span className="sr-only">: {meanText}</span>
                </>
              )}
            </li>
            {mean !== null && (
              <>
                <li className="inline-flex items-center gap-1"><span aria-hidden="true" className={swatchClass} style={aboveStyle} />{metricLabel} · {t('companyStats.trend.atOrAbove')}</li>
                <li className="inline-flex items-center gap-1"><span aria-hidden="true" className={swatchClass} style={belowStyle} />{t('companyStats.trend.below')}</li>
              </>
            )}
            {hasPartial && <li className="inline-flex items-center gap-1"><span aria-hidden="true" className={swatchClass} style={partialStyle} />{partialLabel}</li>}
          </ul>
          <div
            ref={scrollRef}
            dir={direction}
            role="region"
            aria-labelledby={titleId}
            tabIndex={0}
            className="overflow-x-auto [scroll-padding-inline-start:39px] [scrollbar-color:var(--border-strong)_var(--surface)] [scrollbar-width:thin] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <div
              className="grid grid-cols-[32px_minmax(0,1fr)] grid-rows-[150px_auto] gap-x-[7px] pt-8 md:grid-rows-[168px_auto]"
              style={{ minWidth: axisWidth + meanLane + buckets.length * (weekly ? 46 : 56) }}
            >
              <div aria-hidden="true" className="sticky start-0 z-10 col-start-1 row-span-2 row-start-1 bg-surface text-end text-xs text-muted-foreground tabular-nums">
                <div className="relative h-[150px] md:h-[168px]">
                  {ticks.map((tick) => (
                    <bdi key={tick} dir="ltr" className="absolute end-0 translate-y-1/2" style={{ insetBlockEnd: `${tick / top * 100}%` }}>
                      {formatStatsNumber(tick)}
                    </bdi>
                  ))}
                </div>
              </div>
              <div className="relative isolate col-start-2 row-start-1">
                {ticks.map((tick) => (
                  <span
                    key={tick}
                    aria-hidden="true"
                    className="absolute inset-x-0 border-t"
                    style={{ insetBlockEnd: `${tick / top * 100}%`, borderColor: tick === 0 ? 'var(--border-strong)' : 'var(--hairline)' }}
                  />
                ))}
                {mean !== null && (
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-[1] border-t border-dashed" style={{ insetBlockEnd: `${mean / top * 100}%`, borderColor: 'var(--text-muted)' }}>
                    <span className="absolute end-0 bottom-0 bg-surface py-0.5 text-center text-xs leading-tight" style={{ inlineSize: meanLane }}>
                      {t('companyStats.trend.average')}<strong className="block tabular-nums"><bdi dir="ltr">{meanText}</bdi></strong>
                    </span>
                  </div>
                )}
                <ul role="list" className="absolute inset-0 grid" style={gridStyle}>
                  {buckets.map(({ bucket: { start, end }, value, partial }) => {
                    const endLabel = formatStatsDate(end, language)
                    const range = start === end ? endLabel : t('companyStats.trend.bucketRange', {
                      from: formatStatsDate(start, language, start.slice(0, 4) !== end.slice(0, 4)), to: endLabel,
                    })
                    const label = t('companyStats.trend.bucketValue', { metric: metricLabel, range, value: formatStatsNumber(value) })
                    const action = t('companyStats.trend.openAttendance', { date: endLabel })
                    const height = value / top * 100
                    const fill = partial ? partialStyle : mean !== null && value < mean ? belowStyle : aboveStyle
                    return (
                      <li key={start} className="relative">
                        <Link
                          to={`/employees/attendance?date=${end}`}
                          aria-label={`${label}${partial ? ` · ${partialLabel}` : ''} · ${action}`}
                          title={action}
                          className="absolute inset-0 flex items-end justify-center rounded-sm hover:bg-surface-tinted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                        >
                          <bdi aria-hidden="true" dir="ltr" className="absolute z-[2] rounded-sm bg-surface px-0.5 text-xs leading-tight font-bold tabular-nums" style={{ insetBlockEnd: `calc(${height}% + 2px)` }}>
                            {formatStatsNumber(value)}
                          </bdi>
                          {value > 0 && <span aria-hidden="true" className="w-2/3 max-w-11 rounded-ss-sm rounded-se-sm border" style={{ ...fill, blockSize: `${height}%` }} />}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
              <div aria-hidden="true" className="col-start-2 row-start-2 grid text-center text-xs leading-snug text-muted-foreground" style={gridStyle}>
                {buckets.map(({ bucket, partial }, index) => (
                  <div key={bucket.start} className="min-w-0 px-0.5 pt-1.5 last:font-semibold last:text-foreground">
                    {weekly ? (
                      <Trans i18nKey="companyStats.trend.week" values={{ number: formatStatsNumber(index + 1) }} components={{ number: <bdi dir="ltr" className="tabular-nums" /> }} />
                    ) : <bdi dir="auto">{labels?.[index]}</bdi>}
                    <div className="font-normal text-muted-foreground">
                      <BucketDetail bucket={bucket} partial={partial} weekly={weekly} language={language} shortMonth={shortMonth} />
                    </div>
                    {partial && <div className="font-medium text-muted-foreground">{t('companyStats.trend.partial')}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      {maximum === 0 && <p className="mt-2 text-xs text-muted-foreground">{t('companyStats.trend.empty')}</p>}
    </figure>
  )
}
