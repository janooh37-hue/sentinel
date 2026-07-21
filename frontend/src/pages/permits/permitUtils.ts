/**
 * Shared presentation helpers for the Security Permits module — badge tones,
 * i18n key mapping, and a couple of small formatters. Kept framework-free so
 * both the table and the detail dialog stay consistent.
 */
import type { PermitDerivedStatus, PermitZone } from '@/lib/api'

type Tone = 'neutral' | 'active' | 'warning' | 'danger' | 'info' | 'outline'

export function statusTone(status: PermitDerivedStatus): Tone {
  switch (status) {
    case 'active':
      return 'active'
    case 'expiring':
      return 'warning'
    case 'expired':
      return 'danger'
    case 'revoked':
      return 'neutral'
  }
}

export function zoneTone(zone: PermitZone): Tone {
  switch (zone) {
    case 'green':
      return 'active'
    case 'red':
      return 'danger'
    case 'both':
      return 'info'
  }
}

/** ISO date (YYYY-MM-DD or full timestamp) → locale-agnostic YYYY-MM-DD. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

/** Today as YYYY-MM-DD, for date-input `min` bounds. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
