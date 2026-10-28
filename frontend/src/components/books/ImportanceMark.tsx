/**
 * ImportanceMark — how much a record matters (high / medium), as a bare glyph.
 * High is red with a slow pulse (steady under reduced motion); medium is a
 * static caution glyph of a different shape, so shape alone tells them apart.
 *
 * Inside a row `<button>` it must not be interactive (nested interactive
 * content is invalid), so it is `role="img"` whose label joins the row's
 * accessible name, with a hover tooltip. Standalone (`interactive`) it is a
 * focusable trigger whose tooltip opens on hover, focus and tap.
 */
import { useState } from 'react'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type Importance = 'medium' | 'high'

const LEDGER_BOOK = 'Ledger Book'

/**
 * D7 display mapping. A Ledger Book shows its own importance; any other record
 * borrows from urgency (Normal/High → medium, Very High → high).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function importanceOf(book: {
  current_template_id?: string | null
  importance?: Importance | null
  urgency?: string | null
}): Importance | null {
  if (book.current_template_id === LEDGER_BOOK) return book.importance ?? null
  switch (book.urgency) {
    case 'Normal':
    case 'High':
      return 'medium'
    case 'Very High':
      return 'high'
    default:
      return null
  }
}

const MARK: Record<Importance, { icon: typeof TriangleAlert; tone: string }> = {
  high: { icon: TriangleAlert, tone: 'text-destructive gssg-importance-pulse' },
  medium: { icon: CircleAlert, tone: 'text-caution' },
}

export function ImportanceMark({ importance, interactive = false, className }: {
  importance: Importance | null | undefined
  /** Standalone (not inside a button): a focusable tooltip trigger. */
  interactive?: boolean
  className?: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!importance) return null
  const { icon: Icon, tone } = MARK[importance]
  const label = `${t('books.importance.label')}: ${t(`books.importance.${importance}`)}`
  const glyph = <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
  const markClass = cn('inline-flex shrink-0 items-center', tone, className)
  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          {interactive ? (
            <button
              type="button"
              data-importance={importance}
              aria-label={label}
              onClick={(event) => { event.preventDefault(); setOpen(true) }}
              className={cn(markClass, 'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
            >
              {glyph}
            </button>
          ) : (
            <span role="img" data-importance={importance} aria-label={label} className={markClass}>{glyph}</span>
          )}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
