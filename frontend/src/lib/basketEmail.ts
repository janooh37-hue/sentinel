/**
 * Build the basket compose prefill — subject + an official-letter body that
 * mirrors the emails the office actually sends (see real samples in the ledger).
 *
 * Defaults, table layout and header colour match the standard letters. Shared
 * plain-text overrides can replace subject, introduction and closing; tables
 * remain structural. Letter content is not routed through UI i18n:
 *   • Sick   → blue header (#4472C4), LTR, English columns
 *              (S.N · ID · Name · From · To · Leave Days · Location)
 *   • Annual leave, Duty Resumption, HR Request → red header, a table the
 *              operator shows in Arabic (RTL) or English (LTR); intro and
 *              closing stay Arabic. Annual / Duty Resumption columns:
 *              (S.N · ID · Designation · NAME · Nationality · Mobile · Location ·
 *              [FROM · TO] · DUTY RESUMPTION DATE · COMMENTS); HR Request:
 *              (# · ID · Name · Type of Certificate · The entity), coloured cells
 *   • Other leave kinds → red header (#C00000), RTL, Arabic columns
 *              (م · الرقم الوظيفي · المسمى الوظيفي · الاسم · تاريخ الإجازة · ولغاية)
 *   • Non-leave forms → red header, RTL, generic columns
 *              (م · الرقم الوظيفي · المسمى الوظيفي · الاسم · البيان)
 *   • Violation / Warning forms → red header, RTL, the violations in Arabic
 *              (… · المخالفات as a bullet list · ملاحظات when remarks exist),
 *              and an Arabic subject naming the violations and the employee
 *
 * References carry docId + a sane fileName so the compose attaches every PDF
 * named {ref}_{form}_{employee}.pdf.
 */
import type { ComposeReference } from '@/components/ledger/ReferencePicker'

import { basketKey, filenameForItem, type BasketKey, type EmailBasketItem } from './emailBasket'
import type { DraftOverrides } from './draftTemplates'
import type { DraftTemplateFields } from './messageTemplates'
import { nationalityEn } from './nationalityEn'

/** Only keys in the renderer's value map are substituted; unknown tokens stay literal. */
export function substituteDraftText(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, token: string) =>
    Object.hasOwn(values, token) ? values[token] : match)
}

export function draftTextHtml(text: string): string {
  return esc(text).replace(/\r\n?|\n/g, '<br>')
}

/** Convert rendered default blocks to editable plain text without losing line breaks. */
export function draftPlainText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&').trim()
}

interface DraftParts { intro: string; table: string; closing: string }

function basketDraftValues(items: EmailBasketItem[]): Record<string, string> {
  const first = items[0]
  return {
    ref: first.ref,
    date: dmyPad(first.bookDate ?? ''),
    names: items.map(nameArOf).join('، '),
    count: String(items.length),
    detail: first.detail,
    bank: [...new Set(items.map((item) => (item.bankName ?? '').trim()).filter(Boolean))].join('، '),
    start_date: dmyPad(first.startDate ?? ''),
    end_date: dmyPad(first.endDate ?? ''),
  }
}

function basketOverride(items: EmailBasketItem[], overrides?: DraftOverrides): DraftTemplateFields {
  if (!overrides || !items.length) return {}
  const first = items[0]
  const key = first.formKind === 'Security Permit' ? 'General Book' : basketKey(first)
  if (key !== 'General Book') return overrides[key] ?? {}
  if (items.every(isTransfer)) return overrides['General Book:transfer'] ?? {}
  const code = first.classificationCode
  const specific = code && items.every((item) => item.classificationCode === code)
    ? overrides[`classification:${code}`] : undefined
  const generic = overrides['General Book']
  return {
    subject: specific?.subject || (generic?.subject ?? ''),
    intro: specific?.intro || (generic?.intro ?? ''),
    closing: specific?.closing || (generic?.closing ?? ''),
  }
}

// ── escaping & formatting ────────────────────────────────────────────────────

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** `2026-07-16` → `16/7/2026` (no leading zeros, as the office writes them).
 *  Returns the input unchanged when it isn't a leading ISO date. */
