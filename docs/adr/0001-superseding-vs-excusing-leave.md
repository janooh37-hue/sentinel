# Superseding leave and excusing leave are different questions

Status: accepted

## Context

The absence register and workforce attendance both consume leave records, but
they answer different operational questions. The overlap between their leave
sets can look like duplicated policy even though their effects differ.

## Observed behavior

The absence path asks whether a non-void leave paper explains already-recorded
absence dates. Sick leave, Annual leave, Leave Permit, and Administrative Leave
do; the legacy `Unknown` marker follows Annual leave in this timesheet path.
Covered `Absence` rows are removed, and leave date bounds are inclusive.

The workforce path asks whether an employee's attendance expectation is excused
for an operational date. It excludes deleted rows and recognizes Approved Sick
leave, Approved Annual leave, and Pending or Completed National Service. An
approved unknown request-group type is not Annual leave. It attaches all matching
leave sources to the automatic verdict and uses National Service, Sick leave,
then Annual leave as the reason priority when overlaps occur.

These statements describe verified application behavior. The repository does
not contain an approved HR or payroll rationale for why Leave Permit participates
only in the superseding set or why National Service participates only in the
excusing set.

## Decision

Keep superseding-leave and excusing-leave predicates and sets separate.
Superseding answers whether covered day-level absence facts are removed;
excusing answers whether an Attendance case retains an attendance expectation.
Neither predicate may be inferred from the other.

## Considered options

- Use one shared list for both paths. Rejected because it would change current
  behavior for Leave Permit, National Service, and the legacy `Unknown` marker.
- Use approval status alone. Rejected because liveness is kind-specific and
  deletion, type, and status all affect the workforce result.

## Consequences

Each path needs its own behavior tests and a clearly named source of truth. A
future change to either set is a business-policy change that must state its
effect on absence rows, attendance expectations, and existing records rather
than entering as code cleanup. The distinction does not assert a new payroll
meaning for either set.

## Source evidence

- [Absence superseding predicates and row removal](../../backend/app/services/absence_service.py)
- [Leave lifecycle classification](../../backend/app/core/leave_lifecycle.py)
- [Timesheet leave codes and void states](../../backend/app/core/timesheet_codes.py)
- [Workforce excusing predicates and source priority](../../backend/app/services/workforce_leave.py)
- [Attendance evaluation caller](../../backend/app/services/attendance_evaluation_service.py)
