// frontend/src/components/whatsapp/SendWhatsAppButton.tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  sendWhatsApp, getWhatsAppStatus,
  type WhatsAppEventType, type WhatsAppStatus,
} from '../../lib/api'
import { useCapabilities } from '../../lib/useCapabilities'

interface Props {
  eventType: WhatsAppEventType
  recordId: number
}

export function SendWhatsAppButton({ eventType, recordId }: Props) {
  const { t } = useTranslation()
  const caps = useCapabilities()
  const [last, setLast] = useState<WhatsAppStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getWhatsAppStatus(eventType, recordId)
      .then((s) => { if (alive) setLast(s) })
      .catch(() => {})
    return () => { alive = false }
  }, [eventType, recordId])

  if (!caps.has('employees.notify')) return null

  const alreadySent = last?.status === 'sent'

  async function onClick() {
    if (alreadySent && !window.confirm(t('whatsapp.confirmResend'))) return
    setBusy(true); setError(null)
    try {
      const res = await sendWhatsApp(eventType, recordId)
      if (res.status === 'sent') {
        setLast({
          ...(last as WhatsAppStatus),
          status: 'sent',
          error: null,
          created_at: new Date().toISOString(),
          event_type: eventType,
          event_ref: `${eventType}:${recordId}`,
          language: last?.language ?? 'ar',
        })
      } else {
        setError(res.error ?? t('whatsapp.failed'))
      }
    } catch {
      setError(t('whatsapp.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={onClick} disabled={busy}
              title={t('whatsapp.sendTitle')}>
        {busy ? t('whatsapp.sending')
          : alreadySent ? t('whatsapp.resend')
          : t('whatsapp.send')}
      </button>
      {alreadySent && !error && <span aria-label="sent">&#10003;</span>}
      {error && <span role="alert" title={error}>&#9888; {t('whatsapp.failed')}</span>}
    </span>
  )
}
