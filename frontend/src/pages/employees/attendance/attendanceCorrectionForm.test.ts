import { describe, expect, it } from 'vitest'

import {
  buildAdjustmentPayload,
  draftFromEffective,
  type AttendanceEffective,
} from './attendanceCorrectionForm'

const effective: AttendanceEffective = {
  presence_state: 'on_duty',
  first_in_at: '2026-08-19T01:00:00Z',
  latest_in_at: '2026-08-19T01:05:00Z',
  final_out_at: '2026-08-19T09:00:00Z',
  late_minutes: 5,
  early_exit_minutes: 2,
  missing_checkout: false,
}

describe('buildAdjustmentPayload', () => {
  it('sends only changed fields and trims the mandatory reason', () => {
    expect(buildAdjustmentPayload(effective, {
      ...draftFromEffective(effective),
      presenceState: 'completed',
      reason: ' Supervisor register ',
    })).toEqual({
      replacement_presence_state: 'completed',
      reason: 'Supervisor register',
    })
  })

  it('converts a Dubai wall-clock input to UTC only when it changed', () => {
    expect(buildAdjustmentPayload(effective, {
      ...draftFromEffective(effective),
      firstInAt: '2026-08-19T06:15',
      reason: 'Corrected terminal time',
    })).toEqual({
      replacement_first_in_at: '2026-08-19T02:15:00.000Z',
      reason: 'Corrected terminal time',
    })
  })

  it('rejects a blank reason and an otherwise unchanged correction', () => {
    expect(() => buildAdjustmentPayload(effective, draftFromEffective(effective))).toThrow('CORRECTION_REASON_REQUIRED')
    expect(() => buildAdjustmentPayload(effective, {
      ...draftFromEffective(effective),
      reason: 'No changes',
    })).toThrow('CORRECTION_UNCHANGED')
  })
})
