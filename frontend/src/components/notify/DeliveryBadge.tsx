import { AlertTriangle, Check, Clock, MinusCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { skippedLabelKey, smsDeliveryTone, type SkipReason } from '@/lib/smsDelivery'
import { cn } from '@/lib/utils'

const TONES = {
  delivered: { cls: 'bg-success-soft text-success', Icon: Check },
  failed: { cls: 'bg-destructive/10 text-destructive', Icon: AlertTriangle },
  pending: { cls: 'bg-warning/10 text-warning', Icon: Clock },
  // Not attempted by choice: neutral, never styled as an error.
  skipped: { cls: 'bg-muted text-muted-foreground', Icon: MinusCircle },
} as const

/** Delivery status pill for a persisted employee message (book record rail, employee Messages tab). */
export function DeliveryBadge({ message, className }: {
  message: { status: string; delivery_state?: string | null; skip_reason?: SkipReason }
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const tone = smsDeliveryTone(message)
  const { cls, Icon } = TONES[tone]
  const label = tone === 'skipped' ? t(skippedLabelKey(message.skip_reason)) : t(`employee.messages.${tone}`)
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full py-0.5 font-semibold', cls, className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  )
}
