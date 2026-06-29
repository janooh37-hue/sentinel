// frontend/src/lib/basketEmail.transfer.test.ts
import { describe, expect, it } from 'vitest'
import { buildBasketBodyHtml, buildBasketSubject } from './basketEmail'
import type { EmailBasketItem } from './emailBasket'

const transferItem = (over: Partial<EmailBasketItem> = {}): EmailBasketItem => ({
  bookId: 1, docId: 2, ref: '1/ 12 /GSSG/ 106', employeeId: '', nameEn: '', nameAr: null,
  formKind: 'General Book', detail: 'النقل', bookDate: '2026-06-11', ...over,
})

describe('transfer cover email', () => {
  it('subject is تنقلات يوم {date} (zero-padded)', () => {
    expect(buildBasketSubject([transferItem()])).toBe('تنقلات يوم 11/06/2026')
  })

  it('body is the narrative cover email citing ref + date, no table', () => {
    const html = buildBasketBodyHtml([transferItem()])
    expect(html).toContain('السلام عليكم ورحمة الله وبركاته :')
    expect(html).toContain('نتقدم إليكم بخالص التحية و التقدير')
    expect(html).toContain('مضمون الكتاب الرقم 1/ 12 /GSSG/ 106 تاريخ 11/06/2026 م')
    expect(html).toContain('للتفضل بالعلم ولإجراءاتكم لطفاً.')
    expect(html).toContain('هذا وتفضلوا بقبول فائق الإحترام والتقدير.')
    expect(html).not.toContain('<table')   // no inline table
  })

  it('a non-transfer General Book still uses the generic branch', () => {
    const html = buildBasketBodyHtml([transferItem({ detail: 'كتاب عام آخر' })])
    expect(html).toContain('البيان')        // generic table column
  })
})
