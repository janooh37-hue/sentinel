/**
 * The contracted post count, what the month actually implies, and the two-block
 * rule that connects them (UI spec §16.2, §9's "implied posts above contract").
 *
 * Implied posts is the mean daily manned headcount — every working-day cell
 * divided by the days the month has, which is the same number the grid's
 * headcount footer adds up column by column. At or below the contract is
 * correct; above it means block-2 rows are still carrying the working-day code
 * instead of a filler, and the client would be billed for posts nobody staffed.
 *
 * Writing the count is `timesheet.edit` and is refused on a sealed month, so on
 * either of those the field is not rendered at all — a disabled control still
 * answers Enter and Space (UI spec §14) — and the reason is stated in its place.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

export interface PostsPanelProps {
  postCount: number
  /** Mean daily manned headcount across the days the month has. */
  impliedPosts: number
  canEdit: boolean
  closed: boolean
  onSetPostCount: (postCount: number) => void
}

export function PostsPanel({
  postCount,
  impliedPosts,
  canEdit,
  closed,
  onSetPostCount,
}: PostsPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const writable = canEdit && !closed
  /**
   * The raw field. Parsing every keystroke and writing the clamped number back
   * would turn `clear` then `24` into `024`; the commit happens on blur, which
   * is also one PATCH per edit rather than one per digit.
   */
  const [raw, setRaw] = useState(String(postCount))
  useEffect(() => setRaw(String(postCount)), [postCount])

  /**
   * `Number('') === 0`, and `post_count: 0` is SERVER-VALID (`ge=0`, plus the
   * CHECK on the table), so an empty field would sail through an
   * `Number.isInteger` guard and PATCH zero. Block 1 would then be empty and
   * the ENTIRE roster would fall into block 2 of the client statistics
   * workbook — silently, off the corrections stack, and sealed into the
   * deliverable by the next download. The gesture that does it is the ordinary
   * one: select all, Delete, click away. So the blank string is refused FIRST,
   * by looking at the text rather than at the number it coerces to.
   *
   * No confirmation beyond this, deliberately. A "suspiciously small" threshold
   * is a magic number no document specifies, and the count is freely
   * re-writable for as long as the month is open — the dock reads the new value
   * back immediately, the drift chip moves with it, and the one irreversible
   * step (the download) already states that it freezes the month. What was
   * missing was not a prompt; it was refusing an input the operator never made.
   */
  const commit = (): void => {
    const next = Number(raw)
    if (raw.trim() === '' || !Number.isInteger(next) || next < 0 || next === postCount) {
      setRaw(String(postCount))
      return
    }
    onSetPostCount(next)
  }

  const drift = impliedPosts > postCount

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      {writable ? (
        <span className="flex shrink-0 items-center gap-2">
          <label htmlFor="ts-post-count" className="text-[0.78em] font-medium text-muted-foreground">
            {t('timesheet.postsLabel')}
          </label>
          <input
            id="ts-post-count"
            type="number"
            min={0}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            className="w-[5.5rem] rounded-sm border border-border-strong bg-surface px-2 py-1 font-mono text-[0.85em] font-semibold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </span>
      ) : (
        <span className="flex shrink-0 flex-col">
          <span
            data-ts-caps
            className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-faint"
          >
            {t('timesheet.postsLabel')}
          </span>
          <b
            dir="ltr"
            className="font-mono text-[1.15em] font-semibold tabular-nums [unicode-bidi:isolate]"
          >
            {postCount}
          </b>
        </span>
      )}

      <span className="flex shrink-0 items-center gap-2">
        {/* A bare numeral beside words: the leaf is isolated so bidi cannot
            move it to the far end of the line (UI spec §14). */}
        <b
          data-testid="implied-posts"
          dir="ltr"
          className="font-mono text-[1.5em] font-semibold leading-none tabular-nums [unicode-bidi:isolate]"
        >
          {impliedPosts.toFixed(1)}
        </b>
        <span className="text-[0.72em] leading-tight text-muted-foreground">
          {t('timesheet.impliedPosts')}
          <br />
          {drift ? t('timesheet.impliedDrift') : t('timesheet.impliedOk')}
        </span>
      </span>

      <span
        dir="ltr"
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[0.72em] font-semibold tabular-nums [unicode-bidi:isolate]',
          drift ? 'bg-accent-soft text-accent' : 'bg-success-soft text-success',
        )}
      >
        {drift ? '▲' : '✓'} {impliedPosts.toFixed(1)} / {postCount}
      </span>

      <p className="min-w-[18rem] max-w-[68ch] flex-1 text-[0.74em] text-muted-foreground">
        {t('timesheet.twoBlockRule')}
      </p>

      {!writable && (
        <p className="w-full text-[0.74em] font-medium text-warning">
          {closed ? t('timesheet.frozen') : t('timesheet.needsEdit')}
        </p>
      )}
    </div>
  )
}
