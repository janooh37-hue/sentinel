/**
 * PurposeMark — why a book was sent to you (info / action / reply / circulate).
 * Bare glyph + label, never a chip, so it never reads as GradeChip.
 * The glyph shape and the label carry the meaning; the tone only helps scanning.
 */
import { ClipboardCheck, Eye, Megaphone, MessageSquareReply } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SendPurpose } from '@/lib/api'
import { cn } from '@/lib/utils'

const MARK: Record<SendPurpose, { icon: typeof Eye; tone: string }> = {
  info: { icon: Eye, tone: 'text-muted-foreground' },
  action: { icon: ClipboardCheck, tone: 'text-primary' },
  reply: { icon: MessageSquareReply, tone: 'text-warning rtl:-scale-x-100' },
  circulate: { icon: Megaphone, tone: 'text-success rtl:-scale-x-100' },
}

export function PurposeMark({ purpose, className }: { purpose: SendPurpose; className?: string }): React.JSX.Element {
  const { t } = useTranslation()
  const { icon: Icon, tone } = MARK[purpose]
  return (
    <span data-purpose={purpose} className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', purpose === 'action' ? 'font-semibold' : 'font-medium', className)}>
      <Icon className={cn('h-4 w-4 shrink-0', tone)} strokeWidth={1.8} aria-hidden="true" />
      {t(`books.send.purposes.${purpose}`)}
    </span>
  )
}
