import { afterEach, describe, expect, it } from 'vitest'

import { buildBasketBodyHtml, buildBasketPrefill, saveTableLanguage, swapLetterTable } from './basketEmail'
import type { EmailBasketItem } from './emailBasket'

function item(overrides: Partial<EmailBasketItem> = {}): EmailBasketItem {
  return {
    bookId: 1,
    docId: 10,
    ref: 'GSSG/1',
    employeeId: 'G3085',
    nameEn: 'Abdellahi Abah',
    nameAr: 'عبدالله أباه',
    formKind: 'Leave Application Form',
    leaveType: 'Annual',
    detail: '',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    positionAr: 'حارس أمن',
    nationality: 'سلطنة عُمان',
    phone: '0501234567',
    ...overrides,
  }
}

function headers(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return [...doc.querySelectorAll('th')].map((th) => th.textContent ?? '')
}

function cells(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return [...doc.querySelectorAll('tbody td')].map((td) => td.textContent ?? '')
}

afterEach(() => localStorage.clear())

describe('annual leave table', () => {
  it('reads left to right in English with the resumption day after the leave', () => {
    const html = buildBasketBodyHtml([item()], undefined, 'en')
    expect(html).toContain('<table dir="ltr"')
    expect(headers(html)).toEqual([
      'S.N', 'ID', 'Designation', 'NAME', 'Nationality', 'Mobile', 'Location',
      'FROM', 'TO', 'DUTY RESUMPTION DATE', 'COMMENTS',
    ])
    expect(cells(html)).toEqual([
      '1', 'G3085', 'حارس أمن', 'Abdellahi Abah', 'Oman', '0501234567', '0331',
      '1/8/2026', '31/8/2026', '1/9/2026', '',
    ])
  })

  it('prints the short English country name for every stored spelling', () => {
    const nationalities = ['الإمارات', 'الامارات', 'المملكة العربية السعودية', 'الأردن', 'مصر', 'Atlantis']
      .map((nationality) => cells(buildBasketBodyHtml([item({ nationality })], undefined, 'en'))[4])
    expect(nationalities).toEqual(['UAE', 'UAE', 'KSA', 'Jordan', 'Egypt', 'Atlantis'])
  })

  it('reads right to left in Arabic with the stored Arabic values', () => {
    const html = buildBasketBodyHtml([item()], undefined, 'ar')
    expect(html).toContain('<table dir="rtl"')
    expect(headers(html)).toEqual([
      'م', 'الرقم الوظيفي', 'المسمى الوظيفي', 'الاسم', 'الجنسية', 'رقم الهاتف', 'الموقع',
      'تاريخ الإجازة', 'ولغاية', 'تاريخ استئناف الواجب', 'ملاحظات',
    ])
    expect(cells(html).slice(3, 5)).toEqual(['عبدالله أباه', 'سلطنة عُمان'])
  })
})

it('duty resumption table carries the filed resumption date', () => {
  const resumption = item({
    formKind: 'Duty Resumption Form', leaveType: undefined, resumptionDate: '2026-09-02',
  })
  const html = buildBasketBodyHtml([resumption], undefined, 'en')
  expect(headers(html)).toEqual([
    'S.N', 'ID', 'Designation', 'NAME', 'Nationality', 'Mobile', 'Location',
    'DUTY RESUMPTION DATE', 'COMMENTS',
  ])
  expect(cells(html)[7]).toBe('2/9/2026')
})

it('HR request table names the certificates and the entity', () => {
  const request = item({
    formKind: 'HR Request Form',
    leaveType: undefined,
    hrDocs: ['employment_certificate', 'salary_pay_slip'],
    hrDocOther: 'Bank letter',
    addressedTo: 'ADIB',
  })
  const en = buildBasketBodyHtml([request], undefined, 'en')
  expect(headers(en)).toEqual(['#', 'ID', 'Name', 'Type of Certificate', 'The entity'])
  expect(cells(en)).toEqual([
    '1', 'G3085', 'Abdellahi Abah',
    'To Whom It May Concern Certificate + Salary Pay Slip + Bank letter', 'ADIB',
  ])
  expect(cells(buildBasketBodyHtml([request], undefined, 'ar'))[3])
    .toBe('شهادة لمن يهمه الأمر + قسيمة الراتب + Bank letter')
})

describe('compose prefill', () => {
  it('offers both table languages and opens in the last one picked', () => {
    saveTableLanguage('en')
    const prefill = buildBasketPrefill([item()], [])
    expect(prefill.tableLanguage).toBe('en')
    expect(prefill.bodyHtml).toContain(prefill.tableVariants?.en)
    expect(prefill.tableVariants?.ar).toContain('dir="rtl"')
  })

  it('offers no language choice for letters with a fixed table', () => {
    const prefill = buildBasketPrefill([item({ leaveType: 'Sick' })], [])
    expect(prefill.tableVariants).toBeUndefined()
  })

  it('translates the table but keeps the operator’s edits', () => {
    const { tableVariants } = buildBasketPrefill([item()], [])
    const ar = tableVariants?.ar ?? ''
    const en = tableVariants?.en ?? ''
    // Operator typed a comment and corrected the name before switching.
    const editedTable = ar
      .replace('<td style="border:1px solid #000000;padding:4px 9px;text-align:center"></td></tr>',
        '<td style="border:1px solid #000000;padding:4px 9px;text-align:center">عاد مبكراً</td></tr>')
      .replace('عبدالله أباه', 'عبدالله محمد أباه')
    const edited = `<p>edited intro</p>${editedTable}<p>edited closing</p>`

    const swapped = swapLetterTable(edited, ar, en)
    expect(swapped).toContain('edited intro')
    expect(swapped).toContain('edited closing')
    expect(swapped).toContain('dir="ltr"')
    expect(headers(swapped)).toEqual(headers(en))
    expect(cells(swapped)).toEqual([
      '1', 'G3085', 'حارس أمن', 'عبدالله محمد أباه', 'Oman', '0501234567', '0331',
      '1/8/2026', '31/8/2026', '1/9/2026', 'عاد مبكراً',
    ])
  })
})
