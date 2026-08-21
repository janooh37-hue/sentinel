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

export interface CodesPanelProps {
  /** Counted by the dock, from the code array the sheet is actually showing. */
  counts: Record<CodeSlug, number>
}

/** The `-` code prints as a hyphen but reads as an en dash on screen. */
const glyphOf = (slug: CodeSlug): string => (slug === '-' ? '–' : slug)

export function CodesPanel({ counts }: CodesPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const total = CODES.reduce((sum, spec) => sum + counts[spec.slug], 0)

  return (
    <div className="flex flex-col gap-2">
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
