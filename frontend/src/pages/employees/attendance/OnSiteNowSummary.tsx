import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'

import { siteToday } from '@/components/employees/useAttendanceAttention'
import { cn } from '@/lib/utils'

import { daySummary, ON_SITE_BUCKETS, siteTime, type AttendanceRow, type DaySummary, type OnSiteBucket } from './attendanceModel'

interface Props {
  rows: readonly AttendanceRow[]
  operationalDate: string
  /** The day payload's timestamp, shared with the row verdicts. */
  now: Date
  who: OnSiteBucket | null
  onWhoChange: (who: OnSiteBucket | null) => void
  attentionCount: number
  attentionAnchorId: string
  attentionTargetId: string
}

const PAST_BUCKETS: readonly OnSiteBucket[] = ON_SITE_BUCKETS.filter((bucket) => bucket !== 'onSite')

/** Tier-one marks share the bar's tokens, not a second row-status palette. */
const BUCKET_MARK: Record<OnSiteBucket, string> = {
  onSite: 'bg-success shadow-[0_0_0_2px_var(--success-soft)]',
  left: 'border border-primary bg-primary-soft',
  notArrived: 'bg-accent',
  leave: 'bg-info',
  nationalService: 'bg-smart',
}

interface Leader {
  bucket: OnSiteBucket
  path: string
}

