/** Prefix-first matching for the recipient autocomplete (QW1). */
import type { AddressBookContactRead } from '@/lib/api'

const DIACRITICS = /[ً-ٰٟ]/g

/** Lower-case + strip Arabic combining marks so 'مُحَمَّد' matches 'محمد'. */
export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(DIACRITICS, '')
}

/**
 * Search-only normalization; recipient matching intentionally keeps its existing
 * rules. Keep ة distinct on the strict pass, then opt into relaxed spelling.
 */
export function normalizeSearchText(text: string, relaxed = false): string {
  const normalized = text
    // NFKC expands high-hamza alef into alef + a standalone high hamza.
    .replace(/ٵ/g, 'ا')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7-\u06e8\u06ea-\u06ed\u0898-\u089f\u08ca-\u08e1\u08e3-\u08ff\u0640]/g, '')
    .replace(/[آأإٱٲٳ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[٠-٩۰-۹]/g, (digit) =>
      String(digit.charCodeAt(0) - (digit >= '۰' ? 0x06f0 : 0x0660)),
    )
    .replace(/\s+/g, ' ')
    .trim()
  return relaxed ? normalized.replace(/ة/g, 'ه') : normalized
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
