import { describe, expect, it } from 'vitest'

import type { WorkforceSnapshot } from '@/lib/api'
import { selfAttendance } from './workforcePulseState'

describe('selfAttendance', () => {
  it.each(['2026-11-18T03:00:00', null])('preserves a corrected In of %s and a cleared Out despite two raw punches', (first_in_at) => {
    const snapshot: WorkforceSnapshot = {
      as_of: '2026-11-18T08:00:00Z',
      operational_date: '2026-11-18',
      timezone: 'Asia/Dubai',
      evaluation_health: { pending_count: 0, error_count: 0 },
      current_shift: { scheduled: 0, excused: 0, evaluated_count: 0, pending_or_error_excluded_count: 0 },
      next_shift: { scheduled: 0 },
      leave_today: { annual: 0, sick: 0, national_service: 0, other: 0 },
      mapping_completeness: {},
      schedule_completeness: {},
      self: {
        employee_id: 'G100',
        presence_state: 'on_duty',
        scheduled_start_at: '2026-11-18T03:00:00',
        scheduled_end_at: '2026-11-18T11:00:00',
        first_punch_at: '2026-11-18T03:10:00',
        last_punch_at: '2026-11-18T11:00:00',
        first_in_at,
        final_out_at: null,
        corrected: true,
      },
    }

    expect(selfAttendance(snapshot)).toMatchObject({
      in: first_in_at,
      out: null,
      state: 'verified',
      corrected: true,
    })
  })
})
