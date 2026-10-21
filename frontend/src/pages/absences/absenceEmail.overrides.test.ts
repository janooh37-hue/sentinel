import { describe, expect, it } from 'vitest'

import { ABSENCE_EMAIL_SUBJECT, buildAbsenceEmail, defaultAbsenceDraftText, type AbsenceEmailRow } from './absenceEmail'

const row: AbsenceEmailRow = {
  employee_id: 'G1001', employee_name_en: 'Ahmed', employee_name_ar: 'أحمد',
  duty_post: 'Guard', duty_unit: 'السرية الثالثة', start_date: '2026-06-11',
  end_date: '2026-06-15', days: 5, notes: null, case: 'absent',
}

const overrides = {
  'absence:absent': { subject: 'Absent {names}', intro: 'Absent {names}\n{start_date} — {end_date}', closing: 'Absent closing' },
  'absence:returned': { subject: 'Returned {names}', intro: 'Returned {return_date} {count}', closing: 'Returned closing' },
}

describe('absence draft overrides', () => {
  it('replaces the editable greeting along with the introduction', () => {
    const greeting = 'السلام عليكم ورحمة الله وبركاته'
    expect(defaultAbsenceDraftText([row]).intro).toContain(greeting)
    const result = buildAbsenceEmail([row], { violationAttached: false, overrides })
    expect(result.bodyHtml).not.toContain(greeting)
    expect(result.bodyHtml).toContain('Absent أحمد')
  })

  it('includes the greeting once in mixed batches even when both editable intros are supplied', () => {
    const greeting = 'السلام عليكم ورحمة الله وبركاته'
    const returned = { ...row, employee_id: 'G1002', case: 'returned' as const }
    for (const rows of [[row, returned], [returned, row]]) {
      expect(buildAbsenceEmail(rows, { violationAttached: false }).bodyHtml.split(greeting)).toHaveLength(2)
      const result = buildAbsenceEmail(rows, {
        violationAttached: false,
        overrides: {
          'absence:absent': { intro: `${greeting}\nEdited absent` },
          'absence:returned': { intro: `${greeting}\nEdited returned` },
        },
      })
      expect(result.bodyHtml.split(greeting)).toHaveLength(2)
      expect(result.bodyHtml).toContain('Edited absent')
      expect(result.bodyHtml).toContain('Edited returned')
    }
  })

  it('applies the absent introduction, subject and closing without changing the table or attachment notice', () => {
    const result = buildAbsenceEmail([row], { violationAttached: true, overrides })
    expect(result.subject).toBe('Absent أحمد')
    expect(result.bodyHtml).toContain('Absent أحمد<br>11/06/2026 — 15/06/2026')
    expect(result.bodyHtml).toContain('Absent closing')
    expect(result.bodyHtml).toContain('<table')
    expect(result.bodyHtml).toContain('مرفق مخالفة موقعه من قبله')
  })

  it('applies the returned introduction, subject and closing', () => {
    const result = buildAbsenceEmail([{ ...row, case: 'returned' }], { violationAttached: false, overrides })
    expect(result.subject).toBe('Returned أحمد')
    expect(result.bodyHtml).toContain('Returned 16/06/2026 1')
    expect(result.bodyHtml).toContain('Returned closing')
    expect(result.bodyHtml).not.toContain('Absent closing')
  })

  it('applies each section introduction in mixed batches; subject and closing follow the first selected case', () => {
    const result = buildAbsenceEmail([row, { ...row, employee_id: 'G1002', employee_name_ar: '', employee_name_en: 'Ali', case: 'returned' }], {
      violationAttached: false, overrides,
    })
    expect(result.subject).toBe('Absent أحمد، Ali')
    expect(result.bodyHtml).toContain('Absent أحمد<br>')
    expect(result.bodyHtml).toContain('Returned 16/06/2026 1')
    expect(result.bodyHtml).toContain('Absent closing')
  })

  it('falls back per field and escapes HTML and token values', () => {
    const opts = { violationAttached: false, overrides: { 'absence:absent': {
      subject: null, intro: '<b>{names}</b>\n{unknown} {name} {employee_id} {start} {end} {days} {date}', closing: '',
    } } }
    const result = buildAbsenceEmail([{ ...row, employee_name_ar: '<img>' }], opts)
    expect(result.subject).toBe(ABSENCE_EMAIL_SUBJECT)
    expect(result.bodyHtml).toContain('&lt;b&gt;&lt;img&gt;&lt;/b&gt;<br>{unknown} {name} {employee_id} {start} {end} {days} {date}')
    expect(result.bodyHtml).not.toContain('<img>')
    expect(buildAbsenceEmail([row], { violationAttached: false, overrides: { 'absence:absent': {
      subject: '', intro: null, closing: null,
    } } })).toEqual(buildAbsenceEmail([row], { violationAttached: false }))
  })
})
