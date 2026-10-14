import { describe, expect, it } from 'vitest'

import type { LeaveListItem } from '@/lib/api'
import { UNASSIGNED } from '@/lib/dutyUnits'

import { matchesCompany } from './reportData'

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
