import { describe, expect, it } from 'vitest'

import type { AbsenceRegisterRowRead } from '@/lib/api'

import {
  ABSENCE_EMAIL_SUBJECT,
  absenceTableCells,
  buildAbsenceEmail,
  buildAbsenceTableHtml,
  defaultCase,
  letterName,
  returnDateIso,
  unitShort,
  type AbsenceEmailRow,
} from './absenceEmail'

const row = (overrides: Partial<AbsenceRegisterRowRead> = {}): AbsenceRegisterRowRead => ({
  employee_id: 'G5130',
  employee_name_en: 'Abdulaziz',
  employee_name_ar: 'عبدالعزيز …',
  duty_post: 'Guard',
  duty_unit: 'السرية الثالثة',
  start_date: '2026-08-14',
  end_date: '2026-08-18',
  days: 5,
  notes: 'شفت مع النزول',
  ...overrides,
})

const emailRow = (
  caseValue: AbsenceEmailRow['case'],
  overrides: Partial<AbsenceRegisterRowRead> = {},
): AbsenceEmailRow => ({ ...row(overrides), case: caseValue })

describe('absence office table', () => {
  it('shortens the Arabic unit prefix and handles a missing unit', () => {
    expect(unitShort('السرية الثالثة')).toBe('الثالثة')
    expect(unitShort(null)).toBe('')
  })

  it('uses the office column order and formats dates with zero padding', () => {
    expect(absenceTableCells([row()])).toEqual([
      ['1', 'G5130', 'عبدالعزيز …', 'الثالثة', '14/08/2026', '18/08/2026', '5', 'شفت مع النزول'],
    ])
  })

  it('uses a trimmed Arabic letter name with English and empty fallbacks', () => {
    expect(letterName(row({ employee_name_ar: '  اسم عربي  ' }))).toBe('اسم عربي')
    expect(letterName(row({ employee_name_ar: '   ', employee_name_en: 'English Name' }))).toBe('English Name')
    expect(letterName(row({ employee_name_ar: null, employee_name_en: null }))).toBe('')
  })

  it('escapes user-provided notes in the HTML table', () => {
    const html = buildAbsenceTableHtml([row({ notes: '<b>x</b>' })])

    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('<b>x</b>')
  })
})

describe('absence Arabic email', () => {
  it('renders the singular still-absent wording', () => {
    const result = buildAbsenceEmail([emailRow('absent')], { violationAttached: false })

    expect(result.subject).toBe(ABSENCE_EMAIL_SUBJECT)
    expect(result.bodyHtml).toContain('متغيب عن مقر عمله')
    expect(result.bodyHtml).not.toContain('عادوا')
  })

  it('renders a singular return date as the day after the absence ends', () => {
    expect(returnDateIso('2026-08-18')).toBe('2026-08-19')

    const { bodyHtml } = buildAbsenceEmail([emailRow('returned')], { violationAttached: false })
    expect(bodyHtml).toContain('تغيبه بتاريخ 2026/08/19')
  })

  it('renders the absent section before the returned section with a table for each', () => {
    const { bodyHtml } = buildAbsenceEmail(
      [
        emailRow('returned', { employee_id: 'G5131' }),
        emailRow('absent', { employee_id: 'G5132' }),
      ],
      { violationAttached: false },
    )

    const absentParagraph = 'متغيب عن مقر عمله خلال الفترة المبينة بجانب أسمه'
    const returnedParagraph = 'تغيبه بتاريخ 2026/08/19 وباشر عمله'
    expect(bodyHtml).toContain(absentParagraph)
    expect(bodyHtml).toContain(returnedParagraph)
    expect(bodyHtml.match(/<table/g)).toHaveLength(2)
    expect(bodyHtml.indexOf(absentParagraph)).toBeLessThan(bodyHtml.indexOf(returnedParagraph))
  })

  it('uses the per-row next-day wording for returned employees with distinct dates', () => {
    const { bodyHtml } = buildAbsenceEmail(
      [
        emailRow('returned', { employee_id: 'G5131', end_date: '2026-08-18' }),
        emailRow('returned', { employee_id: 'G5132', end_date: '2026-08-20' }),
      ],
      { violationAttached: false },
    )

    expect(bodyHtml).toContain('في اليوم التالي للفترة المبينة بجانب أسمائهم')
  })

  it('adds the singular violation line only when requested', () => {
    const rows = [emailRow('absent')]

    expect(buildAbsenceEmail(rows, { violationAttached: true }).bodyHtml).toContain('مرفق مخالفة موقعه من قبله')
    expect(buildAbsenceEmail(rows, { violationAttached: false }).bodyHtml).not.toContain('مرفق مخالفة')
  })

  it('returns no body when there are no selected rows', () => {
    expect(buildAbsenceEmail([], { violationAttached: true })).toEqual({
      subject: ABSENCE_EMAIL_SUBJECT,
      bodyHtml: '',
    })
  })

  it('defaults rows ending today or later to absent and earlier rows to returned', () => {
    expect(defaultCase(row({ end_date: '2026-08-18' }), '2026-08-18')).toBe('absent')
    expect(defaultCase(row({ end_date: '2026-08-17' }), '2026-08-18')).toBe('returned')
  })
})
