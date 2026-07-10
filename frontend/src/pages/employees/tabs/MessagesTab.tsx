/** Messages tab — SMS notifications sent to this employee (sent / failed / delivered). */
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, AlertTriangle, Clock } from 'lucide-react'
import type { SmsMessageRead } from '@/lib/api'
import { refreshSmsDelivery } from '@/lib/api'
import { smsDeliveryTone } from '@/lib/smsDelivery'
import { useCapabilities } from '@/lib/useCapabilities'

interface Props {
  messages: SmsMessageRead[]
  /** Called after a re-check resolves — parent should invalidate its query. */
  onRecheck?: (smsId: number) => Promise<void>
}

export function MessagesTab({ messages, onRecheck }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const caps = useCapabilities()
  const canRecheck = caps.has('books.manage')
  const fmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )
  // Track which row is currently re-checking.
  const [recheckingId, setRecheckingId] = useState<number | null>(null)

  if (messages.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-12 text-center text-muted-foreground">
        {t('employee.messages.empty')}
      </div>
    )
  }

  async function handleRecheck(smsId: number) {
    setRecheckingId(smsId)
    try {
      await refreshSmsDelivery(smsId)
      await onRecheck?.(smsId)
    } catch {
      // Silently ignore — badge stays pending.
    } finally {
      setRecheckingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) => {
        const tone = smsDeliveryTone(m)
        const badge = {
          delivered: {
            cls: 'bg-success-soft text-success',
            icon: <Check className="h-3 w-3" />,
            label: t('employee.messages.delivered'),
          },
          failed: {
            cls: 'bg-destructive/10 text-destructive',
            icon: <AlertTriangle className="h-3 w-3" />,
            label: t('employee.messages.failed'),
          },
          pending: {
            cls: 'bg-warning/10 text-warning',
            icon: <Clock className="h-3 w-3" />,
            label: t('employee.messages.pending'),
          },
        }[tone]
        const isRecheckingThis = recheckingId === m.id
        return (
          <div key={m.id} className="rounded-xl border border-hairline bg-surface p-4">
            <div className="mb-1.5 flex items-center gap-2 text-[0.78em]">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${badge.cls}`}>
                {badge.icon}
                {badge.label}
              </span>
              <span className="font-mono text-muted-foreground">{m.phone}</span>
              <span className="ms-auto font-mono text-muted-foreground">{fmt.format(new Date(m.created_at))}</span>
              {tone === 'pending' && canRecheck && (
                <button
                  type="button"
                  aria-label={`${t('employee.messages.recheck')} ${m.phone}`}
                  disabled={isRecheckingThis}
                  onClick={() => { void handleRecheck(m.id) }}
                  className="ms-1 rounded px-1.5 py-0.5 text-[0.85em] font-medium text-muted-foreground hover:bg-surface-tinted disabled:opacity-50"
                >
                  {isRecheckingThis ? t('employee.messages.rechecking') : t('employee.messages.recheck')}
                </button>
              )}
            </div>
            {m.body && <div className="whitespace-pre-wrap text-[0.9em] text-foreground" dir="auto">{m.body}</div>}
            {tone === 'failed' && m.error && <div className="mt-1 text-[0.8em] text-destructive" dir="ltr">{m.error}</div>}
          </div>
        )
      })}
    </div>
  )
}
