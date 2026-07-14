/**
 * normaliseSubject — strip reply/forward prefixes off an email subject so two
 * subjects that belong to the same thread compare equal.
 *
 * Used by the Ledger message-list thread collapse (Phase 2, D2) and — with an
 * identical backend twin in `core/subject.py` (Phase 3) — by smart-folder
 * clustering. Keep the two behaviourally identical; they are cross-tested with
 * shared cases incl. the Arabic `رد:`.
 *
 * Behaviour:
 *   - strip a leading `Re:` / `Fwd:` / `Fw:` / `رد:` / `الرد:` / `توجيه:` /
 *     `إعادة:` prefix **repeatedly** (e.g. "Re: Fwd: x" → "x"), case-insensitively
 *     for Latin;
 *   - trim surrounding whitespace;
 *   - collapse internal runs of whitespace to a single space;
 *   - lower-case Latin letters (Arabic has no case, so it is untouched).
 *
 * Pure, no I/O — unit-tested.
 */

/**
 * Matches ONE leading reply/forward prefix and its trailing colon + spaces.
 *
 * - `re`, `fwd`, `fw` — ASCII-case-insensitive (the `i` flag).
 * - `رد`, `الرد`, `توجيه`, `إعادة` — Arabic forms (no case folding needed).
 * Optional surrounding whitespace is consumed so repeated application peels each
 * prefix off in turn. Kept in lock-step with the backend twin `core/subject.py`.
 */
const PREFIX_RE = /^\s*(?:re|fwd|fw|رد|الرد|توجيه|إعادة)\s*:\s*/i

export function normaliseSubject(subject: string): string {
  let s = subject ?? ''
  // Peel reply/forward prefixes repeatedly: "Re: رد: x" → "x".
  let prev: string
  do {
    prev = s
    s = s.replace(PREFIX_RE, '')
  } while (s !== prev)
  // Collapse internal whitespace, trim, then lower-case (Latin only — Arabic
  // is caseless so `toLowerCase` leaves it unchanged).
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}
