/**
 * Contract for the employee-file statements (Activity statement view and the
 * printable Activity / Attendance statements).
 *
 * Aliases of the generated backend schemas `ActivityStatementRead`,
 * `ActivityStatementItemRead`, `StatementPrintCreate` and `StatementPrintRead`
 * (backend/app/schemas/employee_statement.py), declared in `@/lib/api`.
 * Activity items carry `occurred_at` as a site-local instant with its offset;
 * date-only kinds (leave, violation, absence) use 00:00.
 */
export type {
  ActivityStatement,
  ActivityStatementItem,
  StatementKind,
  StatementLinkedDocument,
  StatementPrint,
  StatementPrintCreate,
  StatementPrintKind,
} from '@/lib/api'
