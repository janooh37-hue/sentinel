/**
 * Pure helpers for applying a saved recipient list to the compose To/Cc fields.
 * Kept DOM-free so it's unit-testable; the UI lives in RecipientListsMenu.
 */
import type { RecipientListMember } from '@/lib/api'

/** Append a list's members into existing To/Cc arrays, case-insensitive dedupe. */
export function applyListToFields(
  to: string[],
  cc: string[],
  members: RecipientListMember[],
): { to: string[]; cc: string[] } {
  const has = (arr: string[], addr: string): boolean =>
    arr.some((a) => a.toLowerCase() === addr.toLowerCase())
  const nextTo = [...to]
  const nextCc = [...cc]
  for (const m of members) {
    const addr = m.address.trim()
    if (!addr) continue
    if (m.field === 'cc') {
      if (!has(nextCc, addr)) nextCc.push(addr)
    } else if (!has(nextTo, addr)) {
      nextTo.push(addr)
    }
  }
  return { to: nextTo, cc: nextCc }
}

/** Count members by field — for the chip's title/summary. */
export function summarizeMembers(
  members: RecipientListMember[],
): { to: number; cc: number } {
  return {
    to: members.filter((m) => m.field === 'to').length,
    cc: members.filter((m) => m.field === 'cc').length,
  }
}
