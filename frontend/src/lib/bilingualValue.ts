/**
 * Some legacy leave fields (`leave_type`, `status`) are persisted as a single
 * concatenated bilingual string, e.g. `"Annual Leave - <ar>"` or
 * `"Pending - <ar>"` (English part before `" - "`, Arabic part after).
 *
 * `splitBilingual` returns the side matching the active language. When the value
 * isn't a bilingual pair (no `" - "` separator) it's returned unchanged.
 *
 * Use `englishPart` when matching against an enum/token (e.g. status colors),
 * which always keys off the English side.
 */
const SEP = ' - '

export function englishPart(value: string): string {
  const idx = value.indexOf(SEP)
  return idx === -1 ? value : value.slice(0, idx)
}

export function splitBilingual(value: string, language: string): string {
  const idx = value.indexOf(SEP)
  if (idx === -1) return value
  return language === 'ar' ? value.slice(idx + SEP.length) : value.slice(0, idx)
}

// Arabic-script codepoint ranges (base, supplement, presentation forms A/B).
// Checked by code so no literal Arabic / irregular-whitespace chars sit in source.
function isArabicCode(code: number): boolean {
  return (
    (code >= 0x0600 && code <= 0x06ff) ||
    (code >= 0x0750 && code <= 0x077f) ||
    (code >= 0xfb50 && code <= 0xfdff) ||
    (code >= 0xfe70 && code <= 0xfeff)
  )
}

function firstArabicIndex(value: string): number {
  for (let i = 0; i < value.length; i++) {
    if (isArabicCode(value.charCodeAt(i))) return i
  }
  return -1
}

/**
 * Like `splitBilingual`, but for the leave-balance sentinel messages whose
 * English/Arabic halves are separated by a newline (`"Invalid join date\n<ar>"`,
 * `"Probation - 5 days left\n<ar>"`) or just a space (`"Eligible <ar>"`). Returns
 * the side matching the active language; falls back to the whole string when it
 * isn't a recognisable bilingual pair.
 */
export function splitBilingualMessage(value: string, language: string): string {
  const ar = language === 'ar'
  if (value.includes('\n')) {
    const [en, rest] = value.split('\n')
    return (ar ? rest : en).trim()
  }
  const idx = firstArabicIndex(value)
  if (idx > 0) {
    return (ar ? value.slice(idx) : value.slice(0, idx)).trim()
  }
  return value
}
