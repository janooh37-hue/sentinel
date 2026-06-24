/**
 * Detect employee G-numbers (e.g. G3082, G2838) inside an HTML body so the
 * ledger detail view can suggest auto-linking the entry to the matching
 * employee record.
 *
 * The G-number shape is the canonical no-hyphen `G` + 3–4 digits, shared with
 * the smart-link decorator via `lib/gnumber.ts` so the two detectors can't
 * drift.
 *
 * Tags are stripped before matching so a `G1234` accidentally embedded inside
 * an attribute (`<a id="G1234">`) doesn't get picked up. Matches are word-
 * boundary anchored, deduped (case-insensitive then uppercased), and capped
 * at 5 — beyond that the body is too noisy to give a useful single-employee
 * suggestion anyway.
 */

import { gNumberRegex } from './gnumber'

const MAX_RESULTS = 5

export function extractGNumbers(html: string): string[] {
  if (!html) return []
  // Strip tags + decode minimal whitespace before scanning. We don't need a
  // full HTML parser — the regex is anchored on \b so leftover punctuation is
  // harmless.
  const text = html.replace(/<[^>]*>/g, ' ')
  const matches = text.match(gNumberRegex()) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of matches) {
    const normalised = m.toUpperCase()
    if (seen.has(normalised)) continue
    seen.add(normalised)
    out.push(normalised)
    if (out.length >= MAX_RESULTS) break
  }
  return out
}
