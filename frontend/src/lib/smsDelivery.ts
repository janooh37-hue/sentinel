export type SmsDeliveryTone = 'delivered' | 'failed' | 'pending' | 'skipped'
export type SkipReason = 'default_off' | 'user_off' | null | undefined

/** Collapse (send-time status, gateway delivery_state) into one badge tone.
 *  A send can be accepted (status='sent') yet fail at the SIM
 *  (delivery_state='Failed') — that must read as failed, not done. A skipped
 *  message was never attempted, so it is neither failed nor pending. */
export function smsDeliveryTone(
  m: { status: string; delivery_state?: string | null },
): SmsDeliveryTone {
  if (m.status === 'skipped') return 'skipped'
  if (m.delivery_state === 'Delivered') return 'delivered'
  if (m.delivery_state === 'Failed' || m.status === 'failed') return 'failed'
  return 'pending'
}

/** i18n key explaining why a message was not sent. */
export function skippedLabelKey(reason: SkipReason): string {
  if (reason === 'default_off') return 'notify.skipped.defaultOff'
  if (reason === 'user_off') return 'notify.skipped.userOff'
  return 'notify.skipped.generic'
}
