/**
 * One employee's month, counted — the screen's replacement for the workbook's
 * `AK..AP` totals block (UI spec §15 change 7 took the six columns off the
 * grid; change 4 puts all eight counts a hover away instead).
 *
 * Why an overlay rather than six more columns: 31 day columns plus a 558px
 * identity block already fills a 1560px screen, and six totals columns are six
 * columns of numbers the operator reads once per employee. The workbook still
 * prints them — nothing here touches the renderer.
 *
 * `position: fixed`, and it follows the anchor row through a scroll rather than
 * being clipped by the region that scrolled: focusing a cell near the edge of
 * the sheet makes the browser scroll, and a box that vanished at that moment
 * would be useless to a keyboard user (UI spec §15 change 4).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import type { TimesheetRow } from '@/lib/api'
import { cn } from '@/lib/utils'

import { CODES, type CodeSlug, slugOf } from './codes'

export interface RowTallyProps {
  row: TimesheetRow
  /** The code array in play: `codes` on the attendance grid, `stat_codes` on the statistics one. */
  codes: readonly (string | null)[]
  daysInMonth: number
  /** The `<tr>` the counts belong to. */
  anchor: HTMLElement
  /** The anchor has scrolled out of the sheet — stop showing counts for it. */
  onDismiss: () => void
}

/** Every code counted across the days the month actually has. */
export function tallyOf(
  codes: readonly (string | null)[],
  daysInMonth: number,
): Record<CodeSlug, number> {
  const out = { P: 0, AL: 0, SL: 0, AB: 0, TR: 0, NG: 0, '-': 0, X: 0 }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const slug = slugOf(codes[day - 1] ?? null)
    if (slug !== '') out[slug] += 1
  }
  return out
}

/** The `-` code prints as a hyphen but reads as an en dash on screen. */
const glyphOf = (slug: CodeSlug): string => (slug === '-' ? '–' : slug)

export function RowTally({
  row,
  codes,
  daysInMonth,
  anchor,
  onDismiss,
}: RowTallyProps): React.JSX.Element {
  const { t } = useTranslation()
  const box = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const counts = tallyOf(codes, daysInMonth)

  /**
   * `track` separates the two jobs this does. Placing is unconditional; the
   * visibility check belongs ONLY to a later scroll or resize. When the box
   * first mounts the anchor is on screen by definition — it is the row the
   * pointer is over, or the one that just took focus — so asking at mount
   * answers a settled question, and answers it wrongly anywhere the first
   * `getBoundingClientRect` reads zero before layout has run.
   */
  const place = useCallback(
    (track: boolean) => {
      const node = box.current
      if (!node) return
      const rect = anchor.getBoundingClientRect()
      // Gone up under the sticky day header, or below the fold: the counts
      // belong to a row nobody can see any more.
      if (track && (rect.bottom < 80 || rect.top > window.innerHeight - 20)) {
        onDismiss()
        return
      }
      const size = node.getBoundingClientRect()
      const rtl = document.documentElement.dir === 'rtl'
      const raw = rtl ? rect.right - size.width : rect.left
      const x = Math.max(8, Math.min(raw, window.innerWidth - size.width - 8))
      const above = rect.top - size.height - 6
      const y = above > 60 ? above : rect.bottom + 6
      // A viewport coordinate is physical and so is a transform, so the box is
      // anchored logically (`.ts-tally` sets `inset-inline-start: 0`) and moved
      // by a translation — which in RTL starts from the far edge that anchor
      // gives it. Nothing here names `left` or `top`.
      const origin = rtl ? window.innerWidth - size.width : 0
      node.style.transform = `translate3d(${x - origin}px, ${y}px, 0)`
      setReady(true)
    },
    [anchor, onDismiss],
  )

  useLayoutEffect(() => {
    place(false)
  }, [place])

  useEffect(() => {
    const follow = (): void => place(true)
    // Capture phase: the sheet's own scroll container is the one that moves,
    // and a scroll event does not bubble.
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [place])

  return createPortal(
    <div
      ref={box}
      role="status"
      className={cn(
        'ts-tally flex items-center gap-2.5 px-2.5 py-1.5',
        !ready && 'opacity-0',
      )}
    >
      <span className="font-mono text-[0.68rem] text-muted-foreground">
        <b className="font-semibold text-foreground">{row.employee_id}</b> {row.name_en}
      </span>
      {CODES.map((spec) => (
        <span
          key={spec.slug}
          className={cn(
            'inline-flex items-center gap-1 font-mono text-[0.68rem] text-foreground',
            counts[spec.slug] === 0 && 'opacity-35',
          )}
        >
          <span
            data-code={spec.slug}
            aria-hidden
            className="grid h-[0.95rem] w-[1.35rem] place-items-center rounded-[3px] border border-border text-[0.6rem] font-semibold"
          >
            {glyphOf(spec.slug)}
          </span>
          <span className="sr-only">{t(spec.labelKey)}</span>
          {counts[spec.slug]}
        </span>
      ))}
    </div>,
    document.body,
  )
}
