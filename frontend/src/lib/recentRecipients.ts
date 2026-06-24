/**
 * Recently-used recipient addresses, persisted to localStorage.
 * Written on every successful send (recency retained for future frequency-ranked
 * suggestions — a deferred backlog item). The compose UI no longer reads this
 * store; the "Recent" autocomplete group was removed. API is unchanged.
 * Newest-first, case-insensitive dedupe, capped at MAX_STORED.
 */
export const RECENTS_KEY = 'gssg.ledger.recentRecipients'
const MAX_STORED = 8

export function getRecentRecipients(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_STORED)
  } catch {
    return []
  }
}

export function pushRecentRecipient(address: string): void {
  const addr = address.trim()
  if (!addr) return
  try {
    const current = getRecentRecipients().filter(
      (a) => a.toLowerCase() !== addr.toLowerCase(),
    )
    const next = [addr, ...current].slice(0, MAX_STORED)
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {
    /* private-mode / quota — non-fatal, just don't persist */
  }
}

// --- Per-form (per basket-kind) learned recipients ------------------------
// A separate map keyed by basket kind, so a Sick-Leave bundle remembers its
// recipient independently of a Violation bundle. Recorded on successful send.
const BY_FORM_KEY = 'gssg.ledger.recentRecipientsByForm'

function loadByForm(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(BY_FORM_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, string[]>)
      : {}
  } catch {
    return {}
  }
}

export function getRecentRecipientsForForm(key: string): string[] {
  const v = loadByForm()[key]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function recordRecipientsForForm(key: string, addresses: string[]): void {
  const cleaned: string[] = []
  for (const a of addresses) {
    const addr = (a ?? '').trim()
    if (addr && !cleaned.some((x) => x.toLowerCase() === addr.toLowerCase())) {
      cleaned.push(addr)
    }
  }
  if (cleaned.length === 0) return
  try {
    const all = loadByForm()
    all[key] = cleaned.slice(0, MAX_STORED)
    localStorage.setItem(BY_FORM_KEY, JSON.stringify(all))
  } catch {
    /* private-mode / quota — non-fatal */
  }
}
