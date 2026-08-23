/**
 * Canonical GSSG employee-number matcher — single source of truth.
 *
 * Real employee ids are `G` followed by 3–4 digits, **no hyphen** (e.g. G2838,
 * G3006, G3082). The design-system's hyphenated `G-1042` examples are
 * illustrative only — data is matched against the no-hyphen shape below.
 *
 * Both the smart-link decorator (`smartLinks.ts`) and the suggestion-banner
 * detector (`employeeDetection.ts`) import from here so the two surfaces can't
 * drift apart. Regexes carry the global flag; callers that reuse them across
 * `.exec()` loops MUST reset `lastIndex` (see `smartLinks.ts`).
 */

/** Pattern body for a G-number (no anchors, no flags). */
export const G_NUMBER_SOURCE = String.raw`(?<![\p{L}\p{N}_])G\d{3,4}(?![\p{L}\p{N}_])`

/** Build a fresh global+case-insensitive matcher. */
export function gNumberRegex(): RegExp {
  return new RegExp(G_NUMBER_SOURCE, 'giu')
}
