/**
 * PurposeMark — why a book was sent to you (info / action / reply / circulate).
 * A bare glyph, never a chip, so it never reads as GradeChip. The glyph shape
 * carries the meaning; the tone only helps scanning.
 *
 * By default it is icon only: `role="img"` named by the purpose (the name joins
 * a row button's accessible name) with a hover tooltip, never focusable, since
 * it sits inside row `<button>`s. `showLabel` adds the visible label instead,
 * for the record header line.
 */
import { ClipboardCheck, Eye, Megaphone, MessageSquareReply } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { SendPurpose } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MARK_ICON_CLASS, MARK_STROKE_WIDTH } from './markSize'

const MARK: Record<SendPurpose, { icon: typeof Eye; tone: string }> = {
  info: { icon: Eye, tone: 'text-muted-foreground' },
  action: { icon: ClipboardCheck, tone: 'text-primary' },
  reply: { icon: MessageSquareReply, tone: 'text-warning rtl:-scale-x-100' },
  circulate: { icon: Megaphone, tone: 'text-success rtl:-scale-x-100' },
}

export function PurposeMark({ purpose, showLabel = false, className }: {
  purpose: SendPurpose
  /** Show the label beside the glyph (record header line). */
  showLabel?: boolean
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const { icon: Icon, tone } = MARK[purpose]
  const label = t(`books.send.purposes.${purpose}`)
  const glyph = <Icon className={cn(MARK_ICON_CLASS, tone)} strokeWidth={MARK_STROKE_WIDTH} aria-hidden="true" />
  if (showLabel) {
    return (
      <span data-purpose={purpose} className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', purpose === 'action' ? 'font-semibold' : 'font-medium', className)}>
        {glyph}
        {label}
      </span>
    )
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span role="img" data-purpose={purpose} aria-label={label} className={cn('inline-flex shrink-0 items-center', className)}>{glyph}</span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
