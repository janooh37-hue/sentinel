/**
 * The name Save as PDF suggests, which HR files the sheet by:
 *
 *   نوع الكشف_مكان العمل_اليوم_الوردية_التاريخ
 *
 * Five fields, Arabic except the date, and never a hole: a field with nothing
 * behind it, a printout spanning two companies, or a unit name carrying a slash
 * all have to produce a filename the operating system will accept.
 */
import { describe, expect, it } from 'vitest'

import type { AttendanceRow } from './attendanceModel'
import { attendancePrintFilename } from './printFilename'

function row(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    employee_id: 'G9001',
    name_en: 'Ahmed Al Mansoori',
    name_ar: 'أحمد المنصوري',
    duty_unit: 'السرية الرابعة',
    duty_post: 'البوابة الرئيسية',
    shift_code: 'morning',
    punch_count: 0,
    on_leave: false,
    ...overrides,
  } as AttendanceRow
}

describe('attendancePrintFilename', () => {
  it('names the audit sheet exactly as the registry files it', () => {
    expect(
      attendancePrintFilename({
        layout: 'roster',
        rows: [row()],
        operationalDate: '2026-08-20',
        shiftCode: null,
      }),
    ).toBe('كشف تدقيق الحضور_السرية الرابعة_الخميس_صباحية_20-08-2026')
  })

  it('names the general biometric sheet, weekday derived from the date', () => {
    expect(
      attendancePrintFilename({
        layout: 'sheet',
        rows: [row({ duty_unit: 'السرية الثانية', shift_code: 'night' })],
        operationalDate: '2026-08-23',
        shiftCode: null,
      }),
    ).toBe('كشف البصمة العام_السرية الثانية_الأحد_ليلية_23-08-2026')
  })

  it('names the per-shift sheet, and calls the noon duty an evening one', () => {
    expect(
      attendancePrintFilename({
        layout: 'shift',
        rows: [row({ shift_code: 'noon' })],
        operationalDate: '2026-08-19',
        shiftCode: 'noon',
      }),
    ).toBe('كشف الحضور الوظيفي_السرية الرابعة_الأربعاء_مسائية_19-08-2026')
  })

  it('takes the shift from the active filter even when the day is empty', () => {
    expect(
      attendancePrintFilename({
        layout: 'sheet',
        rows: [],
        operationalDate: '2026-08-20',
        shiftCode: 'night',
      }),
    ).toBe('كشف البصمة العام_غير محدد_الخميس_ليلية_20-08-2026')
  })

  it('states the plural instead of picking one of two companies or shifts', () => {
    // The unfiltered day is the common case: two companies on the same date is
    // the rotation, not an anomaly, and the paper must not claim to be one of them.
    expect(
      attendancePrintFilename({
        layout: 'sheet',
        rows: [row(), row({ duty_unit: 'السرية الثالثة', shift_code: 'night' })],
        operationalDate: '2026-08-20',
        shiftCode: null,
      }),
    ).toBe('كشف البصمة العام_كل السرايا_الخميس_كل الورديات_20-08-2026')
  })

  it('names the office duty once, not on both sides of the weekday', () => {
    // The office duty is its own workplace AND its own shift, and the register
    // came out as «…_الدوام الرسمي_الخميس_الدوام الرسمي_…».
    const name = attendancePrintFilename({
      layout: 'sheet',
      rows: [row({ duty_unit: 'الدوام الرسمي', shift_code: 'office_day' })],
      operationalDate: '2026-08-20',
      shiftCode: 'office_day',
    })

    expect(name).toBe('كشف البصمة العام_الدوام الرسمي_الخميس_20-08-2026')
    expect(name.split('_')).toHaveLength(4)
  })

  it('never lets a missing value reach the name', () => {
    const name = attendancePrintFilename({
      layout: 'roster',
      rows: [row({ duty_unit: null, shift_code: null })],
      operationalDate: '2026-08-20',
      shiftCode: null,
    })

    expect(name).toBe('كشف تدقيق الحضور_غير محدد_الخميس_غير محدد_20-08-2026')
    expect(name).not.toMatch(/undefined|null|__/)
  })

  it('never lets an unsaveable character reach the name', () => {
    // A unit typed with a slash, and one with the field separator in it: the
    // first is rejected by the filesystem, the second would fake a sixth field.
    const name = attendancePrintFilename({
      layout: 'shift',
      rows: [row({ duty_unit: ' السرية الرابعة / ب*  _ الشمالية. ' })],
      operationalDate: '2026-08-20',
      shiftCode: null,
    })

    expect(name).toBe('كشف الحضور الوظيفي_السرية الرابعة ب الشمالية_الخميس_صباحية_20-08-2026')
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
    expect(name.split('_')).toHaveLength(5)
  })

  it('strips the bidi controls a pasted unit name carries', () => {
    // U+202B/U+202C survive a copy out of Word and are invisible in the
    // database, but one of them reorders the whole displayed filename — the
    // date would appear to move to the wrong end of the name.
    const name = attendancePrintFilename({
      layout: 'sheet',
      rows: [row({ duty_unit: '\u202bالسرية الرابعة\u202c' })],
      operationalDate: '2026-08-20',
      shiftCode: null,
    })

    expect(name).toBe('كشف البصمة العام_السرية الرابعة_الخميس_صباحية_20-08-2026')
    expect(name).not.toMatch(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/)
  })

  it('keeps a shift code with no Arabic word yet off an Arabic filename', () => {
    // Everything but the date is Arabic, so an untranslated enum value is a
    // defect in the name, not a helpful diagnostic.
    const name = attendancePrintFilename({
      layout: 'roster',
      rows: [],
      operationalDate: '2026-08-20',
      shiftCode: 'split_duty',
    })

    expect(name).toBe('كشف تدقيق الحضور_غير محدد_الخميس_غير محدد_20-08-2026')
    expect(name).not.toMatch(/[A-Za-z]/)
  })

  it('still produces a saveable name when the date in the URL is junk', () => {
    const name = attendancePrintFilename({
      layout: 'sheet',
      rows: [row()],
      operationalDate: 'yesterday',
      shiftCode: null,
    })

    expect(name).toBe('كشف البصمة العام_السرية الرابعة_غير محدد_صباحية_غير محدد')
  })
})
