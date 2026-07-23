/**
 * The 7 UAE emirates for the vehicle plate-emirate dropdown.
 *
 * The stored `value` is the canonical Arabic name — it renders straight into
 * the الإمارة column of the Arabic 1/5 letter and matches what the mulkiya OCR
 * normalises to (see backend `normalize_emirate`). The label shows both names
 * so the option reads in either UI language.
 */
export const EMIRATES: { value: string; label: string }[] = [
  { value: 'أبوظبي', label: 'أبوظبي — Abu Dhabi' },
  { value: 'دبي', label: 'دبي — Dubai' },
  { value: 'الشارقة', label: 'الشارقة — Sharjah' },
  { value: 'عجمان', label: 'عجمان — Ajman' },
  { value: 'أم القيوين', label: 'أم القيوين — Umm Al Quwain' },
  { value: 'رأس الخيمة', label: 'رأس الخيمة — Ras Al Khaimah' },
  { value: 'الفجيرة', label: 'الفجيرة — Fujairah' },
]
