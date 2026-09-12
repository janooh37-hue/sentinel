import type { InmateRegisterMonth, InmateSubmission } from '@/lib/api'

/** Synthetic report facts shared by the workflow regression tests. */
export function workflowMonth(overrides: Partial<InmateRegisterMonth> = {}): InmateRegisterMonth {
  return {
    year: 2026, month: 8, closed: false, closed_at: null, closed_by: null,
    closed_by_name: null, reopened_at: null, reopened_by: null, reopened_by_name: null,
    first_closable_date: '2026-09-01', export_ready: true,
    projection_fingerprint: 'draft-fingerprint',
    counts: { citizens: 0, expats: 0, pending: 0, total: 0 },
    wing_summary: { counts: [{ wing: '1A', violations: 0 }, { wing: '1B', violations: 0 }], most: [], most_count: 0, least: [], least_count: 0, zero: ['1A', '1B'], unassigned_count: 0 },
    workflow: { version: 0, state: 'draft', active_submission_id: null, current_sequence: 0,
      reviewer: null, manager: null, prepared: null, reviewed: null, approved: null,
      needs_review: false, blockers: [], allowed_actions: ['prepare'], legacy: false, legacy_metadata: null },
    entries: [], uncounted: [], arrived_after_close: [], blocking: [], ...overrides,
  }
}

export function workflowSubmission(overrides: Partial<InmateSubmission> = {}): InmateSubmission {
  return { ...workflowMonth(), submission_id: 42, sequence: 1, created_at: '2026-08-20T08:00:00Z',
    report_state: 'prepared', current: true, stale: false, actions: [], ...overrides }
}
