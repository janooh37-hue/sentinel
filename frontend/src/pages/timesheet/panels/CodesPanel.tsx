/**
 * The whole workbook counted by code, with a share bar each — direction C's
 * tally, which UI spec §15 change 2 brought across to A.
 *
 * Read-only by nature: it is the month's own arithmetic, so there is nothing to
 * gate. It does not count anything itself either — the dock already counted the
 * same eight numbers for its always-visible strip, over the same 275 rows, so
 * they arrive as a prop rather than being recomputed here once per render.
 *
 * No colour is named here. A glyph renders `data-code={slug}` and `index.css`
 * resolves the workbook's own fill (UI spec §3.2).
 */

import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { CODES, type CodeSlug } from '../codes'
import type { TimesheetCodeIndex } from '../timesheetCodeIndex'

export interface CodesPanelProps {
  /** Shared page-owned code arithmetic, also used by the filter bar. */
  index: TimesheetCodeIndex
  /** Activates the same page-owned filter as the side glance. */
  onFilterCode: (code: CodeSlug) => void
}

/** The `-` code prints as a hyphen but reads as an en dash on screen. */
const glyphOf = (slug: CodeSlug): string => (slug === '-' ? '–' : slug)

export function CodesPanel({ index, onFilterCode }: CodesPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const counts = index.cellCounts
  const total = CODES.reduce((sum, spec) => sum + counts[spec.slug], 0)

  return (
    <div className="flex flex-col gap-2">
      <div className="grid max-w-[42rem] gap-1">
        {CODES.map((spec) => {
          const n = counts[spec.slug]
          const enabled = index.employeeIds[spec.slug].length > 0
          return (
            <button
              key={spec.slug}
              type="button"
              data-testid={`code-badge-${spec.slug}`}
              data-code={spec.slug}
              aria-label={t(spec.labelKey)}
              disabled={!enabled}
              onClick={() => onFilterCode(spec.slug)}
              className={cn(
                'grid grid-cols-[1.6rem_1fr_3rem_6rem] items-center gap-2.5 text-start text-[0.78em]',
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
              <span aria-hidden className="rounded-[3px] bg-surface-tinted">
                <span
                  className="ts-share"
                  style={{ inlineSize: total === 0 ? '0%' : `${((n / total) * 100).toFixed(1)}%` }}
                />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
