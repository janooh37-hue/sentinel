/**
 * InsightLine — one muted, scope-aware stats line under the folio.
 * Computed from in-scope rows only (no fabricated stats): sick share of
 * absence days (clickable → Sick Leave kind filter) + busiest month.
 * Numbers render mono (prototype `.mono` spans). Renders nothing when the
 * scope has no absence days.
 */
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type { Insights } from './reportData'

interface InsightLineProps {
  insights: Insights
  /** Localized busiest-month label (e.g. "June") — null hides the clause. */
  monthLabel: string | null
  /** True while the Sick Leave kind filter is on (the clause is a toggle). */
  sickActive: boolean
  onSickClick: () => void
}

/** Wrap numeric runs (e.g. "38%") in mono/tabular spans, LTR-isolated so
 * "50%" never reorders in RTL — mirrors the prototype's `.mono` markup. */
function MonoNumbers({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/(\d+(?:[.,]\d+)?%?)/)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} dir="ltr" className="font-mono text-[0.96em] font-semibold tabular-nums text-foreground">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

export function InsightLine({
  insights,
  monthLabel,
  sickActive,
  onSickClick,
}: InsightLineProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (insights.totalDays === 0) return null

  const pct = Math.round(insights.sickSharePct)

  return (
    <p className="text-[0.82em] text-muted-foreground">
      <button
        type="button"
        aria-pressed={sickActive}
        onClick={onSickClick}
        className={cn(
          'rounded-sm underline-offset-4 transition-colors hover:text-primary hover:underline motion-reduce:transition-none',
          sickActive
            ? 'font-semibold text-primary underline decoration-solid'
            : 'decoration-dotted',
        )}
      >
        <MonoNumbers text={t('leaves.report.insightSick', { pct })} />
      </button>
      {monthLabel !== null && (
        <>
          <span className="mx-2 text-faint" aria-hidden="true">
            ·
          </span>
          <span>{t('leaves.report.insightBusiest', { month: monthLabel })}</span>
        </>
      )}
    </p>
  )
}
