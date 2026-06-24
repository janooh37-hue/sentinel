/**
 * ServiceTile — Quick Action tile for the Dashboard service grid.
 *
 * Uniform navy top border (4 px) per the locked spec — every service rail
 * uses the same primary accent to keep visual weight even across the row.
 * Emoji "bobs" on hover; card lifts + shadows.
 */

import { cn } from '@/lib/utils'

export interface ServiceTileProps {
  emoji: string
  title: string
  description: string
  onClick: () => void
  className?: string
}

export function ServiceTile({
  emoji,
  title,
  description,
  onClick,
  className,
}: ServiceTileProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'cursor-pointer group relative flex h-full min-h-[190px] w-full flex-col overflow-hidden rounded-2xl bg-surface p-5 text-start',
        'border-t-[4px] border-t-primary',
        'transition-all duration-200 hover:-translate-y-1 hover:shadow-lg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      <span
        className="inline-block text-[2em] leading-none transition-transform duration-300 group-hover:-translate-y-1.5 motion-reduce:!transform-none motion-reduce:transition-none"
        aria-hidden="true"
      >
        {emoji}
      </span>
      <h4 className="mt-3 text-[0.95em] font-semibold tracking-tight text-foreground">
        {title}
      </h4>
      <p className="mt-1 text-[0.72em] leading-relaxed text-muted-foreground">{description}</p>
    </button>
  )
}
