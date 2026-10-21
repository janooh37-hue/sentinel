import type { AbsenceRegisterRowRead } from '@/lib/api'
import {
  buildClosing,
  dmyPad,
  esc,
  draftPlainText,
  draftTextHtml,
  HEADER_RED,
  p,
  TD_STYLE,
  substituteDraftText,
  thStyle,
} from '@/lib/basketEmail'
import { computeEndDate } from '@/lib/leaveDateMath'
import type { DraftOverrides } from '@/lib/draftTemplates'

export type AbsenceCase = 'absent' | 'returned'
export type AbsenceEmailRow = AbsenceRegisterRowRead & { case: AbsenceCase }

export const ABSENCE_EMAIL_SUBJECT = 'التغيب عن العمل'
export const ABSENCE_BASKET_KEY = 'absence'
export const ABSENCE_TABLE_HEADERS = [
  '*',
  'ID',
  'الإسم',
  'السرية',
  'تاريخ التغيب',
  'الى',
  'عدد الايام',
  'الملاحظات',
] as const

const ABSENT_SINGULAR =
  'يطيب لنا ان نهديكم اطيب التحيات , ونفيدكم علما بأن المذكور من أفراد القوة الملحقة بمرتبنا أدناه <b><u>متغيب عن مقر عمله خلال الفترة المبينة بجانب أسمه</u></b> , وسيتم إدراجه على كشف الحضور الشهري متغيب عن مقر عمله .'
const ABSENT_PLURAL =
  'يطيب لنا ان نهديكم اطيب التحيات , ونفيدكم علما بأن المذكورين من أفراد القوة الملحقة بمرتبنا أدناه <b><u>متغيبون عن مقر عملهم خلال الفترة المبينة بجانب أسمائهم</u></b> , وسيتم إدراجهم على كشف الحضور الشهري متغيبين عن مقر عملهم .'

export function unitShort(unit: string | null | undefined): string {
  return (unit ?? '').replace(/^السرية\s+/u, '').trim()
}

export function letterName(row: AbsenceRegisterRowRead): string {
  return row.employee_name_ar?.trim() || row.employee_name_en || ''
}

export function returnDateIso(endIso: string): string {
  return computeEndDate(endIso, 2)
}

export function defaultCase(row: AbsenceRegisterRowRead, today: string): AbsenceCase {
  return row.end_date >= today ? 'absent' : 'returned'
}

export function absenceTableCells(rows: AbsenceRegisterRowRead[]): string[][] {
  return rows.map((row, index) => [
    String(index + 1),
    row.employee_id,
    letterName(row),
    unitShort(row.duty_unit),
    dmyPad(row.start_date),
    dmyPad(row.end_date),
    String(row.days),
    row.notes ?? '',
  ])
}

export function buildAbsenceTableHtml(rows: AbsenceRegisterRowRead[]): string {
  const headers = ABSENCE_TABLE_HEADERS.map(
    (header) => `<th style="${thStyle(HEADER_RED)}">${esc(header)}</th>`,
  ).join('')
  const body = absenceTableCells(rows)
    .map((cells) => {
      const rendered = cells
        .map((cell, index) => {
          const style = index === cells.length - 1
            ? `${TD_STYLE};color:#C00000;font-weight:bold`
            : TD_STYLE
          return `<td style="${style}">${esc(cell)}</td>`
        })
        .join('')
      return `<tr>${rendered}</tr>`
    })
    .join('')

  return (
    '<table dir="rtl" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt">' +
    `<thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`
  )
}

