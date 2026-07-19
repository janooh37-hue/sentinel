/**
 * formKind — classified General Books carry a REAL subject; the
 * "<form> — <employee>" parsing must never chop it (2026-07-19: a subject
 * containing an em-dash displayed as just its last word, labeled
 * "Other records").
 */

import { describe, it, expect } from 'vitest'

import { formKindOf, subjectEmployeePart, GENERAL_BOOK_KIND } from './formKind'

describe('formKindOf', () => {
  it('classified books are General Book, never chopped', () => {
    const kind = formKindOf('طلب صيانة أجهزة التكييف — تجربة', { classified: true })
    expect(kind).toBe(GENERAL_BOOK_KIND)
    expect(kind.labelKey).toBe('books.formKind.generalBook')
  })

  it('generated-form subjects still map to their kind', () => {
    expect(formKindOf('Leave Application Form — Saif Rashed').id).toBe('leave')
  })

  it('unknown non-classified subjects stay Other', () => {
    expect(formKindOf('Some random subject').id).toBe('other')
  })
})

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
