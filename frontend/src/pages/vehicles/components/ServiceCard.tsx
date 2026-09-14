/**
 * ServiceCard — one tile of the Vehicle Services hub: distinct artwork, a live
 * count pill, a title and one line of description.
 *
 * The artwork uses the shared calibrated service pictogram set from
 * `components/ui/service-artwork.tsx`, chosen so the hub reads like the
 * Services gallery.
 *
 * Renders as a `<Link>` when the card leads to a route and as a `<button>`
 * when it opens a dialog or filters the ledger in place, so a route card
 * supports middle-click and "open in new tab" like any other link.
 */

import { Link } from 'react-router-dom'

import { ServiceArtwork, type ServiceArtworkId } from '@/components/ui/service-artwork'
import { cn } from '@/lib/utils'

interface ServiceCardProps {
  artwork: ServiceArtworkId
  title: string
  description: string
  /** Live figure — a plain count, or a composed run like «12 · 3,400 AED». */
  count: React.ReactNode
  /** Accessible name for the count pill (it is a bare number on screen). */
  countLabel: string
  /** Route target. Mutually exclusive with `onClick`. */
  to?: string
  onClick?: () => void
  className?: string
}

const CARD_CLASS = cn(
  'group relative flex min-h-[152px] w-full flex-col overflow-hidden rounded-[15px]',
  'border border-border bg-surface p-[15px] text-start',
  'transition-[transform,border-color,box-shadow] duration-150',
  'hover:-translate-y-[3px] hover:border-border-strong hover:shadow-[0_12px_24px_rgba(13,40,69,0.09)]',
  'focus-visible:-translate-y-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:focus-visible:translate-y-0',
)

export function ServiceCard({
  artwork,
  title,
  description,
  count,
  countLabel,
  to,
  onClick,
  className,
}: ServiceCardProps): React.JSX.Element {
  const body = (
    <>
      <ServiceArtwork artwork={artwork} className="mb-3.5" />
      {/* `aria-label` here would REPLACE the pill's content in the
          accessibility tree, so the figure itself — «12 · 3,400 AED» — would
          never be announced. The name is prepended as screen-reader-only text
          instead, leaving the count readable: "Fines: 12 · 3,400 AED". */}
      <span className="absolute end-3.5 top-3.5 min-w-[26px] rounded-full bg-surface-tinted px-1.5 py-1 text-center font-mono text-[0.62rem] font-semibold tabular-nums text-primary">
        <span className="sr-only">{countLabel}: </span>
        <bdi>{count}</bdi>
      </span>
      <span className="mb-1 block text-[0.86rem] font-semibold tracking-tight text-primary">
        {title}
      </span>
      <span className="block text-[0.67rem] leading-relaxed text-muted-foreground">
        {description}
      </span>
    </>
  )

  if (to) {
    return (
      <Link to={to} className={cn(CARD_CLASS, className)}>
        {body}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cn(CARD_CLASS, className)}>
      {body}
    </button>
  )
}
