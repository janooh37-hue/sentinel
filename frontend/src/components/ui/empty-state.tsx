/**
 * EmptyState — consistent placeholder for empty list views.
 * Usage: <EmptyState icon={FileText} message="No employees found" action={...} />
 */

import { type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  message: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  className?: string
  /**
   * Opt-in one-shot reveal (icon settle → text fade-up). Reserved for rare,
   * first-time-ish surfaces (e.g. the empty notifications inbox) where a touch
   * of personality is welcome; off by default so high-frequency empty lists
   * stay calm. Reduced-motion guarded in index.css.
   */
  animated?: boolean
}

export function EmptyState({
  icon: Icon,
  message,
  description,
  actionLabel,
  onAction,
  className,
  animated = false,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-16 text-center',
        animated && 'anim-empty',
        className,
      )}
    >
      {Icon && (
        <div className={cn(
          'flex h-12 w-12 items-center justify-center rounded-full bg-surface-tinted ring-1 ring-border',
          animated && 'anim-empty-icon',
        )}>
          <Icon className="h-5 w-5 text-foreground/60" strokeWidth={1.4} />
        </div>
      )}
      <div className={cn('flex flex-col gap-1', animated && 'anim-empty-text')}>
        <p className="text-sm font-medium text-foreground">{message}</p>
        {description && (
          <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
