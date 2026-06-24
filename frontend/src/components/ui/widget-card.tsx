/**
 * WidgetCard — small dashboard widget in the TAMM-detail vocabulary.
 *
 * Layout (top-to-bottom):
 *   • header chip + optional delta pill
 *   • big number (display-size)
 *   • breakdown table (color-dotted rows with right-aligned values)
 *   • action row: optional meta line + primary "→" action link
 *
 * The entire surface is a button so the whole card is clickable.
 */

import { cn } from '@/lib/utils'

export type DeltaTone = 'good' | 'warn' | 'steady'
export type BreakdownColor = 'primary' | 'accent' | 'success' | 'warning'

export interface BreakdownRow {
  color: BreakdownColor
  label: string
  value: number | string
}

export interface WidgetCardProps {
  header: string
  big: number | string
  delta?: { tone: DeltaTone; label: string }
  breakdown?: BreakdownRow[]
  meta?: string
  actionLabel: string
  onAction: () => void
  className?: string
}

const DOT_BG: Record<BreakdownColor, string> = {
  primary: 'bg-primary',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
}

const DELTA_CLS: Record<DeltaTone, string> = {
  good: 'bg-success-soft text-success',
  warn: 'bg-accent-soft text-accent',
  steady: 'bg-surface-tinted text-muted-foreground',
}

export function WidgetCard({
  header,
  big,
  delta,
  breakdown = [],
  meta,
  actionLabel,
  onAction,
  className,
}: WidgetCardProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onAction}
      aria-label={header}
      className={cn(
        'group relative flex h-full w-full flex-col rounded-2xl bg-surface p-5 text-start',
        'transition-all duration-200 hover:-translate-y-1 hover:shadow-lg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      {/* Header row — use items-center + min-h so the small status pill
          aligns visually with the larger header label regardless of pill
          padding, and the row has a stable height across cards. */}
      <div className="flex min-h-[28px] items-center justify-between gap-3">
        <span className="text-[0.86em] font-medium leading-tight text-muted-foreground">{header}</span>
        {delta && (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-1 text-[0.72em] font-semibold leading-none',
              DELTA_CLS[delta.tone],
            )}
          >
            {delta.label}
          </span>
        )}
      </div>

      <div className="mt-1.5 text-[2.4em] font-bold leading-none tracking-tight text-foreground tabular-nums">
        {big}
      </div>

      {breakdown.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 border-t border-hairline pt-3 text-[0.78em] text-muted-foreground">
          {breakdown.map((row) => (
            <div key={`${row.color}-${row.label}`} className="flex items-center gap-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full', DOT_BG[row.color])} aria-hidden />
              <span>{row.label}</span>
              <span className="ms-auto font-mono font-semibold text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-3.5 text-[0.78em]">
        {meta ? <span className="text-[0.72em] text-muted-foreground">{meta}</span> : <span />}
        <span className="ms-auto inline-flex items-center gap-1 font-semibold text-primary transition-colors duration-200 group-hover:text-primary-hover">
          {actionLabel}
          <span
            aria-hidden
            className="inline-block transition-transform duration-200 ltr:group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180 motion-reduce:!transform-none"
          >
            →
          </span>
        </span>
      </div>
    </button>
  )
}
