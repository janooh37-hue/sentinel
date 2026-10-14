/**
 * The leave report as text: the single-employee facts and leave cells the
 * paper shows, and the whole report as General Book body HTML.
 *
 * The body is real `<table>`s, which the docx pipeline
 * (`arabic_rtl.html_to_docx`) rebuilds as Word tables. The duty-location
 * totals are a table (the bar chart is screen/print only). The report view
 * files it in Arabic; the server appends «إعداد» with the preparer's saved
 * signature.
 */
import type { TFunction } from 'i18next'

import type { EmployeeRead, LeaveListItem } from '@/lib/api'
import { splitBilingual } from '@/lib/bilingualValue'
import { pickEmployeeName } from '@/lib/employeeName'

import { canonStatus } from '../lifecycle'
import { leaveEmployeeName } from '../leaveEmployeeName'
import { addDays, fmtDayMonthYear, fmtMonthYear } from './fmt'
import { kindMeta } from './kinds'
import { employeeProfile, kindAggregates, periodLeaves, type DayWindow, type ReportSection } from './reportData'

/** A stored leave type, translated when known, else its half in the UI language. */
export function kindLabel(t: TFunction, lang: string, raw: string): string {
  return t(`leaves.type.${raw}`, { defaultValue: splitBilingual(raw, lang) })
}

const fmtDate = (iso: string | null | undefined, locale: string): string =>
  iso ? fmtDayMonthYear(iso, locale) : '—'

/** The employee header card: label → value. */
export function employeeFacts(
  t: TFunction,
  lang: string,
  locale: string,
  employeeId: string,
  emp: EmployeeRead | undefined,
): [string, string][] {
  const position = lang.startsWith('ar') ? emp?.position_ar || emp?.position : emp?.position
  return [
    [t('employees.fields.id'), employeeId],
    [t('leaves.report.colName'), emp ? pickEmployeeName(emp, lang) : '—'],
    [t('employees.fields.position'), position || '—'],
    [t('leaves.report.optCompany'), emp?.duty_unit?.trim() || t('dutyLocations.unassigned')],
    [t('employees.fields.status'), emp ? t(`employees.status.${emp.status}`) : '—'],
    [t('employees.fields.doj'), fmtDate(emp?.doj, locale)],
  ]
}

/** One leave in the single-employee list: type, from, to, days, status, return. */
export function leaveCells(t: TFunction, lang: string, locale: string, r: LeaveListItem): string[] {
  const status = canonStatus(r.status)
  return [
    kindLabel(t, lang, r.leave_type),
    fmtDate(r.start_date, locale),
    fmtDate(r.end_date, locale),
    String(r.days),
    t(`leaves.status.${status}`, { defaultValue: status }),
    fmtDate(r.return_date, locale),
  ]
}

const TH = 'border:1px solid #000000;background:#D9D9D9;padding:4px 6px;text-align:center;font-weight:bold'
const TD = 'border:1px solid #000000;padding:4px 6px;text-align:center'

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

interface ReportBodyInput {
  t: TFunction
  lang: string
  locale: string
  /** The paper's scope line (period, company, staff, …). */
  facts: string[]
  sections: ReportSection[]
  /** The report's scoped rows and period, for the single-employee part. */
  rows: LeaveListItem[]
  window: DayWindow
  employee?: { id: string; emp: EmployeeRead | undefined; all: LeaveListItem[]; today: string }
}

export function reportBodyHtml({ t, lang, locale, facts, sections, rows, window, employee }: ReportBodyInput): string {
  const dir = lang.startsWith('ar') ? 'rtl' : 'ltr'
  const para = (text: string, bold = false): string =>
    `<p dir="${dir}">${bold ? `<b>${esc(text)}</b>` : esc(text)}</p>`
  const heading = (text: string): string => `<p>&nbsp;</p>${para(text, true)}`
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
  const out: string[] = []
  if (facts.length > 0) out.push(para(facts.join(' · ')))

  if (employee) {
    const profile = employeeProfile(employee.all, employee.id, employee.today)
    const kinds = kindAggregates(rows, window)
    out.push(
      heading(t('leaves.report.empDetails')),
      table(
        [t('leaves.report.empField'), t('leaves.report.empValue')],
        [35, 65],
        employeeFacts(t, lang, locale, employee.id, employee.emp),
      ),
      '<p>&nbsp;</p>',
      para(
        `${t('leaves.report.profileCurrent')}: ${
          profile.current
            ? `${kindLabel(t, lang, profile.current.leave_type)} · ${fmtDate(profile.current.start_date, locale)} – ${fmtDate(profile.current.end_date, locale)} · ${t('leaves.report.expectedReturn')}: ${fmtDate(addDays(profile.current.end_date, 1), locale)}`
            : t('leaves.report.profileNotOnLeave')
        }`,
      ),
      para(
        `${t('leaves.report.profileLast')}: ${
          profile.last
            ? `${kindLabel(t, lang, profile.last.leave_type)} · ${fmtDate(profile.last.start_date, locale)} – ${fmtDate(profile.last.end_date, locale)} · ${t('leaves.report.colReturn')}: ${fmtDate(profile.last.return_date, locale)}`
            : t('leaves.report.profileNone')
        }`,
      ),
      heading(t('leaves.report.daysByKind')),
      table(
        [t('leaves.report.colKind'), t('leaves.report.colRecords'), t('leaves.report.colTotalDays')],
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
          t('leaves.report.colReturn'),
        ],
        [5, 25, 16, 16, 8, 13, 17],
        periodLeaves(rows, window).map((r, i) => [String(i + 1), ...leaveCells(t, lang, locale, r)]),
      ),
    )
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
        [t('leaves.report.totalEmployees', { count: s.lines.length }), String(s.days)],
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
