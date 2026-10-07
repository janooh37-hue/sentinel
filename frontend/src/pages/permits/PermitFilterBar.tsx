/**
 * Count tiles that double as quick filters (both permit tabs). Each tile is a
 * toggle button (`aria-pressed`); clicking the active one clears the filter.
 * The active state is a border + fill + check mark, never colour alone.
 */
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface FilterTile {
  key: string
  label: string
  /** `null` while the counts load — rendered as an em dash. */
  count: number | null
  tone?: 'success' | 'warning' | 'destructive' | 'info' | 'neutral'
}

const toneCls: Record<NonNullable<FilterTile['tone']>, string> = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  info: 'text-info',
  neutral: 'text-foreground',
}

export function PermitFilterBar({
  label,
  tiles,
  value,
  onSelect,
  className,
}: {
  label: string
  tiles: FilterTile[]
  value: string
  onSelect: (key: string | null) => void
  className?: string
}): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className={cn('grid gap-2', className)}>
      {tiles.map((tile) => {
        const active = value === tile.key
        return (
          <button
            key={tile.key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? null : tile.key)}
            className={cn(
              'relative flex min-w-0 flex-col items-start rounded-xl border px-2.5 py-2 text-start transition-colors md:px-3 md:py-2.5',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              'motion-reduce:transition-none',
              active ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:border-border-strong',
            )}
          >
            <span className={cn('font-mono text-xl font-bold tabular-nums md:text-2xl', toneCls[tile.tone ?? 'neutral'])}>
              <bdi>{tile.count ?? '—'}</bdi>
            </span>
            <span className="text-[0.72rem] leading-tight text-muted-foreground">{tile.label}</span>
            {active && (
              <Check
                className="absolute end-2 top-2 h-3.5 w-3.5 text-primary"
                strokeWidth={2.5}
                aria-hidden
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
