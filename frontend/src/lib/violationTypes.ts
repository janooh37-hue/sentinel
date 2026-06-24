/**
 * Shared bilingual list of the 20 Violation / Warning types.
 *
 * Two consumers:
 *   - `ViolationCheckboxesField` (Violation Form) — markable grid; emits
 *     `{ row, name }` where `name` is the **English canonical** label and `row`
 *     matches the printed Violation Form template cell (the `vio()` helper marks
 *     that row). The English `name` MUST stay stable — the Violation record
 *     relies on it.
 *   - `ViolationComboField` (Warning Form) — searchable multi-select combobox;
 *     emits the display-language label as a `string[]`.
 *
 * `row` indices are the printed Violation Form table rows (GSSG-NAT 300-004):
 * section headers occupy rows 6/15/20, so data rows are 7-14 (Grooming),
 * 16-19 (PSFRD Requirements), 21-28 (Conduct). Arabic is operator-approved
 * (spec 2026-06-12; #24 Insubordination = مخالفة الأوامر والتعليمات).
 */

export interface ViolationType {
  row: number
  en: string
  ar: string
}

export interface ViolationGroup {
  section_en: string
  section_ar: string
  items: ReadonlyArray<ViolationType>
}

export const VIOLATION_GROUPS: ReadonlyArray<ViolationGroup> = [
  {
    section_en: 'Grooming',
    section_ar: 'المظهر والهندام',
    items: [
      { row: 7, en: 'Failing to shave', ar: 'عدم الحلاقة' },
      { row: 8, en: 'Improper Hair Cut', ar: 'قصّة شعر غير لائقة' },
      { row: 9, en: 'Inadequate Personal Hygiene', ar: 'نظافة شخصية غير كافية' },
      {
        row: 10,
        en: 'Improper Uniform / Improper Socks',
        ar: 'زيّ غير لائق / جوارب غير مناسبة',
      },
      { row: 11, en: 'Unkempt or Dirty Uniform', ar: 'زيّ غير مرتّب أو متّسخ' },
      {
        row: 12,
        en: 'Not wearing beret / cap on duty',
        ar: 'عدم ارتداء القبعة أثناء العمل',
      },
      { row: 13, en: 'Loss / damage of Equipment', ar: 'فقدان أو إتلاف المعدّات' },
      { row: 14, en: 'Improper footwear', ar: 'حذاء غير مناسب' },
    ],
  },
  {
    section_en: 'PSFRD Requirements',
    section_ar: 'متطلبات هيئة تنظيم الأمن الخاص (PSFRD)',
    items: [
      {
        row: 16,
        en: 'Fail to have or display PSFRD License',
        ar: 'عدم حمل أو إبراز رخصة الهيئة (PSFRD)',
      },
      {
        row: 17,
        en: 'Fail to Report Incident / Accident',
        ar: 'عدم الإبلاغ عن حادثة / واقعة',
      },
      {
        row: 18,
        en: 'Fail to have / display Company ID',
        ar: 'عدم حمل أو إبراز بطاقة الشركة',
      },
      {
        row: 19,
        en: 'No Note Books / Fail to record in NB',
        ar: 'عدم وجود دفتر الملاحظات / عدم التدوين فيه',
      },
    ],
  },
  {
    section_en: 'Conduct',
    section_ar: 'السلوك',
    items: [
      { row: 21, en: 'Sleeping on Duty', ar: 'النوم أثناء العمل' },
      { row: 22, en: 'Failing to perform duty', ar: 'التقصير في أداء الواجب' },
      { row: 23, en: 'Theft Act', ar: 'ارتكاب السرقة' },
      { row: 24, en: 'Insubordination', ar: 'مخالفة الأوامر والتعليمات' },
      {
        row: 25,
        en: 'Reporting under Alcohol (site / Accommodation)',
        ar: 'الحضور تحت تأثير الكحول (الموقع / السكن)',
      },
      {
        row: 26,
        en: 'Having alcohol (duty / Accommodation)',
        ar: 'حيازة الكحول (أثناء العمل / السكن)',
      },
      {
        row: 27,
        en: 'Failing to report misconduct by another',
        ar: 'عدم الإبلاغ عن سوء سلوك الغير',
      },
      { row: 28, en: 'Contract Breaching', ar: 'الإخلال بالعقد' },
    ],
  },
]

/** Flat list of all 20 types. */
export const ALL_VIOLATION_TYPES: ReadonlyArray<ViolationType> =
  VIOLATION_GROUPS.flatMap((g) => g.items)

/**
 * Canonical stored value for a label. The Warning Form is a fully-Arabic
 * document, so a preset is stored as its **Arabic** label regardless of the UI
 * language it was picked in — the generated DOCX + Violation record stay Arabic.
 * Unknown text (a custom free-text entry) is stored verbatim.
 */
export function canonicalViolationValue(text: string): string {
  const q = text.trim().toLowerCase()
  const hit = ALL_VIOLATION_TYPES.find(
    (it) => it.en.toLowerCase() === q || it.ar.toLowerCase() === q,
  )
  return hit ? hit.ar : text.trim()
}

/**
 * Render a stored value in the active language — presets resolve to en/ar (so
 * chips re-translate when the UI language flips), custom entries show as stored.
 */
export function displayViolationValue(value: string, isAr: boolean): string {
  const hit = ALL_VIOLATION_TYPES.find((it) => it.ar === value || it.en === value)
  if (!hit) return value
  return isAr ? hit.ar : hit.en
}
