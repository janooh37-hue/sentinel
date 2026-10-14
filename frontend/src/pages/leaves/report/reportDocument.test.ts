import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import { reportBodyHtml } from './reportDocument'

const t = ((key: string) => key) as unknown as TFunction

describe('reportBodyHtml', () => {
  it('escapes stored text so a name cannot inject markup into the filed book', () => {
    const row = {
      id: 1,
      employee_id: 'G1',
      employee_name_en: 'Ann <img src=x onerror=alert(1)> & "Co"',
      employee_duty_unit: '<script>',
      leave_type: 'Annual Leave',
      start_date: '2026-03-01',
      end_date: '2026-03-02',
      days: 2,
      status: 'Approved',
      has_certificate: false,
      created_at: '2026-02-01T00:00:00',
    }
    const html = reportBodyHtml({
      t,
      lang: 'en',
      locale: 'en-GB',
      facts: [],
      sections: [
        { month: '2026-03', lines: [{ row, unit: '<script>', days: 2 }], units: [{ unit: '<script>', days: 2, employees: 1 }], days: 2 },
      ],
      rows: [row],
      window: { start: '2026-03-01', end: '2026-03-31' },
    })
    expect(html).not.toMatch(/<img|<script/)
    expect(html).toContain('Ann &lt;img src=x onerror=alert(1)&gt; &amp; &quot;Co&quot;')
  })
})
