/**
 * Color-coded pill for leave status values — TAMM vocabulary.
 *
 * Generated → neutral surface-tinted
 * Pending   → warning-soft / warning
 * Approved  → success-soft / success
 * Rejected  → accent-soft / accent
 *
 * When `leaveType` is provided the badge renders the per-kind display state
 * (Recorded / Requested / Scheduled…) derived from `lifecycle.displayState`.
 * Legacy no-kind callers keep working unchanged.
 *
 * Rendered as a rounded-full pill with a leading dot for quick scan parity
 * with the rest of the TAMM design system (matches §6.4 chips/pills/dots).
 */

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { englishPart, splitBilingual } from '@/lib/bilingualValue'
import type { LeaveStatus } from '@/lib/api'
import { displayState, type DisplayState } from './lifecycle'

type Tone = 'neutral' | 'warning' | 'success' | 'accent'

const TONE_MAP: Record<LeaveStatus, Tone> = {
  Pending: 'warning',
  Approved: 'success',
  Rejected: 'accent',
  Cancelled: 'neutral',
  Completed: 'neutral',
}

const STATE_TONES: Record<DisplayState, Tone> = {
  Recorded: 'neutral',
  Requested: 'warning',
  Confirmed: 'success',
  PreApproved: 'success',
  Scheduled: 'neutral',
  AwaitingCertificate: 'warning',
  AwaitingReturn: 'warning',
  Completed: 'success',
  Rejected: 'accent',
  Cancelled: 'neutral',
  Unknown: 'neutral',
}

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-surface-tinted text-muted-foreground',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
  accent: 'bg-accent-soft text-accent',
}

interface StatusBadgeProps {
  status: string
  /** When provided (with endDate), the badge renders the per-kind display
   * state (Recorded / Requested / Scheduled…) instead of the raw status. */
  leaveType?: string
  endDate?: string
  /** NS rows: whether a certificate is on file — distinguishes
   * AwaitingReturn from AwaitingCertificate. */
  hasCertificate?: boolean
}

export function StatusBadge({ status, leaveType, endDate, hasCertificate }: StatusBadgeProps): React.JSX.Element {
  const { t, i18n } = useTranslation()

  if (leaveType !== undefined) {
    const todayIso = new Date().toISOString().slice(0, 10)
    const state = displayState(leaveType, status, endDate ?? '9999-12-31', todayIso, hasCertificate ?? false)
    const tone = STATE_TONES[state]
    const label = t(`leaves.display.${state}`)
    return (
      <span
        aria-label={`state-${state}`}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em] whitespace-nowrap',
          TONE_CLASSES[tone],
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
        {label}
      </span>
    )
  }

  // Legacy path: no leaveType provided — render raw status with TONE_MAP.
  // `status` may arrive as a concatenated bilingual string (e.g.
  // "Pending - انتظار"); normalise to the English part so the tone/enum match,
  // and display the locale-appropriate side.
  const enStatus = englishPart(status)
  const tone = TONE_MAP[enStatus as LeaveStatus] ?? 'neutral'
  const label = t(`leaves.status.${enStatus}`, {
    defaultValue: splitBilingual(status, i18n.language),
  })
  return (
    <span
      aria-label={`status-${enStatus}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em] whitespace-nowrap',
        TONE_CLASSES[tone],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  )
}
