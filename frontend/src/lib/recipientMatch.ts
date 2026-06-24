/** Prefix-first matching for the recipient autocomplete (QW1). */
import type { AddressBookContactRead } from '@/lib/api'

const DIACRITICS = /[ً-ٰٟ]/g

/** Lower-case + strip Arabic combining marks so 'مُحَمَّد' matches 'محمد'. */
export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(DIACRITICS, '')
}

/**
 * Rank contacts for a non-empty query: name/address PREFIX matches first
 * (the "first letters typed" the user expects), then substring matches.
 */
export function rankContacts(
  contacts: AddressBookContactRead[],
  query: string,
): AddressBookContactRead[] {
  const q = normalize(query.trim())
  if (!q) return []
  const prefix: AddressBookContactRead[] = []
  const substr: AddressBookContactRead[] = []
  for (const c of contacts) {
    const name = normalize(c.display_name ?? '')
    const addr = normalize(c.address ?? '')
    if (name.startsWith(q) || addr.startsWith(q)) prefix.push(c)
    else if (name.includes(q) || addr.includes(q)) substr.push(c)
  }
  return [...prefix, ...substr]
}
