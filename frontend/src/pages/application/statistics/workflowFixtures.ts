import type { InmateRegisterMonth } from '@/lib/api'

/** Synthetic month facts shared by the workflow regression tests. */
export function workflowMonth(overrides: Partial<InmateRegisterMonth> = {}): InmateRegisterMonth {
  return {
    year: 2026,
    month: 8,
    closed: false,
    closed_at: null,
    closed_by: null,
    closed_by_name: null,
    reopened_at: null,
    reopened_by: null,
    reopened_by_name: null,
    force_reason: null,
    force_closed: false,
    first_closable_date: '2026-09-01',
    export_ready: true,
    projection_fingerprint: 'draft-fingerprint',
    counts: { citizens: 0, expats: 0, pending: 0, total: 0 },
    wing_summary: {
      counts: [{ wing: '1A', violations: 0 }, { wing: '1B', violations: 0 }],
      most: [],
      most_count: 0,
      least: [],
      least_count: 0,
      zero: ['1A', '1B'],
      unassigned_count: 0,
    },
    workflow: {
      version: 0,
      state: 'draft',
      reviewer: null,
      manager: null,
      prepared: null,
      reviewed: null,
      approved: null,
      last_event: null,
      needs_review: false,
      blockers: [],
      allowed_actions: ['prepare'],
    },
    entries: [],
    uncounted: [],
    arrived_after_close: [],
    blocking: [],
    ...overrides,
  }
}
