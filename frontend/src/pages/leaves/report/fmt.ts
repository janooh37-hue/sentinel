/** Shared number/date formatting for the Leaves report (prototype fmtN/fd). */

/** "12.5" / "30" — one decimal, trailing .0 trimmed. */
export const fmtN = (n: number): string => String(Math.round(n * 10) / 10)

/** App language → date locale: day-first English + UAE Arabic (the
 * convention set by the Records page, `pages/books/RecordsList.tsx`). */
export const dateLocale = (language: string): string =>
  language.startsWith('ar') ? 'ar-AE' : 'en-GB'

/** ISO "YYYY-MM-DD" (or datetime — only Y/M/D used) → UTC-anchored Date, so
 * Intl formatting with `timeZone: 'UTC'` never drifts a day in any local TZ. */
function isoToUtcDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** `Intl.DateTimeFormat` construction is expensive and these helpers run per
 * table row (hundreds per render) — cache instances by locale + pattern. */
const dtfCache = new Map<string, Intl.DateTimeFormat>()

function getDateFormatter(
  locale: string,
  pattern: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${pattern}`
  let fmt = dtfCache.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, options)
    dtfCache.set(key, fmt)
  }
  return fmt
}

/** "02 Jun" — localized day + short month (prototype `fd`). */
export function fmtDayMonth(iso: string, locale: string): string {
  return getDateFormatter(locale, 'dm', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(isoToUtcDate(iso))
}

/** "02 Jun 2026" — filed-date stamp (prototype `fdFull`). */
export function fmtDayMonthYear(iso: string, locale: string): string {
  return getDateFormatter(locale, 'dmy', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(isoToUtcDate(iso))
}

/** "June 2026" — localized month + year for group subheaders, scope labels,
 * and the month scope chip. Accepts `YYYY-MM` or any ISO date/datetime
 * (only the Y/M parts are used; UTC-anchored like the other helpers). */
export function fmtMonthYear(isoMonth: string, locale: string): string {
  const [y, m] = isoMonth.slice(0, 7).split('-').map(Number)
  return getDateFormatter(locale, 'my', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)))
}

/** ISO date + n days (UTC-safe). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
