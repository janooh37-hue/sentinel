/**
 * ServiceCard — one tile of the Vehicle Services hub: distinct artwork, a live
 * count pill, a title and one line of description.
 *
 * The artwork is the mockup's own line-and-flat-fill set, inlined as SVG.
 * Per-service iconography is deliberate wayfinding (PRODUCT.md principle 1):
 * an operator finds "Accident Report" by its shape before reading the label.
 * The fills are illustration colours, not theme tokens — the same reasoning
 * `fileTypes.ts` uses for file-type accents — while the strokes and every
 * piece of text stay on the design system.
 *
 * Renders as a `<Link>` when the card leads to a route and as a `<button>`
 * when it opens a dialog or filters the ledger in place, so a route card
 * supports middle-click and "open in new tab" like any other link.
 */

import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

export type ServiceIconId = 'fines' | 'renew' | 'accident' | 'maintenance' | 'vehicle' | 'sites'

/** Artwork bodies, drawn on a 64×64 canvas under one shared stroke group. */
const ICON_ART: Record<ServiceIconId, React.JSX.Element> = {
  fines: (
    <>
      <rect x="13" y="10" width="34" height="42" rx="5" fill="#fff4cf" />
      <path d="M20 22h20M20 30h20M20 38h12" />
      <circle cx="46" cy="45" r="10" fill="#20b8a6" />
      <path d="m42 45 3 3 6-7" />
    </>
  ),
  renew: (
    <>
      <path d="M14 34a18 18 0 1 0 5-13" fill="#dff3ff" />
      <path d="M11 13v12h12" />
      <rect x="25" y="23" width="20" height="25" rx="4" fill="#ffc928" />
      <path d="M30 31h10M30 37h8" />
    </>
  ),
  accident: (
    <>
      <path d="M8 40h48l-5-14H18L8 40Z" fill="#2f6fed" />
      <path d="M11 40h43v12H11Z" fill="#20b8a6" />
      <circle cx="20" cy="51" r="6" fill="#ffc928" />
      <circle cx="46" cy="51" r="6" fill="#ffc928" />
      <path d="m34 10 5 10 9-6-5 13" stroke="#c8102e" />
    </>
  ),
  maintenance: (
    <>
      <path
        d="M18 12a13 13 0 0 0 17 17L20 44a7 7 0 1 0 10 10l15-15a13 13 0 0 0 17-17l-10 10-9-9 10-10a13 13 0 0 0-18 16"
        fill="#dff3ff"
      />
      <circle cx="25" cy="49" r="3" fill="#ffc928" />
    </>
  ),
  vehicle: (
    <>
      <path d="M9 39h46l-5-14H19L9 39Z" fill="#2f6fed" />
      <path d="M12 39h41v14H12Z" fill="#20b8a6" />
      <circle cx="20" cy="52" r="6" fill="#ffc928" />
      <circle cx="46" cy="52" r="6" fill="#ffc928" />
      <path d="M32 8v18M23 17h18" />
    </>
  ),
  sites: (
    <>
      <path d="M32 58S13 41 13 25a19 19 0 1 1 38 0c0 16-19 33-19 33Z" fill="#2f6fed" />
      <circle cx="32" cy="25" r="8" fill="#ffc928" />
      <path d="M7 58h50" />
    </>
  ),
}

interface ServiceCardProps {
  icon: ServiceIconId
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
  icon,
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
      <span className="mb-3.5 grid h-12 w-12 place-items-center rounded-[13px] bg-primary-soft">
        <svg viewBox="0 0 64 64" aria-hidden className="h-10 w-10">
          <g
            stroke="#102a43"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          >
            {ICON_ART[icon]}
          </g>
        </svg>
      </span>
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
