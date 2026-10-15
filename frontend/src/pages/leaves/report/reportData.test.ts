import { describe, expect, it } from 'vitest'

import type { LeaveListItem } from '@/lib/api'
import { UNASSIGNED } from '@/lib/dutyUnits'

import { isDeparted, kindAggregates, matchesCompany, periodLeaves } from './reportData'

const row = (over: Partial<LeaveListItem> = {}): LeaveListItem => ({
  id: 1,
  employee_id: 'G1',
  leave_type: 'Annual Leave',
  start_date: '2026-03-01',
  end_date: '2026-03-05',
  days: 5,
  status: 'Approved',
  has_certificate: false,
  created_at: '2026-02-01T00:00:00',
  ...over,
})

describe('matchesCompany', () => {
  it('keeps every row when no company is picked', () => {
    expect(matchesCompany(row({ employee_duty_unit: null }), null)).toBe(true)
  })

  it('matches the duty unit ignoring surrounding spaces', () => {
    expect(matchesCompany(row({ employee_duty_unit: ' السرية الأولى ' }), 'السرية الأولى')).toBe(true)
    expect(matchesCompany(row({ employee_duty_unit: 'السرية الثانية' }), 'السرية الأولى')).toBe(false)
  })

  it('Unassigned matches only rows with no duty unit', () => {
    expect(matchesCompany(row({ employee_duty_unit: null }), UNASSIGNED)).toBe(true)
    expect(matchesCompany(row({ employee_duty_unit: '  ' }), UNASSIGNED)).toBe(true)
    expect(matchesCompany(row({ employee_duty_unit: 'السرية الأولى' }), UNASSIGNED)).toBe(false)
  })
})

describe('isDeparted', () => {
  it('flags resigned and terminated in stored bilingual and clean spellings', () => {
    expect(isDeparted(row({ employee_status: 'Resigned - مستقيل' }))).toBe(true)
    expect(isDeparted(row({ employee_status: 'Terminated' }))).toBe(true)
  })

  it('keeps working, transferred, loaned and unknown statuses', () => {
    for (const s of ['Active - نشط', 'Transferred - منقول', 'Loaned', null]) {
      expect(isDeparted(row({ employee_status: s }))).toBe(false)
    }
  })
})

const MARCH = { start: '2026-03-01', end: '2026-03-31' }

describe('kindAggregates over the report period', () => {
  it('totals days per leave type, clipping a leave that crosses the period edge', () => {
    const totals = kindAggregates(
      [
        row({ id: 1, leave_type: 'Sick Leave', start_date: '2026-03-30', end_date: '2026-04-02', days: 4 }),
        row({ id: 2, leave_type: 'Annual Leave - إجازة سنوية', days: 5 }),
        row({ id: 3, leave_type: 'Annual Leave', start_date: '2026-03-10', end_date: '2026-03-11', days: 2 }),
        row({ id: 4, leave_type: 'Sick Leave', start_date: '2026-04-05', end_date: '2026-04-06', days: 2 }),
      ],
      MARCH,
    )
    expect(totals.map((k) => [k.kind, k.records, k.days])).toEqual([
      ['Annual Leave', 2, 7],
      ['Sick Leave', 1, 2],
    ])
  })
})

describe('periodLeaves', () => {
  it('keeps leaves touching the period, inclusive at both edges, oldest first', () => {
    const list = periodLeaves(
      [
        row({ id: 1, start_date: '2026-03-20', end_date: '2026-03-21' }),
        row({ id: 2, start_date: '2026-02-25', end_date: '2026-03-01' }),
        row({ id: 3, start_date: '2026-03-31', end_date: '2026-04-03' }),
        row({ id: 4, start_date: '2026-04-01', end_date: '2026-04-02' }),
        row({ id: 5, start_date: '2026-02-01', end_date: '2026-02-28' }),
      ],
      MARCH,
    )
    expect(list.map((r) => r.id)).toEqual([2, 1, 3])
  })
})
