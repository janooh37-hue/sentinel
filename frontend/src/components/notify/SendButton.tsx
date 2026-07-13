// frontend/src/components/notify/SendButton.tsx
//
// Unified send button — routes through WhatsApp first, falls back to SMS.
// Replaces per-channel SendWhatsAppButton + SendSmsButton at each call site;
// a single button surfaces the channel that was actually used in a badge.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sendNotify, getNotifyStatus, type NotifyStatus } from '../../lib/api'
import { useCapabilities } from '../../lib/useCapabilities'

interface Props {
  eventType: string
  recordId: number
}

export function SendButton({ eventType, recordId }: Props) {
  const { t } = useTranslation()
  const caps = useCapabilities()
  const [enabled, setEnabled] = useState(false)
  const [last, setLast] = useState<NotifyStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getNotifyStatus(eventType, recordId)
      .then((res) => {
        if (alive) {
          setEnabled(res.enabled)
          setLast(res.last)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [eventType, recordId])

  if (!caps.has('employees.notify') || !enabled) return null

  const accepted = last?.status === 'sent'
  const terminalFail =
    last?.delivery_state === 'Failed' || last?.delivery_state === 'failed'
  const delivered = accepted && !terminalFail
  const channelLabel = last?.channel ? t(`notify.channel.${last.channel}`) : ''

  async function onClick() {
    if (accepted && !window.confirm(t('notify.confirmResend'))) return
    setBusy(true)
    setError(null)
    try {
      const res = await sendNotify(eventType, recordId)
      if (res.status === 'sent' || res.status === 'queued') {
        setLast({
          ...(last as NotifyStatus),
          status: res.status as NotifyStatus['status'],
          channel: (res.channel as NotifyStatus['channel']) ?? null,
          delivery_state: null,
          error: null,
          created_at: new Date().toISOString(),
          event_type: eventType,
          event_ref: `${eventType}:${recordId}`,
          fell_back: false,
          fallback_reason: null,
          language: last?.language ?? 'ar',
          id: last?.id ?? 0,
        })
      } else {
        setError(res.error ?? t('notify.failed'))
      }
    } catch {
      setError(t('notify.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={onClick} disabled={busy} title={t('notify.sendTitle')}>
        {busy ? t('notify.sending') : accepted ? t('notify.resend') : t('notify.send')}
      </button>
      {delivered && !error && (
        <span aria-label={`sent ${last?.channel ?? ''}`}>&#10003; {channelLabel}</span>
      )}
      {error && (
        <span role="alert" title={error}>
          &#9888; {t('notify.failed')}
        </span>
      )}
    </span>
  )
}
