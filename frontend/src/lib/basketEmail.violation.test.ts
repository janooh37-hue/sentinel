import { describe, expect, it } from 'vitest'

import { deriveRecordItem } from '@/pages/books/recordsBasket'
import { buildBasketPrefill } from './basketEmail'

const emp = { name_en: 'Abdulaziz Almuqbali', name_ar: 'عبدالعزيز المقبالي', position_ar: 'حارس أمن' }

function record(templateId: string, fields: Record<string, unknown>, id = 1) {
  const item = deriveRecordItem({
    book: {
      id,
      ref_number: `NAT-${id}`,
      subject: `${templateId} — Abdulaziz Almuqbali`,
      employee_id: `G${id}`,
      created_at: '2026-11-01T08:00:00',
      classification_code: null,
    },
    cur: { document_id: 100 + id, template_id: templateId },
    fields,
    emp,
  })
  if (!item) throw new Error('no item')
  return item
}

describe('violation and warning cover emails', () => {
  it('names every ticked violation in Arabic, in the subject and as table bullets', () => {
    const item = record('Violation Form', {
      violations: [
        { row: 7, name: 'Failing to shave' },
        { row: 21, name: 'Sleeping on Duty' },
      ],
    })
    const { subject, bodyHtml } = buildBasketPrefill([item], [])

    expect(subject).toBe('مخالفة: عدم الحلاقة، النوم أثناء العمل — عبدالعزيز المقبالي')
    expect(bodyHtml).toContain('• عدم الحلاقة<br>• النوم أثناء العمل')
    expect(bodyHtml).toContain('المخالفات')
    expect(bodyHtml).not.toMatch(/Violation Form|Failing to shave/)
  })

  it('uses the "Others" text as the violation instead of a separate remark', () => {
    const item = record('Violation Form', {
      violations: [{ row: 0, name: 'Others' }],
      explanation: 'ترك الموقع دون إذن',
    })
    const { subject, bodyHtml } = buildBasketPrefill([item], [])

    expect(subject).toBe('مخالفة: ترك الموقع دون إذن — عبدالعزيز المقبالي')
    expect(bodyHtml).not.toContain('ملاحظات')
  })

  it('adds a remarks column only when a record carries remarks beside its violations', () => {
    const withNote = record('Violation Form', {
      violations: [{ row: 22, name: 'Failing to perform duty' }],
      explanation: 'تكرر خلال الأسبوع',
    })
    const plain = record('Violation Form', { violations: [{ row: 23, name: 'Theft Act' }] }, 2)
    const { subject, bodyHtml } = buildBasketPrefill([withNote, plain], [])

    expect(subject).toBe('مخالفات الموظفين: التقصير في أداء الواجب، ارتكاب السرقة')
    expect(bodyHtml).toContain('<th style="border:1px solid #000000;background:#C00000;color:#ffffff;padding:4px 9px;text-align:center;font-weight:bold">ملاحظات</th>')
    expect(bodyHtml).toContain('تكرر خلال الأسبوع')
  })

  it('reads a Warning Form stored as the backend’s joined string, whatever language a preset was saved in', () => {
    const item = record('Warning Form', { violation_type: 'Insubordination، تأخر عن الدوام' })
    const { subject, bodyHtml } = buildBasketPrefill([item], [])

    expect(subject).toBe('إنذار: مخالفة الأوامر والتعليمات، تأخر عن الدوام — عبدالعزيز المقبالي')
    expect(bodyHtml).toContain('مرفق لكم إنذار الموظف')
    expect(bodyHtml).toContain('• مخالفة الأوامر والتعليمات<br>• تأخر عن الدوام')
  })

  it('stays Arabic when the record’s fields are unavailable', () => {
    const item = record('Violation Form', {})
    const { subject, bodyHtml } = buildBasketPrefill([item], [])

    expect(subject).toBe('مخالفة — عبدالعزيز المقبالي')
    expect(bodyHtml).not.toContain('Violation Form')
  })

  it('escapes violation text inside the bullet markup', () => {
    const item = record('Warning Form', { violation_type: ['<b>x</b>', 'Theft Act'] })
    expect(buildBasketPrefill([item], []).bodyHtml).toContain('• &lt;b&gt;x&lt;/b&gt;<br>• ارتكاب السرقة')
  })
})
