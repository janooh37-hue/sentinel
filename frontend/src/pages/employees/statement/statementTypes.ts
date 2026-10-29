/**
 * Contract for the employee-file statements (Activity statement view and the
 * printable Activity / Attendance statements).
 *
 * Mirrors the backend Pydantic schemas `ActivityStatementRead`,
 * `ActivityStatementItemRead`, `StatementPrintCreate` and `StatementPrintRead`
 * (backend/app/schemas/employee_statement.py). Once those land and
 * `api.types.ts` is regenerated, these become aliases of
 * `components['schemas'][...]`; consumers import from here either way.
 */

export type StatementKind =
  | 'document'
  | 'leave'
  | 'violation'
  | 'ledger'
  | 'absence'
  | 'duty_location'
  | 'status'

export interface StatementLinkedDocument {
  id: number
  template_id: string
  created_at: string
}

/** One fact in the employee's record. Only the fields of its kind are set. */
export interface ActivityStatementItem {
  kind: StatementKind
  /** Primary key of the source row (Document.id, Leave.id, ...). */
  source_id: number
  /** Naive site-local ISO datetime. Date-only kinds use 00:00. */
  occurred_at: string
  /** True for leave, violation and absence: there is no meaningful time. */
  date_only: boolean
  /** Who recorded it, when the source knows; null otherwise. Never invented. */
  actor_name: string | null
  /** A real human reference number (Document.ref_number); null otherwise. */
  reference: string | null
  // document
  template_id: string | null
  template_name_en: string | null
  template_name_ar: string | null
  // leave
  leave_type: string | null
  start_date: string | null
  end_date: string | null
  days: number | null
  leave_status: string | null
  // violation
  violation_type: string | null
  description: string | null
  action_taken: string | null
  deduction_days: number | null
  violation_status: string | null
  // ledger (correspondence)
  subject: string | null
  direction: string | null
  channel: string | null
  counterparty: string | null
  // absence
  note: string | null
  // duty_location
  event_type: 'initial_placement' | 'transfer' | null
  from_department: string | null
  from_unit: string | null
  from_post: string | null
  to_department: string | null
  to_unit: string | null
  to_post: string | null
  reason: string | null
  // status
  from_status: string | null
  to_status: string | null
  effective_date: string | null
  site: string | null
  return_date: string | null
  status_event_kind: string | null
  status_source: string | null
  /** Generated documents attached to a leave or violation, readable by the caller. */
  linked_documents: StatementLinkedDocument[]
}

/** `GET /employees/{employee_id}/statement/activity?from_date&to_date` */
export interface ActivityStatement {
  employee_id: string
  /** Echo of the requested bounds; null means unbounded on that side. */
  from_date: string | null
  to_date: string | null
  /** Newest first. Every readable item in the period, no recent-items cap. */
  items: ActivityStatementItem[]
  /** True only when the server's hard safety cap (2000 items) cut the list. */
  truncated: boolean
}

export type StatementPrintKind = 'activity' | 'attendance'

/** `POST /employees/{employee_id}/statement/prints` body. */
export interface StatementPrintCreate {
  kind: StatementPrintKind
  from_date: string | null
  to_date: string
  language: 'ar' | 'en'
  /** The setup options as printed (sections, toggles, orientation). */
  options: Record<string, unknown>
}

/** One issued print serial. */
export interface StatementPrint {
  id: number
  employee_id: string
  kind: StatementPrintKind
  /** Running number per employee, shared by activity and attendance prints. */
  serial: number
  /** `<G-number>/1/12/<serial>`, e.g. `G3190/1/12/7`. */
  reference: string
  from_date: string | null
  to_date: string
  language: 'ar' | 'en'
  printed_at: string
  printed_by_name: string | null
}
