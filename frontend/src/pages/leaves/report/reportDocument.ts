/**
 * The leave report as text: the single-employee facts and leave cells the
 * paper shows, and the whole report as General Book body HTML.
 *
 * The body is real `<table>`s, which the docx pipeline
 * (`arabic_rtl.html_to_docx`) rebuilds as Word tables. The duty-location
 * totals are a table (the bar chart is screen/print only). The report view
 * files it in Arabic; the General Book paper prints the greeting
 * («…ننوه على الموضوع أعلاه انه») right before the body, so the body opens
 * with the sentence that finishes it. The server appends «إعداد» with the
 * preparer's saved signature.
 */
import type { TFunction } from 'i18next'

import type { EmployeeRead, LeaveListItem } from '@/lib/api'
import { splitBilingual } from '@/lib/bilingualValue'
import { pickEmployeeName } from '@/lib/employeeName'

import { canonStatus } from '../lifecycle'
import { leaveEmployeeName } from '../leaveEmployeeName'
import { addDays, fmtDayMonthYear, fmtMonthYear } from './fmt'
import { kindMeta } from './kinds'
import {
  employeeProfile,
  kindAggregates,
  periodLeaves,
  type DayWindow,
  type ReportPeriod,
  type ReportSection,
} from './reportData'

/** A stored leave type, translated when known, else its half in the UI language. */
export function kindLabel(t: TFunction, lang: string, raw: string): string {
  return t(`leaves.type.${raw}`, { defaultValue: splitBilingual(raw, lang) })
}

type DateFmt = (iso: string | null | undefined) => string

const wordDate =
  (locale: string): DateFmt =>
  (iso) =>
    iso ? fmtDayMonthYear(iso, locale) : '—'

/** "13/08/2026", the Report paper's compact date: Word shows it as
 * 2026/08/13 in an Arabic line, and it never wraps inside a table cell. */
const numDate: DateFmt = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')

/** The employee header card: label → value. */
export function employeeFacts(
  t: TFunction,
  lang: string,
  locale: string,
  employeeId: string,
  emp: EmployeeRead | undefined,
  date: DateFmt = wordDate(locale),
): [string, string][] {
  const position = lang.startsWith('ar') ? emp?.position_ar || emp?.position : emp?.position
  return [
    [t('employees.fields.id'), employeeId],
    [t('leaves.report.colName'), emp ? pickEmployeeName(emp, lang) : '—'],
    [t('employees.fields.position'), position || '—'],
    [t('leaves.report.optCompany'), emp?.duty_unit?.trim() || t('dutyLocations.unassigned')],
    [t('employees.fields.status'), emp ? t(`employees.status.${emp.status}`) : '—'],
    [t('employees.fields.doj'), date(emp?.doj)],
  ]
}

/** One leave in the single-employee list: type, from, to, days, status, return. */
export function leaveCells(
  t: TFunction,
  lang: string,
  locale: string,
  r: LeaveListItem,
  date: DateFmt = wordDate(locale),
): string[] {
  const status = canonStatus(r.status)
  return [
    kindLabel(t, lang, r.leave_type),
    date(r.start_date),
    date(r.end_date),
    String(r.days),
    t(`leaves.status.${status}`, { defaultValue: status }),
    date(r.return_date),
  ]
}

/** The filed period in words: "شهر أغسطس 2026", "عام 2026", or a date range. */
function filedPeriod(t: TFunction, locale: string, period: ReportPeriod): string {
  if (period.mode === 'month') return t('leaves.report.filedPeriodMonth', { month: fmtMonthYear(period.month, locale) })
  if (period.mode === 'year') return t('leaves.report.filedPeriodYear', { year: period.year })
  return t('leaves.report.filedPeriodRange', {
    from: period.from ? numDate(period.from) : '…',
    to: period.to ? numDate(period.to) : '…',
  })
}

/** Who and what the filed report covers. */
export interface FiledScope {
  period: ReportPeriod
  /** The picked company (duty unit) label, when the report is scoped to one. */
  company?: string
  /** The picked employee, when the report is scoped to one. */
  employee?: { id: string; name: string }
  /** Narrowing filters in words (leave types, staff, statuses); empty = all. */
  limits: string[]
}

/** The General Book subject: one natural Arabic line, no `·` chain. */
export function filedSubject(t: TFunction, locale: string, { period, company, employee }: FiledScope): string {
  const when = filedPeriod(t, locale, period)
  if (employee) return t('leaves.report.sendSubjectEmployee', { name: employee.name, period: when })
  const subject = t('leaves.report.sendSubject', { period: when })
  return company ? `${subject} — ${company}` : subject
}

const TH = 'border:1px solid #000000;background:#D9D9D9;padding:4px 6px;text-align:center;font-weight:bold'
const TD = 'border:1px solid #000000;padding:4px 6px;text-align:center'

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

interface ReportBodyInput {
  t: TFunction
  lang: string
  locale: string
  scope: FiledScope
  sections: ReportSection[]
  /** The report's scoped rows and period, for the single-employee part. */
  rows: LeaveListItem[]
  window: DayWindow
  /** Set when `scope.employee` is: the employee record and every fetched row. */
  employee?: { emp: EmployeeRead | undefined; all: LeaveListItem[]; today: string }
}

