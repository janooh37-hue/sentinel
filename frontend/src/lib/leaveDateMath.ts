/**
 * Pure date helpers for leave forms.
 *
 * v3 parity: leave counting is inclusive. A 1-day leave starting on
 * 2026-05-20 ends on 2026-05-20. A 5-day leave starting on 2026-05-20
 * ends on 2026-05-24.
 *
 * All math is done in UTC to dodge the local-timezone / DST trap that
 * makes naive `new Date('YYYY-MM-DD')` math return wrong dates near
 * midnight in positive UTC offsets (the UAE is UTC+4).
 */

function parseIsoDateUtc(iso: string): Date {
  // iso is "YYYY-MM-DD" — append explicit UTC midnight.
  return new Date(`${iso}T00:00:00Z`)
}

function isoFromUtc(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function computeEndDate(start: string, days: number): string {
  if (!start || days < 1) return ''
  const d = parseIsoDateUtc(start)
  d.setUTCDate(d.getUTCDate() + (days - 1))
  return isoFromUtc(d)
}

export function computeDaysBetween(start: string, end: string): number {
  if (!start || !end) return 0
  const ms = parseIsoDateUtc(end).getTime() - parseIsoDateUtc(start).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1
}

export function todayIso(): string {
  const now = new Date()
  // Anchor to local calendar day, then format as ISO.
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
