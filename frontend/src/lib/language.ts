/** Language helpers shared by bilingual (Arabic/English) modules. */

/** True for `ar` and any Arabic regional tag (`ar-AE`). */
export function isArabic(language: string): boolean {
  return language.startsWith('ar')
}

/** Pick the language-appropriate half of a bilingual pair, falling back to the
 *  peer language rather than rendering an empty cell. */
export function localized(
  ar: string | null | undefined,
  en: string | null | undefined,
  language: string,
): string {
  const [first, second] = isArabic(language) ? [ar, en] : [en, ar]
  return first?.trim() || second?.trim() || ''
}

/** Whole number in the UI language's digits (`ar-AE` / `en-AE`). */
export function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(isArabic(language) ? 'ar-AE' : 'en-AE', {
    maximumFractionDigits: 0,
  }).format(value)
}
