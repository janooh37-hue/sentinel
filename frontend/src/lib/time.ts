/**
 * Time helpers shared across the app.
 */

/**
 * Parse a backend timestamp as UTC. The API serializes naive-UTC datetimes
 * without an offset suffix ("2026-06-10T12:06:56"), which `Date.parse` would
 * treat as LOCAL time — skewing "Updated N ago" by the UTC offset (browser-
 * verified: a sync 1 minute old read "4h ago" on a UTC+4 machine). Append "Z"
 * when no offset is present so the value parses as the UTC instant it is.
 */
export function parseUtcMs(iso: string): number {
  return Date.parse(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`)
}
