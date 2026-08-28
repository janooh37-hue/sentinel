/**
 * ServiceTile — Quick Action tile for the Dashboard service grid.
 *
 * Uniform navy top border (4 px) per the locked spec — every service rail
 * uses the same primary accent to keep visual weight even across the row.
 * Calibrated artwork keeps that same lift and adds one restrained semantic gesture.
 */

import { cn } from '@/lib/utils'
import { ServiceArtwork, type ServiceArtworkId } from './service-artwork'

export interface ServiceTileProps {
  emoji: string
  artwork?: ServiceArtworkId
  title: string
  description: string
  onClick: () => void
  className?: string
}

export function ServiceTile({
  emoji,
  artwork,
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
        'service-tile cursor-pointer group relative flex h-full min-h-[190px] w-full flex-col overflow-hidden rounded-2xl bg-surface p-5 text-start',
        'border-t-[4px] border-t-primary',
        'transition-all duration-200 hover:-translate-y-1 hover:shadow-lg focus-visible:-translate-y-1 focus-visible:shadow-lg motion-reduce:!translate-none motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      <span className="block w-14 transition-transform duration-300 group-hover:-translate-y-1.5 group-focus-visible:-translate-y-1.5 motion-reduce:!translate-none motion-reduce:transition-none">
        {artwork ? (
          <ServiceArtwork artwork={artwork} />
        ) : (
          <span className="text-[2em] leading-none" aria-hidden="true">
            {emoji}
          </span>
        )}
      </span>
      <h4 className="mt-3 text-[0.95em] font-semibold tracking-tight text-foreground">
        {title}
      </h4>
      <p className="mt-1 text-[0.72em] leading-relaxed text-muted-foreground">{description}</p>
    </button>
  )
}
