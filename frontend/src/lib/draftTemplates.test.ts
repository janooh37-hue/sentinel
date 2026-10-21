import { createElement } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { buildBasketBodyHtml, buildBasketPrefill, buildBasketSubject } from '@/lib/basketEmail'
import { defaultDraftText, draftKeysForService, renderDraftSample, useDraftVariants } from '@/lib/draftTemplates'
import type { DraftOverrides } from '@/lib/draftTemplates'
import type { EmailBasketItem } from '@/lib/emailBasket'
import { deriveRecordItem } from '@/pages/books/recordsBasket'

const item: EmailBasketItem = {
  bookId: 1, docId: 2, ref: 'REF-1', employeeId: 'G1001',
  nameEn: 'Ahmed', nameAr: 'أحمد', formKind: 'General Book',
  classificationCode: '5/1', detail: 'كتاب', bookDate: '2026-06-11',
  bankName: 'Bank & Co', startDate: '2026-06-01', endDate: '2026-06-02',
}

afterEach(() => vi.restoreAllMocks())

describe('draft template rendering', () => {
  it('resolves classification → generic → defaults separately for each field', () => {
    const overrides: DraftOverrides = {
      'General Book': { subject: 'generic {ref}', intro: 'generic introduction', closing: 'generic closing' },
      'classification:5/1': { subject: 'permit {ref}', intro: '', closing: 'permit closing' },
    }
    expect(buildBasketSubject([item], overrides)).toBe('permit REF-1')
    const html = buildBasketBodyHtml([item], overrides)
    expect(html).toContain('generic introduction')
    expect(html).toContain('permit closing')
    expect(html).toContain('<table')
    const unclassified = { ...item, classificationCode: '6/1' }
    expect(buildBasketSubject([unclassified], overrides)).toBe('generic REF-1')
    expect(buildBasketBodyHtml([unclassified], overrides)).toContain('generic closing')
    expect(buildBasketSubject([unclassified], {})).toBe('General Book')
    expect(buildBasketBodyHtml([unclassified], {})).toBe(buildBasketBodyHtml([unclassified]))
    expect(buildBasketSubject([item], { 'classification:5/1': { subject: null } })).toBe('General Book')
    expect(buildBasketBodyHtml([item], { 'classification:5/1': { intro: null, closing: '' } }))
      .toBe(buildBasketBodyHtml([item]))
  })

  it('uses the generic override for batches with differing classifications', () => {
    const overrides = {
      'General Book': { subject: 'batch {count}', intro: '{names}' },
      'classification:5/1': { subject: 'not the batch', intro: 'not the batch' },
    }
    const batch = [item, { ...item, bookId: 2, ref: 'REF-2', nameAr: '', nameEn: 'Ali', classificationCode: '6/1' }]
    expect(buildBasketSubject(batch, overrides)).toBe('batch 2')
    expect(buildBasketBodyHtml(batch, overrides)).toContain('أحمد، Ali')
    expect(buildBasketSubject(batch, { 'General Book': { subject: '{ref} {detail}' } })).toBe('REF-1 كتاب')
  })

  it('escapes plain text and substituted values, converts line breaks, and preserves unknown tokens', () => {
    const overrides = { 'General Book': {
      intro: '<img src=x> {names}\r\n{ref} {date} {count} {detail} {unknown} {name} {employee_id} {start} {end}',
      closing: 'Regards & thanks\nSecond line',
    } }
    const html = buildBasketBodyHtml([item], overrides)
    expect(html).toContain('&lt;img src=x&gt; أحمد<br>REF-1 11/06/2026 1 كتاب {unknown} {name} {employee_id} {start} {end}')
    expect(html).toContain('Regards &amp; thanks<br>Second line')
    expect(html).not.toContain('<img')
    expect(html).toContain('البيان')
  })

  it('uses transfer and leave keys without leaking the generic override', () => {
    const transfer = { ...item, detail: 'النقل' }
    const overrides = {
      'General Book': { subject: 'generic' },
      'classification:5/1': { subject: 'classified' },
      'General Book:transfer': { subject: 'transfer {date}', intro: 'transfer body', closing: 'transfer closing' },
      'leave:Sick': { subject: 'sick {names}', intro: '{start_date} — {end_date}' },
    }
    expect(buildBasketSubject([transfer], overrides)).toBe('transfer 11/06/2026')
    expect(buildBasketBodyHtml([transfer], overrides)).toContain('transfer body')
    expect(buildBasketBodyHtml([transfer], overrides)).not.toContain('<table')
    const leave = { ...item, formKind: 'Leave Application Form', leaveType: 'Sick' }
    expect(buildBasketSubject([leave], overrides)).toBe('sick أحمد')
    expect(buildBasketBodyHtml([leave], overrides)).toContain('01/06/2026 — 02/06/2026')
  })

  it('joins unique trimmed salary-transfer banks and escapes substituted values', () => {
    const salary = { ...item, formKind: 'Salary Transfer Request' }
    const batch = [salary, { ...salary, bankName: ' Bank & Co ' }, { ...salary, bankName: 'Other Bank' }]
    expect(buildBasketBodyHtml(batch, { 'Salary Transfer Request': { intro: '{bank}' } }))
      .toContain('Bank &amp; Co، Other Bank')
  })

  it('passes overrides through compose prefill while retaining attachments and basket identity', () => {
    const prefill = buildBasketPrefill([item], ['office@example.com'], { 'classification:5/1': { subject: 'custom' } })
    expect(prefill.subject).toBe('custom')
    expect(prefill.to).toEqual(['office@example.com'])
    expect(prefill.references[0]).toMatchObject({ id: 1, docId: 2, token: 'REF-1' })
    expect(prefill.basketKey).toBe('General Book')
    expect(buildBasketPrefill([], [], {})).toMatchObject({ subject: '', bodyHtml: '', references: [] })
  })

  it('renders previews using real form, transfer, classification and absence builders', () => {
    for (const key of ['General Book', 'General Book:transfer', 'classification:5/1', 'leave:Sick',
      'Salary Transfer Request', 'Passport Release Form', 'Resignation Letter', 'Resignation Declaration',
      'Duty Resumption Form', 'Salary Deduction Form', 'absence:absent', 'absence:returned']) {
      const defaults = defaultDraftText(key)
      expect(defaults.subject).not.toBe('')
      expect(defaults.intro).not.toMatch(/<[^>]*>/)
      expect(defaults.closing).not.toMatch(/<[^>]*>/)
      expect(renderDraftSample(key, { [key]: { subject: 'custom {names}', intro: 'custom intro', closing: 'custom closing' } }))
        .toMatchObject({ subject: 'custom أحمد علي', bodyHtml: expect.stringContaining('custom intro') })
    }
  })

  it('copies the classification into items built by the records mapper', () => {
    expect(deriveRecordItem({
      book: { id: 1, ref_number: 'REF', subject: 'Book', employee_id: null,
        created_at: '2026-06-11', classification_code: '5/1' },
      cur: { document_id: 2, template_id: 'General Book' }, fields: {}, emp: null,
    })?.classificationCode).toBe('5/1')
  })

  it('lists all classification data and form types under their service tabs', async () => {
    const classifications = Array.from({ length: 15 }, (_, index) => ({
      code: `${index + 1}/1`, tab: index + 1, name_en: `Class ${index + 1}`,
      name_ar: `تصنيف ${index + 1}`, unit_ar: '',
    }))
    vi.spyOn(api, 'listBookClassifications').mockResolvedValue({ items: classifications })
    vi.spyOn(api, 'listTemplates').mockResolvedValue({ items: [{
      id: 'HR Request Form', name_en: 'HR request', name_ar: 'طلب موارد بشرية',
      form_number: '', category: 'personnel', signing_path: 'auto', has_code: false,
      feature_minted: false, notifies_employee: true,
    }] })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result, unmount } = renderHook(useDraftVariants, {
      wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
    })
    await waitFor(() => expect(draftKeysForService(result.current, 'General Book')).toHaveLength(17))
    expect(draftKeysForService(result.current, 'leaves')).toHaveLength(7)
    expect(draftKeysForService(result.current, 'absences')).toEqual(['absence:absent', 'absence:returned'])
    expect(draftKeysForService(result.current, 'HR Request Form')).toEqual(['HR Request Form'])
    expect(result.current.find((variant) => variant.key === 'classification:15/1')?.label)
      .toEqual({ en: '15/1 — Class 15', ar: '15/1 — تصنيف 15' })
    unmount()
    client.clear()
  })
})