function dmy(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}` : s
}

/** Inclusive day count between two ISO dates; '' when either is missing/invalid. */
function daysBetween(a?: string, b?: string): string {
  if (!a || !b) return ''
  const da = Date.parse(a.slice(0, 10))
  const db = Date.parse(b.slice(0, 10))
  if (Number.isNaN(da) || Number.isNaN(db)) return ''
  const n = Math.round((db - da) / 86_400_000) + 1
  return n > 0 ? String(n) : ''
}

function nameEnOf(i: EmailBasketItem): string {
  return i.nameEn || i.nameAr || ''
}
function nameArOf(i: EmailBasketItem): string {
  return i.nameAr && i.nameAr.trim() ? i.nameAr : i.nameEn
}
function positionArOf(i: EmailBasketItem): string {
  return i.positionAr ?? i.positionEn ?? ''
}

// ── shared styling (inline so it survives SMTP + the recipient's client) ──────

const HEADER_BLUE = '#4472C4'
export const HEADER_RED = '#C00000'
export const TD_STYLE = 'border:1px solid #000000;padding:4px 9px;text-align:center'
const TD_LIST_STYLE = 'border:1px solid #000000;padding:4px 9px;text-align:right'
const P_STYLE =
  'margin:0 0 8pt;font-family:Arial,sans-serif;font-size:14pt;text-align:right;direction:rtl'

export function thStyle(bg: string): string {
  return `border:1px solid #000000;background:${bg};color:#ffffff;padding:4px 9px;text-align:center;font-weight:bold`
}

export function p(html: string): string {
  return `<p dir="rtl" style="${P_STYLE}">${html}</p>`
}

/** A plain cell is escaped text; `{ html }` is trusted markup built here
 *  (already-escaped bullet lists), right-aligned so the bullets line up. */
type Cell = string | { html: string }

function tableHtml(
  dir: 'ltr' | 'rtl',
  headerBg: string,
  cols: string[],
  rows: Cell[][],
  colStyles: string[] = [],
): string {
  const head = `<tr>${cols.map((c) => `<th style="${thStyle(headerBg)}">${esc(c)}</th>`).join('')}</tr>`
  const td = (c: Cell, col: number): string => {
    const extra = colStyles[col] ? `;${colStyles[col]}` : ''
    return typeof c === 'string'
      ? `<td style="${TD_STYLE}${extra}">${esc(c)}</td>`
      : `<td style="${TD_LIST_STYLE}${extra}">${c.html}</td>`
  }
  const body = rows.map((r) => `<tr>${r.map(td).join('')}</tr>`).join('')
  return (
    `<table dir="${dir}" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt">` +
    `<thead>${head}</thead><tbody>${body}</tbody></table>`
  )
}

// ── per-kind intros (verbatim from the office's standard letters) ─────────────

const LEAVE_AR: Record<string, string> = {
  Annual: 'إجازة سنوية',
  Compassionate: 'إجازة وفاة',
  Duty: 'إجازة مهمة عمل',
  Emergency: 'إجازة طارئة',
  Hajj: 'إجازة حج',
  Others: 'إجازة',
}

const RED_GREETING = p('السلام عليكم ورحمه الله وبركاته؛؛؛؛<br>تحيه طيبه,, وبعد')

/** Fixed work location for the sick-leave Location column (single site for now). */
const FIXED_LOCATION = 'AL WATHBA'

function closingLine(html: string, align: 'right' | 'center'): string {
  return `<p dir="rtl" style="margin:0;font-family:Arial,sans-serif;font-size:14pt;text-align:${align};direction:rtl">${html}</p>`
}

/** Closing block: a blank line off the table, then each sentence on its own
 *  line — right-aligned, with the final regards line centered. */
export function buildClosing(lines: string[]): string {
  const spacer = closingLine('&nbsp;', 'right') // one blank line after the table
  const body = lines
    .map((line, i) => closingLine(line, i === lines.length - 1 ? 'center' : 'right'))
    .join('')
  return spacer + body
}

/** Standard closing/regards block — appended after the table on every letter. */
const STANDARD_CLOSING = buildClosing([
  'يرجى التفضل بالاطلاع لطفاً ،،،',
  'واقبلوا فائق الإحترام والتقدير ،،،',
])

const TRANSFER_SUBJECT = 'النقل' // General Book subject minted by /duty/transfer

/** ISO → DD/MM/YYYY, ZERO-PADDED (the office writes transfers as 11/06/2026).
 *  Note: the shared `dmy()` strips leading zeros, so it must NOT be used here. */
