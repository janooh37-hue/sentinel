export type SmsDeliveryTone = 'delivered' | 'failed' | 'pending'

/** Collapse (send-time status, gateway delivery_state) into one badge tone.
 *  A send can be accepted (status='sent') yet fail at the SIM
 *  (delivery_state='Failed') — that must read as failed, not done. */
export function smsDeliveryTone(
  m: { status: string; delivery_state?: string | null },
): SmsDeliveryTone {
  if (m.delivery_state === 'Delivered') return 'delivered'
  if (m.delivery_state === 'Failed' || m.status === 'failed') return 'failed'
  return 'pending'
}