export function reportBodyHtml({ t, lang, locale, scope, sections, rows, window, employee }: ReportBodyInput): string {
  const dir = lang.startsWith('ar') ? 'rtl' : 'ltr'
  const para = (text: string, bold = false): string =>
    `<p dir="${dir}">${bold ? `<b>${esc(text)}</b>` : esc(text)}</p>`
  const blank = '<p>&nbsp;</p>'
  // One blank line before each heading. The intro lands in the paper's body
  // paragraph, which already spaces after itself, so a heading right after it
  // takes none.
  let afterIntro = scope.limits.length === 0
  const heading = (text: string): string => {
    const gap = afterIntro ? '' : blank
    afterIntro = false
    return gap + para(text, true)
  }
  /** `widths`: relative column widths (the docx renderer reads `<col width>`). */
  const table = (head: string[], widths: number[], body: string[][], total?: [string, string]): string => {
    const cols = widths.map((w) => `<col width="${w}">`).join('')
    const th = head.map((h) => `<th style="${TH}">${esc(h)}</th>`).join('')
    const tr = body.map((r) => `<tr>${r.map((c) => `<td style="${TD}">${esc(c)}</td>`).join('')}</tr>`).join('')
    const foot = total
      ? `<tr><td style="${TH}" colspan="${head.length - 1}">${esc(total[0])}</td><td style="${TH}">${esc(total[1])}</td></tr>`
      : ''
    return `<table dir="${dir}" style="border-collapse:collapse"><colgroup>${cols}</colgroup><thead><tr>${th}</tr></thead><tbody>${tr}${foot}</tbody></table>`
  }

  const when = filedPeriod(t, locale, scope.period)
  const out = [
    para(
      scope.employee
        ? t('leaves.report.filedIntroEmployee', { name: scope.employee.name, id: scope.employee.id, period: when })
        : scope.company
          ? t('leaves.report.filedIntroCompany', { company: scope.company, period: when })
          : t('leaves.report.filedIntro', { period: when }),
    ),
  ]
  if (scope.limits.length > 0) out.push(para(t('leaves.report.filedLimits', { list: scope.limits.join('، ') })))

  // One employee: their details, leave days by type and the leaves themselves.
  // The month roster and duty-location totals would repeat the same person.
  if (scope.employee) {
    const id = scope.employee.id
    const { current } = employeeProfile(employee?.all ?? rows, id, employee?.today ?? '')
    const kinds = kindAggregates(rows, window)
    const facts = employeeFacts(t, lang, locale, id, employee?.emp, numDate).filter(
      ([label]) => label !== t('employees.fields.status'),
    )
    const leaves = periodLeaves(rows, window)
    const withReturn = leaves.some((r) => r.return_date)
    out.push(
      heading(t('leaves.report.empDetails')),
      table(
        facts.map(([label]) => label),
        [15, 33, 19, 17, 16],
        [facts.map(([, value]) => value)],
      ),
    )
    if (current)
      out.push(
        blank,
        para(
          t('leaves.report.filedCurrent', {
            kind: kindLabel(t, lang, current.leave_type),
            from: numDate(current.start_date),
            to: numDate(current.end_date),
            back: numDate(addDays(current.end_date, 1)),
          }),
        ),
      )
    out.push(
      heading(t('leaves.report.daysByKind')),
      table(
        [t('leaves.report.colKind'), t('leaves.report.colLeaves'), t('leaves.report.colTotalDays')],
        [60, 20, 20],
        kinds.map((k) => [t(kindMeta(k.kind).i18nKey), String(k.records), String(k.days)]),
        [t('leaves.report.total'), String(kinds.reduce((s, k) => s + k.days, 0))],
      ),
      heading(t('leaves.report.leavesInPeriod')),
      table(
        [
          '#',
          t('leaves.report.colKind'),
          t('leaves.report.colFrom'),
          t('leaves.report.colTo'),
          t('leaves.report.colDays'),
          t('leaves.columns.status'),
          ...(withReturn ? [t('leaves.report.colReturn')] : []),
        ],
        withReturn ? [5, 25, 16, 16, 8, 14, 16] : [6, 30, 18, 18, 10, 18],
        leaves.map((r, i) => [String(i + 1), ...leaveCells(t, lang, locale, r, numDate).slice(0, withReturn ? 6 : 5)]),
      ),
    )
    return out.join('')
  }

  for (const s of sections) {
    out.push(
      heading(fmtMonthYear(s.month, locale)),
      table(
        ['#', t('leaves.report.colId'), t('leaves.report.colName'), t('leaves.report.colUnit'), t('leaves.report.colTotalDays')],
        [6, 13, 43, 24, 14],
        s.lines.map((l, i) => [
          String(i + 1),
          l.row.employee_id,
          leaveEmployeeName(l.row, lang),
          l.unit || t('dutyLocations.unassigned'),
          String(l.days),
        ]),
        [`${t('leaves.report.total')}: ${t('leaves.report.totalsEmployees', { count: s.lines.length })}`, String(s.days)],
      ),
      heading(t('leaves.report.daysByUnit')),
      table(
        [t('leaves.report.colUnit'), t('leaves.report.colEmployees'), t('leaves.report.colTotalDays')],
        [50, 25, 25],
        s.units.map((u) => [u.unit || t('dutyLocations.unassigned'), String(u.employees), String(u.days)]),
      ),
    )
  }
  return out.join('')
}
