import i18next, { type TFunction } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'

import type { LeaveListItem } from '@/lib/api'
import ar from '@/locales/ar.json'

import { reportBodyHtml } from './reportDocument'
import type { ReportSection } from './reportData'

let t: TFunction
beforeAll(async () => {
  const i18n = i18next.createInstance()
  await i18n.init({ lng: 'ar', resources: { ar: { translation: ar } }, interpolation: { escapeValue: false } })
  t = i18n.t
})

const leave = (over: Partial<LeaveListItem> = {}): LeaveListItem =>
  ({
    id: 1,
    employee_id: 'G1',
    employee_name_ar: 'سالم',
    employee_duty_unit: 'السرية الخامسة',
    leave_type: 'Sick Leave',
    start_date: '2026-08-13',
    end_date: '2026-08-19',
    days: 7,
    status: 'Approved',
    has_certificate: false,
    created_at: '2026-08-01T00:00:00',
    ...over,
  }) as LeaveListItem

const august = { start: '2026-08-01', end: '2026-08-31' }
const section = (row: LeaveListItem): ReportSection => ({
  month: '2026-08',
  lines: [{ row, unit: row.employee_duty_unit ?? '', days: row.days }],
  units: [{ unit: row.employee_duty_unit ?? '', days: row.days, employees: 1 }],
  days: row.days,
})

const body = (rows: LeaveListItem[], employee: boolean, company?: string): string =>
  reportBodyHtml({
    t,
    lang: 'ar',
    locale: 'ar-AE',
    scope: {
      period: { mode: 'month', month: '2026-08' },
      company,
      employee: employee ? { id: 'G1', name: 'سالم' } : undefined,
      limits: [],
    },
    sections: rows.map(section),
    rows,
    window: august,
    employee: employee ? { emp: undefined, all: rows, today: '2026-10-14' } : undefined,
  })

const firstParagraph = (html: string): string => /^<p[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? ''

describe('reportBodyHtml', () => {
  it('opens a one-employee report with a sentence naming the employee and the month', () => {
    const intro = firstParagraph(body([leave()], true))
    expect(intro).toContain('سالم (G1)')
    expect(intro).toContain('شهر أغسطس 2026')
    expect(intro).not.toMatch(/[·—]/)
  })

  it('opens a company report with a sentence naming the company', () => {
    const intro = firstParagraph(body([leave()], false, 'السرية الخامسة'))
    expect(intro).toContain('السرية الخامسة')
    expect(intro).toContain('شهر أغسطس 2026')
  })

  it('drops the month roster and duty-location totals for one employee', () => {
    const one = body([leave()], true)
    const many = body([leave()], false)
    expect(one).not.toContain(t('leaves.report.daysByUnit'))
    expect(one.match(/<table/g)).toHaveLength(3) // details, days by type, leaves
    expect(many).toContain(t('leaves.report.daysByUnit'))
  })

  it('shows the return-date column only when a leave in the period has one', () => {
    const returnCol = t('leaves.report.colReturn')
    expect(body([leave()], true)).not.toContain(returnCol)
    const returned = body([leave({ return_date: '2026-08-20' })], true)
    expect(returned).toContain(returnCol)
    expect(returned).toContain('20/08/2026')
  })

  it('escapes stored text so a name cannot inject markup into the filed book', () => {
    const row = leave({ employee_name_en: 'Ann <img src=x onerror=alert(1)> & "Co"', employee_name_ar: null, employee_duty_unit: '<script>' })
    const html = body([row], false)
    expect(html).not.toMatch(/<img|<script/)
    expect(html).toContain('Ann &lt;img src=x onerror=alert(1)&gt; &amp; &quot;Co&quot;')
  })
})
