const CODE = /^[A-Z0-9][A-Z0-9._/-]{0,79}$/
const EASTERN_DIGITS = /[٠-٩۰-۹]/g
const SEPARATORS = /[\s,،;؛]+/

export function normalizeArmoryCode(raw: string): { code: string; valid: boolean } {
  const code = raw.trim().replace(EASTERN_DIGITS, digit => String(digit.charCodeAt(0) % 16)).toUpperCase()
  return { code, valid: CODE.test(code) }
}

export interface ParsedSerialEntry {
  code: string
  valid: boolean
  duplicate: boolean
}

export function parseSerialEntry(text: string): ParsedSerialEntry[] {
  const counts = new Map<string, number>()
  const entries = text.split(SEPARATORS).filter(Boolean).map(normalizeArmoryCode)
  for (const { code, valid } of entries) {
    if (valid) counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return entries.map(entry => ({ ...entry, duplicate: (counts.get(entry.code) ?? 0) > 1 }))
}