export function dmyPad(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

function isTransfer(item: EmailBasketItem): boolean {
  return item.formKind === 'General Book' && item.detail === TRANSFER_SUBJECT
}

function transferEmailParts(item: EmailBasketItem): DraftParts {
  const date = dmyPad(item.bookDate ?? '')
  const ref = esc(item.ref)
  const intro =
    'يطيب لنا أن نتقدم إليكم بخالص التحية و التقدير , يرجى العلم أنه ولغايات تنظيمية في العمل ' +
    `تم نقل المذكورين بالجدول المبين مضمون الكتاب الرقم ${ref} تاريخ ${date} م ` +
    'إلى الجهات المبينة بجانب أسمائهم إعتباراً من تاريخه .'
  return {
    intro: p('السلام عليكم ورحمة الله وبركاته :') + p(intro),
    table: '',
    closing: buildClosing(['للتفضل بالعلم ولإجراءاتكم لطفاً.', 'هذا وتفضلوا بقبول فائق الإحترام والتقدير.']),
  }
}

const SALARY_TRANSFER = 'Salary Transfer Request'

function salaryTransferIntro(items: EmailBasketItem[], plural: boolean): string {
  const banks = [...new Set(items.map((i) => (i.bankName ?? '').trim()).filter(Boolean))]
  const bankPhrase =
    banks.length === 1
      ? `إلى ${esc(banks[0])}`
      : banks.length > 1
        ? 'إلى البنوك المبينة'
        : 'إلى البنك المبين في المرفق'
  const who = plural ? 'الموظفين المذكورين أدناه' : 'الموظف المذكور أدناه'
  return (
    p('السلام عليكم ورحمة الله وبركاته ,,,') +
    p(`مرفق لكم طلب تحويل راتب ${who} ${bankPhrase} :-`)
  )
}

function salaryTransferTable(items: EmailBasketItem[]): string {
  // المهام (duties) = the employee's designation (position_ar).
  const rows = items.map((i, idx) => [
    String(idx + 1),
    i.employeeId,
    nameArOf(i),
    i.nationality ?? '',
    positionArOf(i),
  ])
  return tableHtml('rtl', HEADER_RED, ['#', 'ID', 'الاسم', 'الجنسية', 'المهام'], rows)
}

// ── Resignation (Resignation Letter / Resignation Declaration) ────────────────
const RESIGNATION_FORMS = ['Resignation Letter', 'Resignation Declaration']

function resignationBody(items: EmailBasketItem[], plural: boolean): Omit<DraftParts, 'closing'> {
  const who = plural ? 'المذكورين أدناه' : 'المذكور أدناه'
  const intro =
    p('السلام عليكم ورحمة الله وبركاته') +
    p(`يرجى العلم أنه تقدم إلينا ${who} بطلب الاستقالة ، ولا مانع من إجابة الطلب مرفقاً بطيه نموذج الاستقالة .`)
  const rows = items.map((i, idx) => [
    String(idx + 1),
    i.employeeId,
    nameArOf(i),
    i.nationality ?? '',
    i.phone ?? '',
    positionArOf(i),
    i.joinDate ? dmy(i.joinDate) : '',
    i.lastWorkDay ? dmy(i.lastWorkDay) : '',
  ])
  return {
    intro,
    table: tableHtml(
      'rtl',
      HEADER_RED,
      ['#', 'ID', 'الاسم', 'الجنسية', 'رقم الهاتف', 'المهام', 'تاريخ الالتحاق', 'أخر يوم عمل'],
      rows,
    ),
  }
}

// ── Passport Release Form ─────────────────────────────────────────────────────
const PASSPORT_FORM = 'Passport Release Form'
const PASSPORT_CLOSING = buildClosing([
  'مرفق طيه استمارة طلب الجواز . للتفضل بالاطلاع وإجراءاتكم .',
  'وأقبلوا تحياتي ،،،',
])

function passportBody(items: EmailBasketItem[], plural: boolean): Omit<DraftParts, 'closing'> {
  const who = plural ? 'المذكورين في الجدول أدناه' : 'المذكور في الجدول أدناه'
  const intro = RED_GREETING + p(`تقدم إلينا ${who} بطلب جواز السفر حسب ما هو مبين .`)
  const rows = items.map((i, idx) => [
    String(idx + 1),
    i.employeeId,
    positionArOf(i),
    nameArOf(i),
    i.nationality ?? '',
    '', // ملاحظة — note, filled in the editor if needed
  ])
  return {
    intro,
    table: tableHtml('rtl', HEADER_RED, ['م', 'الرقم', 'المسمى الوظيفي', 'الأسم', 'الجنسية', 'ملاحظة'], rows),
  }
}

// ── Bilingual tables: Annual leave, Duty Resumption, HR Request ───────────────
// The operator picks the table language in the compose (remembered per device):
// English reads LTR, Arabic RTL. Intro and closing stay Arabic either way.
const DUTY_RESUMPTION_FORM = 'Duty Resumption Form'
const HR_REQUEST_FORM = 'HR Request Form'

export type TableLanguage = 'ar' | 'en'
const TABLE_LANGUAGE_KEY = 'gssg.basketTableLanguage'

/** The last table language picked on this device; Arabic until one is. */
export function loadTableLanguage(): TableLanguage {
  try {
    return localStorage.getItem(TABLE_LANGUAGE_KEY) === 'en' ? 'en' : 'ar'
  } catch {
    return 'ar'
  }
}

export function saveTableLanguage(lang: TableLanguage): void {
  try {
    localStorage.setItem(TABLE_LANGUAGE_KEY, lang)
  } catch {
    /* private mode / quota: the choice just isn't remembered */
  }
}

/** Site code printed in every row's Location column. */
const SITE_CODE = '0331'

interface Column {
  en: string
  ar: string
  cell: (item: EmailBasketItem, idx: number, lang: TableLanguage) => string
  style?: string // extra inline td style (HR Request cell colours)
}

interface BilingualLetter {
  intro: (plural: boolean) => string
  cols: Column[]
}

/** The day after an ISO date (the employee is due back), as `d/m/yyyy`. */
function dayAfter(iso?: string): string {
  if (!iso) return ''
  const day = Date.parse(iso.slice(0, 10))
  return Number.isNaN(day) ? '' : dmy(new Date(day + 86_400_000).toISOString())
}

const SN_COL: Column = { en: 'S.N', ar: 'م', cell: (_i, idx) => String(idx + 1) }
const ID_COL: Column = { en: 'ID', ar: 'الرقم الوظيفي', cell: (i) => i.employeeId }
const DESIGNATION_COL: Column = {
  en: 'Designation',
  ar: 'المسمى الوظيفي',
  cell: (i, _idx, lang) => (lang === 'en' ? i.positionEn || i.positionAr || '' : positionArOf(i)),
}
const NAME_COL: Column = {
  en: 'NAME',
  ar: 'الاسم',
  cell: (i, _idx, lang) => (lang === 'en' ? nameEnOf(i) : nameArOf(i)),
}
const NATIONALITY_COL: Column = {
  en: 'Nationality',
  ar: 'الجنسية',
  cell: (i, _idx, lang) => (lang === 'en' ? nationalityEn(i.nationality) : (i.nationality ?? '')),
}
const MOBILE_COL: Column = { en: 'Mobile', ar: 'رقم الهاتف', cell: (i) => i.phone ?? '' }
const LOCATION_COL: Column = { en: 'Location', ar: 'الموقع', cell: () => SITE_CODE }
const COMMENTS_COL: Column = { en: 'COMMENTS', ar: 'ملاحظات', cell: () => '' } // HR fills it in
const EMPLOYEE_COLS = [SN_COL, ID_COL, DESIGNATION_COL, NAME_COL, NATIONALITY_COL, MOBILE_COL, LOCATION_COL]

const ANNUAL_LETTER: BilingualLetter = {
  intro: (plural) => RED_GREETING + p(leaveIntroLine('Annual', plural)),
  cols: [
    ...EMPLOYEE_COLS,
    { en: 'FROM', ar: 'تاريخ الإجازة', cell: (i) => (i.startDate ? dmy(i.startDate) : '') },
    { en: 'TO', ar: 'ولغاية', cell: (i) => (i.endDate ? dmy(i.endDate) : '') },
    { en: 'DUTY RESUMPTION DATE', ar: 'تاريخ استئناف الواجب', cell: (i) => dayAfter(i.endDate) },
    COMMENTS_COL,
  ],
}

const RETURN_LETTER: BilingualLetter = {
  intro: (plural) => {
    const who = plural ? 'المذكورين بالجدول أدناه' : 'المذكور بالجدول أدناه'
    return RED_GREETING + p(`نفيدكم علماً بعودة ${who} من الإجازة حسب ما هو موضح .`)
  },
  cols: [
    ...EMPLOYEE_COLS,
    {
      en: 'DUTY RESUMPTION DATE',
      ar: 'تاريخ استئناف الواجب',
      cell: (i) => (i.resumptionDate ? dmy(i.resumptionDate) : ''),
    },
    COMMENTS_COL,
  ],
}

/** Requested-document names as the office writes them in the HR Request table. */
const HR_DOC_LABELS: Record<string, Record<TableLanguage, string>> = {
  insurance_card: { en: 'Insurance Card', ar: 'بطاقة التأمين' },
  id_card: { en: 'ID Card', ar: 'بطاقة الهوية' },
  employment_certificate: { en: 'To Whom It May Concern Certificate', ar: 'شهادة لمن يهمه الأمر' },
  salary_certificate: { en: 'Salary Certificate', ar: 'شهادة راتب' },
  salary_transfer_letter: { en: 'Salary Transfer Letter', ar: 'خطاب تحويل الراتب' },
  salary_pay_slip: { en: 'Salary Pay Slip', ar: 'قسيمة الراتب' },
  experience_certificate: { en: 'Experience Certificate', ar: 'شهادة خبرة' },
}
const HR_BLUE = '#D9E2F3'
const HR_PINK = '#FFCCCC'

const HR_LETTER: BilingualLetter = {
  intro: (plural) => RED_GREETING + p(genericIntroLine(plural)),
  cols: [
    {
      en: '#',
      ar: 'م',
      cell: (_i, idx) => String(idx + 1),
      style: `background:${HEADER_RED};color:#ffffff;font-weight:bold`,
    },
    { ...ID_COL, style: `background:${HR_PINK};font-weight:bold` },
    { ...NAME_COL, en: 'Name', style: `background:${HR_BLUE};font-weight:bold` },
    {
      en: 'Type of Certificate',
      ar: 'نوع الشهادة',
      cell: (i, _idx, lang) =>
        [
          ...(i.hrDocs ?? []).map((key) => (Object.hasOwn(HR_DOC_LABELS, key) ? HR_DOC_LABELS[key][lang] : key)),
          ...(i.hrDocOther ? [i.hrDocOther] : []),
        ].join(' + '),
      style: `background:${HR_PINK}`,
    },
    {
      en: 'The entity',
      ar: 'الجهة',
      cell: (i) => i.addressedTo ?? '',
      style: `background:${HR_BLUE};font-weight:bold`,
    },
  ],
}

function bilingualLetter(items: EmailBasketItem[]): BilingualLetter | undefined {
  const first = items[0]
  if (first.leaveType === 'Annual') return ANNUAL_LETTER
  if (first.formKind === DUTY_RESUMPTION_FORM) return RETURN_LETTER
  if (first.formKind === HR_REQUEST_FORM) return HR_LETTER
  return undefined
}

function bilingualTable(items: EmailBasketItem[], cols: Column[], lang: TableLanguage): string {
  return tableHtml(
    lang === 'en' ? 'ltr' : 'rtl',
    HEADER_RED,
    cols.map((c) => c[lang]),
    items.map((item, idx) => cols.map((c) => c.cell(item, idx, lang))),
    cols.map((c) => c.style ?? ''),
  )
}

/**
 * Translate the letter's table inside an (operator-edited) body from one
 * prebuilt language variant to the other. Only cells still holding the
 * generated text are translated; typed COMMENTS, corrected cells and added
 * rows stay as the operator left them.
 */
export function swapLetterTable(bodyHtml: string, from: string, to: string): string {
  const doc = new DOMParser().parseFromString(bodyHtml, 'text/html')
  const current = doc.querySelector('table')
  const source = new DOMParser().parseFromString(from, 'text/html').querySelector('table')
  const target = new DOMParser().parseFromString(to, 'text/html').querySelector('table')
  if (!current || !source || !target) return bodyHtml
  current.setAttribute('dir', target.getAttribute('dir') ?? 'rtl')
  const sourceRows = source.querySelectorAll('tr')
  const targetRows = target.querySelectorAll('tr')
  current.querySelectorAll('tr').forEach((row, r) => {
    if (r >= sourceRows.length) return
    const sourceCells = sourceRows[r].querySelectorAll('th, td')
    const targetCells = targetRows[r].querySelectorAll('th, td')
    row.querySelectorAll('th, td').forEach((cell, c) => {
      if (c >= sourceCells.length) return
      if (cell.textContent?.trim() !== sourceCells[c].textContent?.trim()) return
      cell.innerHTML = targetCells[c].innerHTML
    })
  })
  return doc.body.innerHTML
}

// ── Salary Deduction Form ─────────────────────────────────────────────────────
const SALARY_DEDUCTION_FORM = 'Salary Deduction Form'

function deductionBody(items: EmailBasketItem[], plural: boolean): Omit<DraftParts, 'closing'> {
  const who = plural ? 'المذكورين أدناه' : 'المذكور أدناه'
  const intro =
    p('السلام عليكم ورحمة الله وبركاته ,,,') +
    p(`يطيب لنا أن نهديكم أطيب التحيات ، ونود إعلامكم بأن ${who} من أفراد القوة لدينا تم الخصم من رواتبهم ، ويرجى توضيح سبب الخصم .`)
  const rows = items.map((i, idx) => [String(idx + 1), i.employeeId, nameArOf(i), positionArOf(i)])
  return { intro, table: tableHtml('rtl', HEADER_RED, ['#', 'ID', 'الاسم', 'المهام'], rows) }
}

// ── Violation Form / Warning Form ─────────────────────────────────────────────
// The paper itself is the attachment; the letter names WHAT was violated (the
// form's bullet list, in Arabic) so the recipient never has to open the PDF to
// know what the record is about.
const VIOLATION_FORM = 'Violation Form'
const WARNING_FORM = 'Warning Form'

function isDisciplinary(formKind: string): boolean {
  return formKind === VIOLATION_FORM || formKind === WARNING_FORM
}

function disciplinarySubject(items: EmailBasketItem[]): string {
  const warning = items[0].formKind === WARNING_FORM
  const plural = items.length > 1
  const kind = warning
    ? plural ? 'إنذارات الموظفين' : 'إنذار'
    : plural ? 'مخالفات الموظفين' : 'مخالفة'
  const types = [...new Set(items.flatMap((i) => i.violations ?? []))].join('، ')
  const head = types ? `${kind}: ${types}` : kind
  return plural ? head : `${head} — ${nameArOf(items[0])}`
}

/** One violation reads as text; several become the form's bullet list. */
function violationsCell(item: EmailBasketItem): Cell {
  const list = item.violations ?? []
  if (list.length === 0) return '—'
  if (list.length === 1) return list[0]
  return { html: list.map((v) => `• ${esc(v)}`).join('<br>') }
}

function disciplinaryBody(items: EmailBasketItem[], plural: boolean): Omit<DraftParts, 'closing'> {
  const warning = items[0].formKind === WARNING_FORM
  const line = warning
    ? plural
      ? 'مرفق لكم إنذارات الموظفين المذكورين في الجدول أدناه، مع بيان المخالفات الموجبة لكل إنذار.'
      : 'مرفق لكم إنذار الموظف المذكور في الجدول أدناه، مع بيان المخالفات الموجبة للإنذار.'
    : plural
      ? 'مرفق لكم نماذج مخالفات الموظفين المذكورين في الجدول أدناه، مع بيان المخالفات المرصودة على كل منهم.'
      : 'مرفق لكم نموذج مخالفة الموظف المذكور في الجدول أدناه، مع بيان المخالفات المرصودة عليه.'
  const withNotes = items.some((i) => i.violationNotes)
  const rows = items.map((i, idx): Cell[] => [
    String(idx + 1),
    i.employeeId,
    positionArOf(i),
    nameArOf(i),
    violationsCell(i),
    ...(withNotes ? [i.violationNotes ?? ''] : []),
  ])
  const cols = ['م', 'الرقم الوظيفي', 'المسمى الوظيفي', 'الاسم', 'المخالفات', ...(withNotes ? ['ملاحظات'] : [])]
  return { intro: RED_GREETING + p(line), table: tableHtml('rtl', HEADER_RED, cols, rows) }
}

function sickIntro(plural: boolean): string {
  const greeting = p('عزيزي الفريق<br>السلام عليكم ورحمة الله وبركاته')
  const body = plural
    ? 'يطيب لنا ان نهديكم اطيب التحيات ، ونود اعلامكم بأن <b><u>المذكورين أدناه من أفراد القوة الملحقة بمرتبنا تم حصولهم على إجازة مرضية خلال الفترة المبينة بجانب أسمائهم ، مرفقاً بطيه قسيمة الإجازة الخاصة</u></b> بذلك ونماذج الإجازة معبئة حسب الأصول.'
    : 'يطيب لنا ان نهديكم اطيب التحيات ، ونود اعلامكم بأن <b><u>المذكور أدناه من أفراد القوة الملحقة بمرتبنا تم حصوله على إجازة مرضية خلال الفترة المبينة بجانب أسمه ، مرفقاً بطيه قسيمة الإجازة الخاصة</u></b> بذلك ونموذج الإجازة معبأ حسب الأصول.'
  return greeting + p(body)
}

function leaveIntroLine(leaveType: string, plural: boolean): string {
  if (leaveType === 'Annual') {
    return plural
      ? 'مرفق لكم استمارات طلب إجازات السنوية للموظفين المذكورين في الجدول أدناه.'
      : 'مرفق لكم استمارة طلب إجازة سنوية للموظف المذكور في الجدول أدناه.'
  }
  const kindAr = LEAVE_AR[leaveType] ?? 'إجازة'
  return plural
    ? `مرفق لكم استمارات طلب ${kindAr} للموظفين المذكورين في الجدول أدناه.`
    : `مرفق لكم استمارة طلب ${kindAr} للموظف المذكور في الجدول أدناه.`
}

function genericIntroLine(plural: boolean): string {
  return plural
    ? 'مرفق لكم مستندات الموظفين المذكورين في الجدول أدناه.'
    : 'مرفق لكم مستند الموظف المذكور في الجدول أدناه.'
}

// ── public builders ───────────────────────────────────────────────────────────

function defaultBasketSubject(items: EmailBasketItem[]): string {
  if (items.length === 0) return ''
  if (isTransfer(items[0])) return `تنقلات يوم ${dmyPad(items[0].bookDate ?? '')}`
  const lt = items[0].leaveType
  if (lt === 'Sick') return 'الاجازات المرضية'
  if (lt === 'Annual') return 'طلب اجازة سنوية'
  if (lt) return LEAVE_AR[lt] ?? 'إجازة'
  const fk = items[0].formKind
  if (fk === SALARY_TRANSFER) return 'طلب تحويل راتب'
  if (fk === PASSPORT_FORM) return 'طلب جواز السفر'
  if (RESIGNATION_FORMS.includes(fk)) return 'طلب استقالة'
  if (fk === DUTY_RESUMPTION_FORM) return 'العودة من الإجازة'
  if (fk === SALARY_DEDUCTION_FORM) return 'الخصم من الرواتب'
  if (isDisciplinary(fk)) return disciplinarySubject(items)
  return fk || 'مستندات'
}

/** Default structural parts are shared by compose and the template editor. */
function basketEmailParts(items: EmailBasketItem[], lang: TableLanguage = 'ar'): DraftParts {
  if (items.length === 0) return { intro: '', table: '', closing: '' }
  const plural = items.length > 1
  const leaveType = items[0].leaveType
  const formKind = items[0].formKind

  if (isTransfer(items[0])) return transferEmailParts(items[0])

  const letter = bilingualLetter(items)
  if (letter) {
    return {
      intro: letter.intro(plural),
      table: bilingualTable(items, letter.cols, lang),
      closing: STANDARD_CLOSING,
    }
  }

  let body: Omit<DraftParts, 'closing'>
  let closing = STANDARD_CLOSING

  if (leaveType === 'Sick') {
    const rows = items.map((i, idx) => [
      String(idx + 1),
      i.employeeId,
      nameEnOf(i),
      i.startDate ? dmy(i.startDate) : '',
      i.endDate ? dmy(i.endDate) : '',
      daysBetween(i.startDate, i.endDate),
      FIXED_LOCATION, // single site for now
    ])
    body = {
      intro: sickIntro(plural),
      table: tableHtml('ltr', HEADER_BLUE, ['S.N', 'ID', 'Name', 'From', 'To', 'Leave Days', 'Location'], rows),
    }
  } else if (formKind === SALARY_TRANSFER) {
    body = { intro: salaryTransferIntro(items, plural), table: salaryTransferTable(items) }
  } else if (formKind === PASSPORT_FORM) {
    body = passportBody(items, plural)
    closing = PASSPORT_CLOSING
  } else if (RESIGNATION_FORMS.includes(formKind)) {
    body = resignationBody(items, plural)
  } else if (formKind === SALARY_DEDUCTION_FORM) {
    body = deductionBody(items, plural)
  } else if (isDisciplinary(formKind)) {
    body = disciplinaryBody(items, plural)
  } else if (leaveType) {
    const rows = items.map((i, idx) => [
      String(idx + 1),
      i.employeeId,
      positionArOf(i),
      nameArOf(i),
      i.startDate ? dmy(i.startDate) : '',
      i.endDate ? dmy(i.endDate) : '',
    ])
    body = {
      intro: RED_GREETING + p(leaveIntroLine(leaveType, plural)),
      table: tableHtml('rtl', HEADER_RED, ['م', 'الرقم الوظيفي', 'المسمى الوظيفي', 'الاسم', 'تاريخ الإجازة', 'ولغاية'], rows),
    }
  } else {
    // Non-leave forms — red default style, detail (subject) column.
    const rows = items.map((i, idx) => [
      String(idx + 1),
      i.employeeId,
      positionArOf(i),
      nameArOf(i),
      i.detail,
    ])
    body = {
      intro: RED_GREETING + p(genericIntroLine(plural)),
      table: tableHtml('rtl', HEADER_RED, ['م', 'الرقم الوظيفي', 'المسمى الوظيفي', 'الاسم', 'البيان'], rows),
    }
  }

  return { ...body, closing }
}

export function defaultBasketDraftText(items: EmailBasketItem[]) {
  const parts = basketEmailParts(items)
  return { subject: defaultBasketSubject(items), intro: draftPlainText(parts.intro), closing: draftPlainText(parts.closing) }
}

export function buildBasketSubject(items: EmailBasketItem[], overrides?: DraftOverrides): string {
  const subject = basketOverride(items, overrides).subject ?? ''
  return subject ? substituteDraftText(subject, basketDraftValues(items)) : defaultBasketSubject(items)
}

export function buildBasketBodyHtml(
  items: EmailBasketItem[],
  overrides?: DraftOverrides,
  lang: TableLanguage = 'ar',
): string {
  const parts = basketEmailParts(items, lang)
  const override = basketOverride(items, overrides)
  if (!override.intro && !override.closing) return parts.intro + parts.table + parts.closing
  const values = basketDraftValues(items)
  const intro = override.intro ? p(draftTextHtml(substituteDraftText(override.intro, values))) : parts.intro
  const closing = override.closing
    ? buildClosing([draftTextHtml(substituteDraftText(override.closing, values))])
    : parts.closing
  return intro + parts.table + closing
}

export function buildBasketPrefill(
  items: EmailBasketItem[],
  to: string[],
  overrides?: DraftOverrides,
): {
  to: string[]
  subject: string
  bodyHtml: string
  references: ComposeReference[]
  attachRefPdf: true
  basketKey: BasketKey
  /** Present when the letter's table can be shown in Arabic or English. */
  tableLanguage?: TableLanguage
  tableVariants?: Record<TableLanguage, string>
} {
  const letter = items.length > 0 ? bilingualLetter(items) : undefined
  const tableLanguage = letter ? loadTableLanguage() : 'ar'
  const references: ComposeReference[] = items.map((i) => ({
    kind: 'book',
    id: i.bookId,
    label: i.ref,
    token: i.ref,
    docId: i.docId,
    fileName: filenameForItem(i),
  }))
  return {
    to,
    subject: buildBasketSubject(items, overrides),
    bodyHtml: buildBasketBodyHtml(items, overrides, tableLanguage),
    references,
    attachRefPdf: true,
    basketKey: items.length > 0 ? basketKey(items[0]) : '',
    ...(letter && {
      tableLanguage,
      tableVariants: {
        ar: bilingualTable(items, letter.cols, 'ar'),
        en: bilingualTable(items, letter.cols, 'en'),
      },
    }),
  }
}
