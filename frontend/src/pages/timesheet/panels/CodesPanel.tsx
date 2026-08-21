/**
 * The whole workbook counted by code, with a share bar each — direction C's
 * tally, which UI spec §15 change 2 brought across to A.
 *
 * Read-only by nature: it is the month's own arithmetic, so there is nothing to
 * gate. It counts the code array the sheet is actually showing, so switching to
 * the statistics variant re-counts against the fillers rather than the
 * attendance cells.
 *
 * No colour is named here. A glyph renders `data-code={slug}` and `index.css`
 * resolves the workbook's own fill (UI spec §3.2).
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { TimesheetRow, TimesheetVariant } from '@/lib/api'
import { cn } from '@/lib/utils'

import { CODES, type CodeSlug, slugOf } from '../codes'

export interface CodesPanelProps {
  rows: TimesheetRow[]
  daysInMonth: number
  variant: TimesheetVariant
}

/** The `-` code prints as a hyphen but reads as an en dash on screen. */
const glyphOf = (slug: CodeSlug): string => (slug === '-' ? '–' : slug)

export function CodesPanel({ rows, daysInMonth, variant }: CodesPanelProps): React.JSX.Element {
  const { t } = useTranslation()

  const counts = useMemo(() => {
    const out: Record<CodeSlug, number> = { P: 0, AL: 0, SL: 0, AB: 0, TR: 0, NG: 0, '-': 0, X: 0 }
    for (const row of rows) {
      const codes = variant === 'statistics' ? row.stat_codes : row.codes
      for (let day = 1; day <= daysInMonth; day += 1) {
        const slug = slugOf(codes[day - 1] ?? null)
        if (slug !== '') out[slug] += 1
      }
    }
    return out
  }, [daysInMonth, rows, variant])

  const total = CODES.reduce((sum, spec) => sum + counts[spec.slug], 0)

  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-1.5 text-[0.74em] text-muted-foreground">
        <span className="[unicode-bidi:isolate]">{t('timesheet.cells', { count: total })}</span>
        <span aria-hidden>·</span>
        <span className="[unicode-bidi:isolate]">{t('timesheet.rows', { count: rows.length })}</span>
        <span aria-hidden>·</span>
        <span>
          {variant === 'statistics' ? t('timesheet.statistics') : t('timesheet.attendance')}
        </span>
      </p>
      <div className="grid max-w-[42rem] gap-1">
        {CODES.map((spec) => {
          const n = counts[spec.slug]
          return (
            <div
              key={spec.slug}
              className={cn(
                'grid grid-cols-[1.6rem_1fr_3rem_6rem] items-center gap-2.5 text-[0.78em]',
                n === 0 && 'opacity-45',
              )}
            >
              <span
                data-code={spec.slug}
                aria-hidden
                className="grid h-[1.1rem] place-items-center rounded-[3px] border border-border font-mono text-[0.62rem] font-semibold"
              >
                {glyphOf(spec.slug)}
              </span>
              <span className="truncate">{t(spec.labelKey)}</span>
              <span
                dir="ltr"
                data-testid={`tally-${spec.slug}`}
                className="text-end font-mono font-semibold tabular-nums [unicode-bidi:isolate]"
              >
                {n}
              </span>
              {/* The proportion, not a control. The number beside it is the
                  datum; the bar is the only place a width is set inline. */}
              <span aria-hidden className="rounded-[3px] bg-surface-tinted">
                <span
                  className="ts-share"
                  style={{ inlineSize: total === 0 ? '0%' : `${((n / total) * 100).toFixed(1)}%` }}
                />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
