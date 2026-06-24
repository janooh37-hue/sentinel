/**
 * FigMonthColumns — Fig. 2: "Absence by month" column chart, and the report's
 * controller: each of the 12 columns is a real toggle `<button>` that scopes
 * the whole report to that month (clicking the selected month clears it).
 * Bars are height-scaled to the busiest month (zero months keep a 2px stub),
 * month ticks are localized via Intl, the current month carries a quiet dot
 * marker, and a `<details>` table exposes the underlying numbers.
 *
 * RTL: column order comes from flex flow (no left/right anywhere), so the
 * chart mirrors automatically with `dir`.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { kindMeta } from './kinds'
import type { MonthAgg, MonthRef } from './reportData'

interface FigMonthColumnsProps {
  data: MonthAgg[]
  selected: MonthRef | null
  currentMonthIndex: number
  year: number
  onSelect: (m: MonthRef | null) => void
}

/** Tallest bar in px; the chart row is h-[96px] so labels fit above bars. */
const BAR_MAX_PX = 72

const TH_NUM = 'border-b border-border px-1.5 py-1 text-end font-semibold text-muted-foreground'
const TD_NUM = 'border-b border-hairline px-1.5 py-1 text-end font-mono tabular-nums'

export function FigMonthColumns({
  data,
  selected,
  currentMonthIndex,
  year,
  onSelect,
}: FigMonthColumnsProps): React.JSX.Element {
  const { t, i18n } = useTranslation()

  // timeZone: 'UTC' keeps the label on the Date.UTC month in every local TZ.
  const monthShort = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'short', timeZone: 'UTC' }),
    [i18n.language],
  )
  const monthLong = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'long', timeZone: 'UTC' }),
    [i18n.language],
  )
  const monthDate = (monthIndex: number): Date => new Date(Date.UTC(year, monthIndex, 1))

  const maxDays = data.reduce((max, d) => Math.max(max, d.days), 0)
  // Prototype gridline scale: a round half-step `grid` and a top line at 2×;
  // bars scale against `top`, so the lines are honest value markers.
  const grid = Math.max(10, Math.ceil(maxDays / 2 / 10) * 10)
  const top = grid * 2
  const isSelected = (monthIndex: number): boolean =>
    selected !== null && selected.year === year && selected.monthIndex === monthIndex

  const caption = `${t('leaves.report.fig2Caption')} — ${year}`
  const chartLabel = `${caption}: ${data
    .map((d) => `${monthLong.format(monthDate(d.monthIndex))} ${d.days}`)
    .join(', ')}`
  const monthAria = (d: MonthAgg): string =>
    `${monthLong.format(monthDate(d.monthIndex))}: ${t('leaves.report.totalsRecords', {
      count: d.records,
    })}, ${t('leaves.report.totalsDays', { count: d.days })}`

  return (
    <figure className="rounded-2xl border border-hairline bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        {/* rtl:tracking-normal — Arabic joined script must not be letter-spaced */}
        <figcaption className="font-mono text-[0.7em] uppercase tracking-[0.1em] text-muted-foreground rtl:tracking-normal">
          {caption}
        </figcaption>
        {selected !== null && (
          /* In the caption row (prototype `.allyear`) — after the caption in
             DOM order, so the 12 month buttons keep stable indices. */
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={cn(
              'whitespace-nowrap rounded-sm font-mono text-[0.7em] uppercase tracking-[0.08em] text-muted-foreground rtl:tracking-normal',
              'transition-colors hover:text-foreground motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <span aria-hidden="true">↺ </span>
            {t('leaves.report.resetScope', { year })}
          </button>
        )}
      </div>
      <p className="mt-1 text-[0.7em] text-faint">{t('leaves.report.fig2Hint')}</p>

      <div className="mt-3">
        {/* Interactive chart — role=group (not img: the columns are buttons). */}
        <div className="relative">
          {/* value gridlines at `grid` and `top` — markers only, never targets */}
          {[grid, top].map((v) => (
            <div
              key={v}
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 border-t border-hairline"
              style={{ bottom: `${(v / top) * BAR_MAX_PX}px` }}
            >
              <span className="absolute end-0 top-[-1.1em] font-mono text-[0.6em] tabular-nums text-faint">
                {v}
              </span>
            </div>
          ))}
          <div className="flex h-[96px] items-end gap-1" role="group" aria-label={chartLabel}>
            {data.map((d) => {
              const sel = isSelected(d.monthIndex)
              return (
                <button
                  key={d.monthIndex}
                  type="button"
                  aria-pressed={sel}
                  aria-label={monthAria(d)}
                  onClick={() =>
                    onSelect(sel ? null : { year, monthIndex: d.monthIndex })
                  }
                  className={cn(
                    'group flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-sm',
                    'transition-colors hover:bg-surface-tinted motion-reduce:transition-none',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    sel && 'bg-primary-soft',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mb-0.5 font-mono text-[0.65em] font-semibold tabular-nums text-primary',
                      'transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
                      'motion-reduce:transition-none',
                      sel ? 'opacity-100' : 'opacity-0',
                    )}
                  >
                    {d.days}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mx-auto w-full max-w-[18px] rounded-t bg-primary',
                      sel ? 'opacity-100' : 'opacity-55',
                    )}
                    style={{
                      height: `${Math.max((d.days / top) * BAR_MAX_PX, 2)}px`,
                    }}
                  />
                </button>
              )
            })}
          </div>
        </div>

        {/* Month ticks — visual axis only; the buttons carry the month names.
            mb leaves room for the absolutely-positioned "current" word. */}
        <div className="mb-3.5 mt-1 flex gap-1" aria-hidden="true">
          {data.map((d) => {
            const cur = d.monthIndex === currentMonthIndex
            return (
              <span
                key={d.monthIndex}
                className={cn(
                  'relative min-w-0 flex-1 text-center font-mono text-[0.62em] uppercase',
                  isSelected(d.monthIndex)
                    ? 'font-semibold text-primary'
                    : cur
                      ? 'text-muted-foreground'
                      : 'text-faint',
                )}
              >
                {monthShort.format(monthDate(d.monthIndex))}
                {cur && (
                  <>
                    <span className="block text-[0.6em] leading-none text-faint">▲</span>
                    <span className="absolute start-1/2 top-full -translate-x-1/2 whitespace-nowrap text-[0.95em] normal-case text-muted-foreground rtl:translate-x-1/2">
                      {t('leaves.report.fig2Current')}
                    </span>
                  </>
                )}
              </span>
            )
          })}
        </div>
      </div>

      {data.length > 0 && (
        <details className="mt-3 border-t border-hairline pt-2">
          <summary className="cursor-pointer font-mono text-[0.7em] uppercase tracking-[0.08em] text-faint hover:text-muted-foreground rtl:tracking-normal">
            {t('leaves.report.viewData')}
          </summary>
          <table className="mt-2 w-full border-collapse text-[0.72em]">
            <thead>
              <tr>
                <th className="border-b border-border px-1.5 py-1 text-start font-semibold text-muted-foreground">
                  {t('leaves.report.colMonth')}
                </th>
                <th className={TH_NUM}>{t('leaves.report.colRecords')}</th>
                <th className={TH_NUM}>{t('leaves.report.colDays')}</th>
                <th className={TH_NUM}>{t('leaves.report.colEmployees')}</th>
                <th className="border-b border-border px-1.5 py-1 text-start font-semibold text-muted-foreground">
                  {t('leaves.report.colTopKind')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.monthIndex}>
                  <td className="border-b border-hairline px-1.5 py-1">
                    {monthLong.format(monthDate(d.monthIndex))}
                  </td>
                  <td className={TD_NUM}>{d.records}</td>
                  <td className={TD_NUM}>{d.days}</td>
                  <td className={TD_NUM}>{d.employees}</td>
                  <td className="border-b border-hairline px-1.5 py-1">
                    {d.topKind === null ? (
                      '—'
                    ) : (
                      <>
                        <span className="me-1" aria-hidden="true">
                          {kindMeta(d.topKind).emoji}
                        </span>
                        {t(kindMeta(d.topKind).i18nKey)}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  )
}
