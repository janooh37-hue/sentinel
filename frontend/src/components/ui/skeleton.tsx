/**
 * Skeleton — animated loading placeholder (shadcn-style).
 */

import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps): React.JSX.Element {
  return (
    <div
      className={cn(
        // Directional shimmer per the design system (spacing-motion.html).
        // motion-reduce falls back to a calm pulse on a static tinted surface.
        'skeleton-shimmer rounded-md bg-surface-tinted motion-reduce:animate-pulse motion-reduce:!bg-surface-tinted',
        className,
      )}
    />
  )
}

/** A full-width card skeleton for loading list items */
export function SkeletonCard({ rows = 3 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  )
}

/** A row skeleton for table loading states */
export function SkeletonRow({ cols = 5 }: { cols?: number }): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 border-b border-border px-4 py-3">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-3 flex-1" />
      ))}
    </div>
  )
}
