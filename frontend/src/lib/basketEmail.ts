/**
 * Build the basket compose prefill — subject + an official-letter body that
 * mirrors the emails the office actually sends (see real samples in the ledger).
 *
 * The wording, table layout and header colour are FIXED per kind to match those
 * letters byte-for-look — they are standardised correspondence, not UI chrome,
 * so they are NOT routed through i18n and do NOT follow the app language:
 *   • Sick   → blue header (#4472C4), LTR, English columns
 *              (S.N · ID · Name · From · To · Leave Days · Location)
 *   • Annual + other leave kinds → red header (#C00000), RTL, Arabic columns
 *              (م · الرقم الوظيفي · المسمى الوظيفي · الاسم · تاريخ الإجازة · ولغاية)
 *   • Non-leave forms → red header, RTL, generic columns
 *              (م · الرقم الوظيفي · المسمى الوظيفي · الاسم · البيان)
 *
 * References carry docId + a sane fileName so the compose attaches every PDF
 * named {ref}_{form}_{employee}.pdf.
 */
import type { ComposeReference } from '@/components/ledger/ReferencePicker'

import { basketKey, filenameForItem, type BasketKey, type EmailBasketItem } from './emailBasket'

// ── escaping & formatting ────────────────────────────────────────────────────

function esc(s: string): string {
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
const HEADER_RED = '#C00000'
const TD_STYLE = 'border:1px solid #000000;padding:4px 9px;text-align:center'
const P_STYLE =
  'margin:0 0 8pt;font-family:Arial,sans-serif;font-size:14pt;text-align:right;direction:rtl'

function thStyle(bg: string): string {
  return `border:1px solid #000000;background:${bg};color:#ffffff;padding:4px 9px;text-align:center;font-weight:bold`
}

function p(html: string): string {
  return `<p dir="rtl" style="${P_STYLE}">${html}</p>`
}

function tableHtml(
  dir: 'ltr' | 'rtl',
  headerBg: string,
  cols: string[],
  rows: string[][],
): string {
  const head = `<tr>${cols.map((c) => `<th style="${thStyle(headerBg)}">${esc(c)}</th>`).join('')}</tr>`
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td style="${TD_STYLE}">${esc(c)}</td>`).join('')}</tr>`)
    .join('')
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
function buildClosing(lines: string[]): string {
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

function resignationBody(items: EmailBasketItem[], plural: boolean): string {
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
  return (
    intro +
    tableHtml(
      'rtl',
      HEADER_RED,
      ['#', 'ID', 'الاسم', 'الجنسية', 'رقم الهاتف', 'المهام', 'تاريخ الالتحاق', 'أخر يوم عمل'],
      rows,
    )
  )
}

// ── Passport Release Form ─────────────────────────────────────────────────────
const PASSPORT_FORM = 'Passport Release Form'
const PASSPORT_CLOSING = buildClosing([
  'مرفق طيه استمارة طلب الجواز . للتفضل بالاطلاع وإجراءاتكم .',
  'وأقبلوا تحياتي ،،،',
])

function passportBody(items: EmailBasketItem[], plural: boolean): string {
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
  return (
    intro +
    tableHtml('rtl', HEADER_RED, ['م', 'الرقم', 'المسمى الوظيفي', 'الأسم', 'الجنسية', 'ملاحظة'], rows)
  )
}

// ── Duty Resumption Form = return-from-leave letter ───────────────────────────
const DUTY_RESUMPTION_FORM = 'Duty Resumption Form'

function returnBody(items: EmailBasketItem[], plural: boolean): string {
  const who = plural ? 'المذكورين بالجدول أدناه' : 'المذكور بالجدول أدناه'
  const intro = RED_GREETING + p(`نفيدكم علماً بعودة ${who} من الإجازة حسب ما هو موضح .`)
  const rows = items.map((i, idx) => [
    String(idx + 1),
    i.employeeId,
    positionArOf(i),
    nameArOf(i),
    i.resumptionDate ? dmy(i.resumptionDate) : '',
  ])
  return (
    intro +
    tableHtml('rtl', HEADER_RED, ['#', 'الرقم الوظيفي', 'المسمى الوظيفي', 'الاسم', 'تاريخ استئناف الواجب'], rows)
  )
}

// ── Salary Deduction Form ─────────────────────────────────────────────────────
const SALARY_DEDUCTION_FORM = 'Salary Deduction Form'

function deductionBody(items: EmailBasketItem[], plural: boolean): string {
  const who = plural ? 'المذكورين أدناه' : 'المذكور أدناه'
  const intro =
    p('السلام عليكم ورحمة الله وبركاته ,,,') +
    p(`يطيب لنا أن نهديكم أطيب التحيات ، ونود إعلامكم بأن ${who} من أفراد القوة لدينا تم الخصم من رواتبهم ، ويرجى توضيح سبب الخصم .`)
  const rows = items.map((i, idx) => [String(idx + 1), i.employeeId, nameArOf(i), positionArOf(i)])
  return intro + tableHtml('rtl', HEADER_RED, ['#', 'ID', 'الاسم', 'المهام'], rows)
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

export function buildBasketSubject(items: EmailBasketItem[]): string {
  if (items.length === 0) return ''
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
  return fk || 'مستندات'
}

/** Intro paragraph(s) + the styled table + the standard closing, ready to seed
 *  the compose editor. */
export function buildBasketBodyHtml(items: EmailBasketItem[]): string {
  if (items.length === 0) return ''
  const plural = items.length > 1
  const leaveType = items[0].leaveType
  const formKind = items[0].formKind

  let body: string
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
    body =
      sickIntro(plural) +
      tableHtml('ltr', HEADER_BLUE, ['S.N', 'ID', 'Name', 'From', 'To', 'Leave Days', 'Location'], rows)
  } else if (formKind === SALARY_TRANSFER) {
    body = salaryTransferIntro(items, plural) + salaryTransferTable(items)
  } else if (formKind === PASSPORT_FORM) {
    body = passportBody(items, plural)
    closing = PASSPORT_CLOSING
  } else if (RESIGNATION_FORMS.includes(formKind)) {
    body = resignationBody(items, plural)
  } else if (formKind === DUTY_RESUMPTION_FORM) {
    body = returnBody(items, plural)
  } else if (formKind === SALARY_DEDUCTION_FORM) {
    body = deductionBody(items, plural)
  } else if (leaveType) {
    const rows = items.map((i, idx) => [
      String(idx + 1),
      i.employeeId,
      positionArOf(i),
      nameArOf(i),
      i.startDate ? dmy(i.startDate) : '',
      i.endDate ? dmy(i.endDate) : '',
    ])
    body =
      RED_GREETING +
      p(leaveIntroLine(leaveType, plural)) +
      tableHtml('rtl', HEADER_RED, ['م', 'الرقم الوظيفي', 'المسمى الوظيفي', 'الاسم', 'تاريخ الإجازة', 'ولغاية'], rows)
  } else {
    // Non-leave forms — red default style, detail (subject) column.
    const rows = items.map((i, idx) => [
      String(idx + 1),
      i.employeeId,
      positionArOf(i),
      nameArOf(i),
      i.detail,
    ])
    body =
      RED_GREETING +
      p(genericIntroLine(plural)) +
      tableHtml('rtl', HEADER_RED, ['م', 'الرقم الوظيفي', 'المسمى الوظيفي', 'الاسم', 'البيان'], rows)
  }

  return body + closing
}

export function buildBasketPrefill(
  items: EmailBasketItem[],
  to: string[],
): {
  to: string[]
  subject: string
  bodyHtml: string
  references: ComposeReference[]
  attachRefPdf: true
  basketKey: BasketKey
} {
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
    subject: buildBasketSubject(items),
    bodyHtml: buildBasketBodyHtml(items),
    references,
    attachRefPdf: true,
    basketKey: items.length > 0 ? basketKey(items[0]) : '',
  }
}
