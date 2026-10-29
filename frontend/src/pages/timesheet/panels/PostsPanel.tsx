/**
 * The contracted posts and how the month fills them.
 *
 * Main sheet: the contract is the designation quotas (Settings → Designation
 * order), the same for every month, so the count is read-only here. The table is
 * `grid.quotas` — per designation and nationality, the posts filled by their own
 * holders, by spare Security Guards, and left empty (not billed). A sealed month
 * carries no quota lines: it is frozen as printed.
 *
 * Drivers: the per-month post count, with implied posts beside it — the mean
 * daily manned headcount, every working-day cell on the ATTENDANCE sheet divided
 * by the days the month has. At or below the contract is correct; above it means
 * block-2 rows are still carrying the working-day code instead of a filler, and
 * the client would be billed for posts nobody staffed. It is counted from the
 * attendance array in both variants, because only the attendance sheet can answer
 * that. Writing the count is `timesheet.edit` and is refused on a sealed month, so
 * on either of those the field is not rendered at all — a disabled control still
 * answers Enter and Space (UI spec §14) — and the reason is stated in its place.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TimesheetQuotaLine } from '@/lib/api'
import { cn } from '@/lib/utils'

export interface PostsPanelProps {
  sheet: string
  quotas: TimesheetQuotaLine[]
  postCount: number
  /** Mean daily manned headcount across the days the month has. */
  impliedPosts: number
  canEdit: boolean
  closed: boolean
  onSetPostCount: (postCount: number) => void
}

export function PostsPanel(props: PostsPanelProps): React.JSX.Element {
  return props.sheet === 'drivers' ? <DriverPostsPanel {...props} /> : <ContractPostsPanel {...props} />
}

function ContractPostsPanel({ postCount, quotas, closed }: PostsPanelProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const totals = quotas.reduce((sum, line) => ({
    quota: sum.quota + line.quota,
    own: sum.own + line.own,
    guards: sum.guards + line.from_guards,
  }), { quota: 0, own: 0, guards: 0 })
  const numberClass = 'px-3 py-2 font-mono tabular-nums [unicode-bidi:isolate]'
  const emptyClass = (empty: number): string => cn(numberClass, empty > 0 && 'bg-warning-soft font-semibold text-warning')
  return (
    <div className="space-y-3">
      <p className="text-[0.88em] font-semibold">
        {t('timesheet.designations.contractTotal', { count: postCount })}
      </p>
      {closed && quotas.length === 0 ? (
        <p className="text-[0.78em] text-muted-foreground">{t('timesheet.quotas.sealed')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-[0.78em]">
            <caption className="sr-only">{t('timesheet.quotas.table')}</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-start">{t('timesheet.quotas.designation')}</th>
                <th scope="col" className="px-3 py-2 text-start">{t('timesheet.quotas.nationality')}</th>
                <th scope="col" className="px-3 py-2 text-start">{t('timesheet.quotas.filled')}</th>
                <th scope="col" className="px-3 py-2 text-start">{t('timesheet.quotas.empty')}</th>
              </tr>
            </thead>
            <tbody>
              {quotas.map((line) => {
                const empty = line.quota - line.own - line.from_guards
                return (
                  <tr key={`${line.designation_id}-${line.nationality}`} className="border-t border-hairline">
                    <th scope="row" className="px-3 py-2 text-start font-medium">
                      {i18n.language.startsWith('ar') ? line.name_ar : line.name_en}
                    </th>
                    <td className="px-3 py-2">{t(`timesheet.quotas.${line.nationality}`)}</td>
                    <td className={numberClass}><span dir="ltr">{line.own} + {line.from_guards} / {line.quota}</span></td>
                    <td className={emptyClass(empty)}><span dir="ltr">{empty}</span></td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t border-border-strong font-semibold">
              <tr>
                <th scope="row" colSpan={2} className="px-3 py-2 text-start">{t('timesheet.quotas.total')}</th>
                <td className={numberClass}><span dir="ltr">{totals.own} + {totals.guards} / {totals.quota}</span></td>
                <td className={emptyClass(totals.quota - totals.own - totals.guards)}>
                  <span dir="ltr">{totals.quota - totals.own - totals.guards}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="max-w-[68ch] text-[0.74em] text-muted-foreground">{t('timesheet.quotas.filledHint')}</p>
      <p className="text-[0.74em] text-muted-foreground">{t('timesheet.quotas.settingsHint')}</p>
    </div>
  )
}

function DriverPostsPanel({
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
   *
   * A NEW `postCount` re-seats the draft, and it does so DURING the render that
   * carries it rather than in an effect afterwards (React's "adjusting some
   * state when a prop changes"): the effect form painted the stale number for a
   * frame first, and cost a second render to replace it. `seen` is the previous
   * prop, so the re-seat happens once per change and not on every render.
   *
   * Not `key`: resetting by key belongs to the PARENT, which would have to know
   * this panel keeps a draft at all, and it remounts the whole panel — a value
   * arriving from a refetch while the operator is still in the field would take
   * the caret and the focus with it. The draft is this component's business.
   */
  const [raw, setRaw] = useState(String(postCount))
  const [seen, setSeen] = useState(postCount)
  if (seen !== postCount) {
    setSeen(postCount)
    setRaw(String(postCount))
  }

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
