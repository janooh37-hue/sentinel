import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import i18n from '@/lib/i18n'

import { StatusActivity, type StatusActivityValue } from './StatusActivity'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

const base: StatusActivityValue = {
  from_status: 'Active',
  to_status: 'Transferred',
  effective_date: '2026-08-15',
  site: 'Port A',
  return_date: null,
  status_event_kind: 'changed',
  status_source: 'manual',
  actor_name: 'Ahmed',
}

function text(): { title: string; detail: string } {
  return {
    title: screen.getByTestId('status-activity-title').textContent ?? '',
    detail: screen.getByTestId('status-activity-detail').textContent ?? '',
  }
}

describe('StatusActivity', () => {
  it('EN: change with site, effective date and actor', async () => {
    await i18n.changeLanguage('en')
    render(<StatusActivity item={base} />)
    const { title, detail } = text()
    expect(title).toBe('Active → Transferred')
    expect(detail).toContain('Port A')
    expect(detail).toContain('Effective')
    expect(detail).toContain('15/08/2026')
    expect(detail).toContain('By')
    expect(detail).toContain('Ahmed')
  })

  it('EN: return to Active shows the return date', async () => {
    await i18n.changeLanguage('en')
    render(
      <StatusActivity
        item={{ ...base, from_status: 'Transferred', to_status: 'Active', site: null, effective_date: '2026-09-20', actor_name: null }}
      />,
    )
    const { title, detail } = text()
    expect(title).toBe('Returned to Active')
    expect(detail).toContain('Returned')
    expect(detail).toContain('20/09/2026')
  })

  it('EN: scheduler-applied, scheduled, cancelled and imported variants', async () => {
    await i18n.changeLanguage('en')
    const { rerender } = render(
      <StatusActivity item={{ ...base, status_event_kind: 'applied', status_source: 'scheduler', actor_name: null }} />,
    )
    expect(text().detail).toContain('Applied automatically')
    rerender(<StatusActivity item={{ ...base, status_event_kind: 'scheduled' }} />)
    expect(text().title).toBe('Scheduled: Active → Transferred')
    rerender(<StatusActivity item={{ ...base, status_event_kind: 'scheduled_cancelled' }} />)
    expect(text().title).toBe('Scheduled Transferred cancelled')
    rerender(<StatusActivity item={{ ...base, to_status: 'Resigned', site: null, status_event_kind: 'imported', status_source: 'backfill', actor_name: null }} />)
    expect(text().title).toBe('Active → Resigned')
    expect(text().detail).toContain('Existing record')
  })

  it('AR: statuses are translated, never the raw English enum', async () => {
    await i18n.changeLanguage('ar')
    render(<StatusActivity item={base} />)
    const { title, detail } = text()
    expect(title).toBe('نشط ← منقول')
    expect(title).not.toMatch(/Active|Transferred/)
    expect(detail).toContain('اعتبارًا من')
    expect(detail).not.toMatch(/Effective|By /)
  })
})
