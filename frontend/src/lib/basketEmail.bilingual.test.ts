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

function bilingualVariants(items: EmailBasketItem[]) {
  const { tableVariants } = buildBasketPrefill(items, [])
  if (!tableVariants) throw new Error('Expected a bilingual letter')
  return tableVariants
}

function letterTable(html: string): HTMLTableElement {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (!table) throw new Error('Expected a letter table')
  return table
}

function employeeNames(html: string): string[][] {
  return Array.from(letterTable(html).tBodies[0].rows, (row) =>
    [row.cells[1].textContent ?? '', row.cells[3].textContent ?? ''],
  )
}

const SECOND_EMPLOYEE = item({ bookId: 2, employeeId: 'G4072', nameAr: 'سالم علي', nameEn: 'Salem Ali' })

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
    const { ar, en } = bilingualVariants([item()])
    // Operator typed a comment and corrected the name before switching.
    const editedTable = ar
      .replace('<td style="border:1px solid #000000;padding:4px 9px;text-align:center"></td></tr>',
        '<td style="border:1px solid #000000;padding:4px 9px;text-align:center">عاد مبكراً</td></tr>')
      .replace('عبدالله أباه', 'عبدالله محمد أباه')
    const edited = `<p>edited intro</p>${editedTable}<p>edited closing</p>`

    const { html: swapped } = swapLetterTable(edited, ar, en)
    expect(swapped).toContain('edited intro')
    expect(swapped).toContain('edited closing')
    expect(swapped).toContain('dir="ltr"')
    expect(headers(swapped)).toEqual(headers(en))
    expect(cells(swapped)).toEqual([
      '1', 'G3085', 'حارس أمن', 'عبدالله محمد أباه', 'Oman', '0501234567', '0331',
      '1/8/2026', '31/8/2026', '1/9/2026', 'عاد مبكراً',
    ])
  })

  it.each([
    ['ar', 'en', 'عبدالله أباه', 'Abdellahi Abah', 'Oman', 'سلطنة عُمان'],
    ['en', 'ar', 'Abdellahi Abah', 'عبدالله أباه', 'سلطنة عُمان', 'Oman'],
  ] as const)('keeps a name corrected to the %s table’s other language value after a round trip',
    (from, to, original, correction, translatedNationality, originalNationality) => {
      const variants = bilingualVariants([item()])
      const first = swapLetterTable(variants[from].replace(original, correction), variants[from], variants[to])
      expect(cells(first.html).slice(3, 5)).toEqual([correction, translatedNationality])

      const second = swapLetterTable(first.html, variants[to], variants[from], first.edited)
      expect(cells(second.html).slice(3, 5)).toEqual([correction, originalNationality])
    },
  )

  it('keeps a corrected HR Request certificate type after a round trip', () => {
    const { ar, en } = bilingualVariants([item({
      formKind: 'HR Request Form', leaveType: undefined, hrDocs: ['salary_certificate'],
    })])
    const corrected = ar.replace('شهادة راتب', 'Salary Certificate')
    const english = swapLetterTable(corrected, ar, en)
    expect(cells(english.html).slice(2, 4)).toEqual(['Abdellahi Abah', 'Salary Certificate'])

    const arabic = swapLetterTable(english.html, en, ar, english.edited)
    expect(cells(arabic.html).slice(2, 4)).toEqual(['عبدالله أباه', 'Salary Certificate'])
  })

  it('translates reordered rows without substituting another employee’s values', () => {
    const { ar, en } = bilingualVariants([item(), SECOND_EMPLOYEE])
    const table = letterTable(ar)
    const body = table.tBodies[0]
    body.prepend(body.rows[1])

    const result = swapLetterTable(table.outerHTML, ar, en)
    expect(employeeNames(result.html)).toEqual([
      ['G4072', 'Salem Ali'],
      ['G3085', 'Abdellahi Abah'],
    ])
  })

  it('translates the remaining employee after a row is deleted', () => {
    const { ar, en } = bilingualVariants([item(), SECOND_EMPLOYEE])
    const table = letterTable(ar)
    const body = table.tBodies[0]
    body.deleteRow(0)

    const result = swapLetterTable(table.outerHTML, ar, en)
    expect(employeeNames(result.html)).toEqual([['G4072', 'Salem Ali']])
  })

  it('matches repeated employee IDs by occurrence', () => {
    const { ar, en } = bilingualVariants([
      item(), SECOND_EMPLOYEE, item({ bookId: 3, nameAr: 'عبدالله أباه الثاني', nameEn: 'Abdellahi Abah II' }),
    ])
    const table = letterTable(ar)
    const body = table.tBodies[0]
    body.prepend(body.rows[1])

    const result = swapLetterTable(table.outerHTML, ar, en)
    expect(employeeNames(result.html)).toEqual([
      ['G4072', 'Salem Ali'],
      ['G3085', 'Abdellahi Abah'],
      ['G3085', 'Abdellahi Abah II'],
    ])
  })

  it('leaves an added unknown employee row untouched', () => {
    const { ar, en } = bilingualVariants([item()])
    const table = letterTable(ar)
    const body = table.tBodies[0]
    body.prepend(body.rows[0].cloneNode(true))
    body.rows[0].cells[1].textContent = 'G9999'

    const result = swapLetterTable(table.outerHTML, ar, en)
    expect(employeeNames(result.html)).toEqual([
      ['G9999', 'عبدالله أباه'],
      ['G3085', 'Abdellahi Abah'],
    ])
  })
})
