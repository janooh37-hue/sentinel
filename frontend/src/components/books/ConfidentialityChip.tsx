/**
 * ConfidentialityChip — the record's level (Personal / Secret / Directed).
 * General is the default and renders nothing.
 */
import { Lock, Send, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Confidentiality } from '@/lib/api'
import { cn } from '@/lib/utils'

const STYLE: Record<Exclude<Confidentiality, 'general'>, { icon: typeof Lock; className: string }> = {
  personal: { icon: UserRound, className: 'bg-surface-tinted text-foreground' },
  secret: { icon: Lock, className: 'bg-destructive/10 text-destructive' },
  directed: { icon: Send, className: 'bg-info-soft text-info' },
}

export function ConfidentialityChip({
  level,
  className,
}: {
  level: Confidentiality | null | undefined
  className?: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!level || level === 'general') return null
  const { icon: Icon, className: tone } = STYLE[level]
  return (
    <span
      data-testid="confidentiality-chip"
      title={t('books.confidentiality.chipTitle', { level: t(`books.confidentiality.levels.${level}`) })}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em]',
        tone,
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" strokeWidth={2.2} aria-hidden="true" />
      {t(`books.confidentiality.levels.${level}`)}
    </span>
  )
}