/** One person per bucket; row-status filters never change these day totals. */
export function OnSiteNowSummary({
  rows,
  operationalDate,
  now,
  who,
  onWhoChange,
  attentionCount,
  attentionAnchorId,
  attentionTargetId,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const today = operationalDate === siteToday()
  const summary: DaySummary = useMemo(() => daySummary(rows, { now }), [rows, now])
  const buckets = today ? ON_SITE_BUCKETS : PAST_BUCKETS
  const title = t(today ? 'attendance.onSiteNow.title' : 'attendance.onSiteNow.daySummary')
  const [focusedBucket, setFocusedBucket] = useState<OnSiteBucket | null>(who)
  const tabStop = focusedBucket && buckets.includes(focusedBucket) && summary[focusedBucket] > 0
    ? focusedBucket
    : buckets.find((bucket) => summary[bucket] > 0)
  const visualRef = useRef<HTMLDivElement>(null)
  const leadersRef = useRef<SVGSVGElement>(null)
  const segmentRefs = useRef<Partial<Record<OnSiteBucket, HTMLSpanElement | null>>>({})
  const buttonRefs = useRef<Partial<Record<OnSiteBucket, HTMLButtonElement | null>>>({})
  const swatchRefs = useRef<Partial<Record<OnSiteBucket, HTMLSpanElement | null>>>({})
  const [leaders, setLeaders] = useState<Leader[]>([])

  useLayoutEffect(() => {
    const visual = visualRef.current
    const svg = leadersRef.current
    if (!visual || !svg) return

    const measure = (): void => {
      const bounds = svg.getBoundingClientRect()
      if (bounds.width === 0) return
      const rtl = (document.documentElement.dir || i18n.dir()) === 'rtl'
      // Read every endpoint before writing paths. Lane order prevents crossings.
      const lines = buckets.flatMap((bucket) => {
        const segment = segmentRefs.current[bucket]
        const swatch = swatchRefs.current[bucket]
        if (!segment || !swatch) return []
        const segmentBounds = segment.getBoundingClientRect()
        const swatchBounds = swatch.getBoundingClientRect()
        const start = segmentBounds.x + segmentBounds.width / 2 - bounds.x
        const end = swatchBounds.x + swatchBounds.width / 2 - bounds.x
        return [{
          bucket,
          start,
          end,
          finish: swatchBounds.y + swatchBounds.height / 2 - bounds.y,
          backward: rtl ? start < end : start > end,
        }]
      })
      let backwardLane = 0
      let forwardLane = lines.filter((line) => !line.backward).length - 1
      const next = lines.map(({ bucket, start, end, finish, backward }) => {
        const lane = 6 + (backward ? backwardLane++ : forwardLane--) * 5
        return { bucket, path: `M${start.toFixed(2)} 1 V${lane} H${end.toFixed(2)} V${finish.toFixed(2)}` }
      })
      setLeaders((current) => current.length === next.length && current.every((line, index) => line.path === next[index].path && line.bucket === next[index].bucket)
        ? current
        : next)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(visual)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [buckets, summary, i18n, i18n.language])

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, bucket: OnSiteBucket): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const enabled = buckets.filter((key) => summary[key] > 0)
    if (enabled.length === 0) return
    const rtl = (document.documentElement.dir || i18n.dir()) === 'rtl'
    const forward = event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
    const index = event.key === 'Home' ? 0
      : event.key === 'End' ? enabled.length - 1
        : (enabled.indexOf(bucket) + (forward ? 1 : -1) + enabled.length) % enabled.length
    const next = enabled[index]
    setFocusedBucket(next)
    buttonRefs.current[next]?.focus()
  }

  return (
    <section aria-labelledby={`${id}-title`} className="my-3 grid gap-0 rounded-2xl border border-border bg-surface lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
      <div className="grid min-w-0 gap-5 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:p-5">
        <div className="min-w-0 self-center">
          <h2 id={`${id}-title`} className="mb-1.5 text-[0.85em] font-semibold">{title}</h2>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              <Trans
                i18nKey="attendance.onSiteNow.asOf"
                values={{ time: siteTime(now.toISOString()) }}
                components={[<bdi dir="ltr" key="time" className="font-mono tabular-nums" />]}
              />
            </span>
            <span>
              <Trans
                i18nKey="attendance.onSiteNow.people"
                count={summary.people}
                components={[<bdi dir="ltr" key="people" className="font-mono tabular-nums" />]}
              />
            </span>
          </div>
          <div className="group relative mt-2">
            <button
              type="button"
              aria-describedby={`${id}-residual-hint`}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-sm text-start text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-6 [@media(pointer:coarse)]:min-h-[44px]"
            >
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full border border-faint" />
              <span>{t('attendance.onSiteNow.residual')} · <bdi dir="ltr" className="font-mono tabular-nums">{summary.residual}</bdi></span>
            </button>
            <span
              id={`${id}-residual-hint`}
              role="tooltip"
              className="block text-xs leading-relaxed text-muted-foreground sm:invisible sm:absolute sm:bottom-full sm:start-0 sm:z-10 sm:mb-2 sm:w-60 sm:max-w-[calc(100vw-3rem)] sm:rounded-sm sm:border sm:border-border-strong sm:bg-surface sm:px-3 sm:py-2 sm:text-foreground sm:shadow-lg sm:group-focus-within:visible sm:group-hover:visible"
            >
              {t('attendance.onSiteNow.residualHint')}
            </span>
          </div>
        </div>
        <div ref={visualRef} className="min-w-0 pt-1.5">
          <h3 id={`${id}-who`} className="mb-3 text-xs font-semibold">{t('attendance.onSiteNow.who')}</h3>
          <div aria-hidden="true" className="flex h-[15px] gap-[2px]">
            {buckets.filter((bucket) => summary[bucket] > 0).map((bucket) => (
              <span
                key={bucket}
                ref={(node) => { segmentRefs.current[bucket] = node }}
                data-bucket={bucket}
                className={cn(
                  'flex basis-0 overflow-hidden rounded-[2px] [min-inline-size:8px] motion-safe:transition-opacity',
                  BUCKET_MARK[bucket],
                  bucket === 'notArrived' && 'bg-surface',
                  who !== null && who !== bucket && 'opacity-[0.22]',
                )}
                style={{ flexGrow: summary[bucket] }}
              >
                {bucket === 'notArrived' && (
                  <>
                    {summary.absent > 0 && <span className="min-w-0 bg-accent" style={{ flex: summary.absent }} />}
                    {summary.awaited > 0 && (
                      <span className="min-w-0" style={{ flex: summary.awaited }}>
                        <svg className="h-full w-full">
                          <defs>
                            <pattern id={`${id}-awaited-hatch`} width="5" height="5" patternUnits="userSpaceOnUse">
                              <path d="M-1 1 1-1M0 5 5 0M4 6 6 4" stroke="var(--accent)" strokeWidth="1.5" />
                            </pattern>
                          </defs>
                          <rect width="100%" height="100%" fill={`url(#${id}-awaited-hatch)`} />
                        </svg>
                      </span>
                    )}
                  </>
                )}
              </span>
            ))}
          </div>
          <svg ref={leadersRef} aria-hidden="true" className="pointer-events-none hidden h-9 w-full overflow-visible sm:block">
            {leaders.map(({ bucket, path }) => (
              <path
                key={bucket}
                d={path}
                fill="none"
                stroke={who === bucket ? 'var(--primary)' : 'var(--border-strong)'}
                strokeWidth={who === bucket ? 1.25 : 1}
                opacity={who !== null && who !== bucket ? 0.35 : 1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <div
            role="group"
            aria-labelledby={`${id}-who`}
            className={cn('mt-2 grid grid-cols-2 gap-2 sm:mt-0 sm:gap-1', today ? 'sm:grid-cols-5' : 'sm:grid-cols-4')}
          >
            {buckets.map((bucket) => (
              <button
                key={bucket}
                ref={(node) => { buttonRefs.current[bucket] = node }}
                type="button"
                aria-pressed={who === bucket}
                aria-disabled={summary[bucket] === 0}
                tabIndex={tabStop === bucket ? 0 : -1}
                onFocus={() => setFocusedBucket(bucket)}
                onKeyDown={(event) => moveFocus(event, bucket)}
                onClick={() => {
                  if (summary[bucket] > 0) onWhoChange(who === bucket ? null : bucket)
                }}
                className="flex min-h-[58px] min-w-0 flex-col items-start gap-1 rounded-sm border border-transparent px-2 py-1.5 text-start hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-surface-raised aria-disabled:cursor-default aria-disabled:opacity-55 aria-disabled:hover:bg-transparent"
              >
                <span className="flex items-center gap-2.5">
                  <span
                    ref={(node) => { swatchRefs.current[bucket] = node }}
                    aria-hidden="true"
                    className={cn('size-2 shrink-0 rounded-[2px]', BUCKET_MARK[bucket])}
                  />
                  <bdi dir="ltr" className="font-mono text-[22px] font-medium leading-tight tabular-nums">{summary[bucket]}</bdi>
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">{t(`attendance.onSiteNow.${bucket}`)}</span>
                {bucket === 'notArrived' && (summary.absent > 0 || summary.awaited > 0) && (
                  <span className="flex flex-wrap gap-x-1 text-xs leading-relaxed text-muted-foreground">
                    {summary.absent > 0 && <span>{t('attendance.onSiteNow.splitAbsent')} <bdi dir="ltr" className="font-mono tabular-nums">{summary.absent}</bdi></span>}
                    {summary.absent > 0 && summary.awaited > 0 && <span aria-hidden="true">·</span>}
                    {summary.awaited > 0 && <span>{t('attendance.onSiteNow.splitAwaited')} <bdi dir="ltr" className="font-mono tabular-nums">{summary.awaited}</bdi></span>}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-hairline px-4 py-3 lg:flex-col lg:items-start lg:justify-center lg:gap-2 lg:border-s lg:border-t-0 lg:p-5">
        <a
          id={attentionAnchorId}
          href={`#${attentionTargetId}`}
          onClick={(event) => {
            event.preventDefault()
            const target = document.getElementById(attentionTargetId)
            target?.focus({ preventScroll: true })
            target?.scrollIntoView({ block: 'start' })
          }}
          className={cn('inline-flex min-h-[44px] items-center gap-2 rounded-sm text-[0.8em] font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', attentionCount > 0 ? 'text-accent' : 'text-foreground')}
        >
          <span>
            <Trans
              i18nKey="attendance.attention.anchor"
              values={{ count: attentionCount }}
              components={[<bdi dir="ltr" key="decisions" className="font-mono tabular-nums" />]}
            />
          </span>
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 rtl:rotate-180" />
        </a>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('attendance.attention.filterHint')}</p>
      </div>
    </section>
  )
}
