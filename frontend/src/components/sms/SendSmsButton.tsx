// frontend/src/components/sms/SendSmsButton.tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  sendSms, getSmsStatus,
  type SmsEventType, type SmsStatus,
} from '../../lib/api'
import { useCapabilities } from '../../lib/useCapabilities'

interface Props {
  eventType: SmsEventType
  recordId: number
}

export function SendSmsButton({ eventType, recordId }: Props) {
  const { t } = useTranslation()
  const caps = useCapabilities()
  const [enabled, setEnabled] = useState(false)
  const [last, setLast] = useState<SmsStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getSmsStatus(eventType, recordId)
      .then((res) => { if (alive) { setEnabled(res.enabled); setLast(res.last) } })
      .catch(() => {})
    return () => { alive = false }
  }, [eventType, recordId])

  if (!caps.has('employees.notify') || !enabled) return null

  const delivered = last?.status === 'sent' && last?.delivery_state !== 'Failed'
  const alreadySent = last?.status === 'sent'

  async function onClick() {
    if (alreadySent && !window.confirm(t('sms.confirmResend'))) return
    setBusy(true); setError(null)
    try {
      const res = await sendSms(eventType, recordId)
      if (res.status === 'sent') {
        setLast({
          ...(last as SmsStatus),
          status: 'sent',
          delivery_state: null,
          error: null,
          created_at: new Date().toISOString(),
          event_type: eventType,
          event_ref: `${eventType}:${recordId}`,
          language: last?.language ?? 'ar',
        })
      } else {
        setError(res.error ?? t('sms.failed'))
      }
    } catch {
      setError(t('sms.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={onClick} disabled={busy}
              title={t('sms.sendTitle')}>
        {busy ? t('sms.sending')
          : alreadySent ? t('sms.resend')
          : t('sms.send')}
      </button>
      {delivered && !error && <span aria-label="sent">&#10003;</span>}
      {error && <span role="alert" title={error}>&#9888; {t('sms.failed')}</span>}
    </span>
  )
}