function returnedParagraph(rows: AbsenceEmailRow[]): string {
  const dates = [...new Set(rows.map((row) => returnDateIso(row.end_date)))]
  if (rows.length === 1) {
    const date = esc(dates[0].replaceAll('-', '/'))
    return `يطيب لنا ان نهديكم اطيب التحيات , ونفيدكم علما بأن المذكور من أفراد القوة الملحقة بمرتبنا أدناه عاد من <b><u>تغيبه بتاريخ ${date} وباشر عمله</u></b> .`
  }
  if (dates.length === 1) {
    const date = esc(dates[0].replaceAll('-', '/'))
    return `يطيب لنا ان نهديكم اطيب التحيات , ونفيدكم علما بأن المذكورين من أفراد القوة الملحقة بمرتبنا أدناه عادوا من <b><u>تغيبهم بتاريخ ${date} وباشروا عملهم</u></b> .`
  }
  return 'يطيب لنا ان نهديكم اطيب التحيات , ونفيدكم علما بأن المذكورين من أفراد القوة الملحقة بمرتبنا أدناه عادوا من <b><u>تغيبهم وباشروا عملهم في اليوم التالي للفترة المبينة بجانب أسمائهم</u></b> .'
}

const ABSENCE_CLOSING = '<b>' + buildClosing([
  'يرجى التفضل بالإطلاع وأمركم ،،،،،',
  'وأقبلوا فائق الإحترام والتقدير',
]) + '</b>'

function absenceDraftValues(rows: AbsenceEmailRow[]): Record<string, string> {
  return {
    names: rows.map(letterName).join('، '),
    count: String(rows.length),
    start_date: dmyPad(rows[0].start_date),
    end_date: dmyPad(rows[0].end_date),
    return_date: dmyPad(returnDateIso(rows[0].end_date)),
  }
}

const ABSENCE_GREETING = 'السلام عليكم ورحمة الله وبركاته'

function defaultAbsenceIntro(rows: AbsenceEmailRow[], includeGreeting = true): string {
  const paragraph = rows[0].case === 'returned'
    ? returnedParagraph(rows) : rows.length > 1 ? ABSENT_PLURAL : ABSENT_SINGULAR
  return (includeGreeting ? p(ABSENCE_GREETING) : '') + p(paragraph)
}

export function defaultAbsenceDraftText(rows: AbsenceEmailRow[]) {
  return {
    subject: ABSENCE_EMAIL_SUBJECT,
    intro: rows.length ? draftPlainText(defaultAbsenceIntro(rows)) : '',
    closing: draftPlainText(ABSENCE_CLOSING),
  }
}

export function buildAbsenceEmail(
  rows: AbsenceEmailRow[],
  opts: { violationAttached: boolean; overrides?: DraftOverrides },
): { subject: string; bodyHtml: string } {
  if (rows.length === 0) return { subject: ABSENCE_EMAIL_SUBJECT, bodyHtml: '' }

  const absent = rows.filter((row) => row.case === 'absent')
  const returned = rows.filter((row) => row.case === 'returned')
  const sections: string[] = []
  const firstOverride = opts.overrides?.[`absence:${rows[0].case}`]
  const subject = firstOverride?.subject
    ? substituteDraftText(firstOverride.subject, absenceDraftValues(rows)) : ABSENCE_EMAIL_SUBJECT

  for (const group of [absent, returned]) {
    if (!group.length) continue
    let intro = opts.overrides?.[`absence:${group[0].case}`]?.intro ?? ''
    if (sections.length && intro.startsWith(ABSENCE_GREETING)) {
      intro = intro.slice(ABSENCE_GREETING.length).trimStart()
    }
    sections.push(
      intro ? p(draftTextHtml(substituteDraftText(intro, absenceDraftValues(group))))
        : defaultAbsenceIntro(group, sections.length === 0),
      buildAbsenceTableHtml(group),
    )
  }
  if (opts.violationAttached) {
    const line = rows.length === 1
      ? 'مرفق مخالفة موقعه من قبله'
      : 'مرفق مخالفات موقعة من قبلهم'
    sections.push(p(`<b style="color:#C00000">${line}</b>`))
  }
  sections.push(firstOverride?.closing
    ? buildClosing([draftTextHtml(substituteDraftText(firstOverride.closing, absenceDraftValues(rows)))])
    : ABSENCE_CLOSING)

  return { subject, bodyHtml: sections.join('') }
}
