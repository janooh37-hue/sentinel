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
  it('builds a complete effective snapshot and trims the mandatory reason', () => {
    expect(buildAdjustmentPayload(effective, {
      ...draftFromEffective(effective),
      presenceState: 'completed',
      reason: ' Supervisor register ',
    })).toEqual({
      replacement_presence_state: 'completed',
      replacement_first_in_at: '2026-08-19T01:00:00Z',
      replacement_latest_in_at: '2026-08-19T01:05:00Z',
      replacement_final_out_at: '2026-08-19T09:00:00Z',
      replacement_late_minutes: 5,
      replacement_early_exit_minutes: 2,
      replacement_missing_checkout: false,
      reason: 'Supervisor register',
    })
  })
  it('converts a Dubai wall-clock input to UTC only when it changed', () => {
    expect(buildAdjustmentPayload(effective, {
      ...draftFromEffective(effective),
      firstInAt: '2026-08-19T06:15',
      reason: 'Corrected terminal time',
    })).toEqual({
      replacement_presence_state: 'on_duty',
      replacement_first_in_at: '2026-08-19T02:15:00.000Z',
      replacement_latest_in_at: '2026-08-19T01:05:00Z',
      replacement_final_out_at: '2026-08-19T09:00:00Z',
      replacement_late_minutes: 5,
      replacement_early_exit_minutes: 2,
      replacement_missing_checkout: false,
      reason: 'Corrected terminal time',
    })
  })
  it('preserves exact effective UTC timestamps when only presence changes', () => {
    const precise = {
      ...effective,
      first_in_at: '2026-08-19T01:00:12.345Z',
      latest_in_at: '2026-08-19T01:05:23.456Z',
      final_out_at: '2026-08-19T09:00:34.567Z',
    }
    expect(buildAdjustmentPayload(precise, {
      ...draftFromEffective(precise),
      presenceState: 'completed',
      reason: 'Supervisor register',
    })).toMatchObject({
      replacement_first_in_at: '2026-08-19T01:00:12.345Z',
      replacement_latest_in_at: '2026-08-19T01:05:23.456Z',
      replacement_final_out_at: '2026-08-19T09:00:34.567Z',
    })
  })

  it('adds UTC to retained naive timestamps without dropping fractional precision', () => {
    const naive = {
      ...effective,
      first_in_at: '2026-08-19T01:00:12.345678',
      latest_in_at: '2026-08-19T01:05:23.456',
      final_out_at: '2026-08-19T09:00:34.5',
    }

    expect(buildAdjustmentPayload(naive, {
      ...draftFromEffective(naive),
      presenceState: 'completed',
      reason: 'Presence-only correction',
    })).toMatchObject({
      replacement_presence_state: 'completed',
      replacement_first_in_at: '2026-08-19T01:00:12.345678Z',
      replacement_latest_in_at: '2026-08-19T01:05:23.456Z',
      replacement_final_out_at: '2026-08-19T09:00:34.5Z',
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
