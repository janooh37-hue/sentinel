/**
 * As-sent body direction inference for the ledger reading pane (Phase 5 Task 3).
 *
 * An email body renders in its OWN source direction — identical to what the
 * sender composed — not the chrome's. If the source HTML carries an explicit
 * top-level `dir`, that wins; otherwise we infer from the first strong
 * directional character in the plain text.
 */

/**
 * Strong-RTL Unicode ranges (Hebrew + Arabic, incl. supplements / presentation
 * forms). Ranges stop short of U+FEFF and other zero-width / NBSP codepoints,
 * which ESLint's no-irregular-whitespace forbids in source.
 */
const RTL_STRONG =
  /[א-תׯ-״؀-ۿݐ-ݿࢠ-ࣿיִ-ﭏﭐ-﷽ﹰ-ﻼ]/
const LTR_STRONG = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/

/**
 * Infer an email body's source direction "as sent".
 *
 * - Honour an explicit top-level `dir` on `<html>`/`<body>`/the first block
 *   element — never mangle a body that already declares its own direction.
 * - Otherwise scan the plain text (tags + entities stripped) for the first
 *   character with strong RTL script ⇒ `rtl`, strong LTR ⇒ `ltr`.
 * - Default to `ltr` when there is no strong character.
 *
 * Keeps an English email LTR under an Arabic UI, and an Arabic email RTL under
 * an English UI, independent of the chrome's direction.
 */
export function inferSourceDir(html: string): 'rtl' | 'ltr' {
  if (!html) return 'ltr'
  const explicit = html.match(
    /<(?:html|body|div|p|table)[^>]*\bdir\s*=\s*["']?(rtl|ltr)/i,
  )
  if (explicit) return explicit[1].toLowerCase() as 'rtl' | 'ltr'
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ')
  for (const ch of text) {
    if (RTL_STRONG.test(ch)) return 'rtl'
    if (LTR_STRONG.test(ch)) return 'ltr'
  }
  return 'ltr'
}
