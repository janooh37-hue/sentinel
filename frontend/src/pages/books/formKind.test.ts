/**
 * formKind — classified General Books carry a REAL subject; the
 * "<form> — <employee>" parsing must never chop it (2026-07-19: a subject
 * containing an em-dash displayed as just its last word, labeled
 * "Other records").
 */

import { describe, it, expect } from 'vitest'

import { subjectEmployeePart } from './formKind'

describe('subjectEmployeePart', () => {
  it('classified subject is shown whole', () => {
    expect(subjectEmployeePart('طلب صيانة — تجربة', { classified: true })).toBe(
      'طلب صيانة — تجربة',
    )
  })

  it('generated-form subjects still split to the employee part', () => {
    expect(subjectEmployeePart('Leave Application Form — Saif Rashed')).toBe('Saif Rashed')
  })
})
