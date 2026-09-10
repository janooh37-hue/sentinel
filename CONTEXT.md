# GSSG Manager

GSSG Manager is the operational domain for employee records, official documents,
attendance, correspondence, access control, scan intake, and fleet records.

## Language

### Records and artifacts

**Record**:
An official registered document with a reference, filing state, and zero or more
committed revisions; it may pass through review, signing, and archival workflows.
_Avoid_: Book in product prose, General Book as an umbrella term

**General Book**:
One form kind that a Record may carry, with content authored either in Word or in
the rich editor against the General Book form.
_Avoid_: Record as a synonym, generic book

**Generated artifact**:
The official DOCX output for a Record and its available PDF rendition, whether
produced from structured form data or finalized from a Word-authored DOCX.
_Avoid_: Template output, when the source is a Word-authored document

**Revision**:
One committed version of a Record's generated artifact, ordered within that
Record and carrying its own review or signing state.
_Avoid_: Edit, draft, file version

### Attendance and leave

**Attendance case**:
One employee's expected attendance for one scheduled work window on an
operational date.
_Avoid_: Punch, shift, attendance row

**Automatic verdict**:
The system-derived assessment of an Attendance case from its schedule, approved
policy, identity mapping, attendance punches, synchronization state, and leave.
_Avoid_: Final verdict, correction

**Attendance correction**:
An authorized user's replacement of the attendance values shown for an Attendance
case; it supersedes an earlier active correction and remains in force until revoked.
Revocation may reveal an earlier unrevoked correction, and no correction replaces
or recalculates the Automatic verdict.
_Avoid_: Adjustment in product prose, override

**Effective attendance**:
The latest Automatic verdict with the active Attendance correction applied at
read time, or the Automatic verdict alone when no correction is active.
_Avoid_: Automatic verdict when a correction is active

**Approved attendance policy**:
An attendance policy that has recorded approval and whose effective window
contains the operational date, including its start and excluding its end. A
shift-specific policy outranks a general policy; within that level, the latest
effective start wins, followed by a stable newest-policy tie-break.
_Avoid_: Current policy, latest policy

**Lifecycle-live leave**:
A non-deleted leave covering the operational date, with inclusive start and end
dates, whose kind-specific state is live: Approved Sick leave, Approved Annual
leave, or Pending or Completed National Service. Other request kinds are not
treated as Annual leave merely because they share a lifecycle group.
_Avoid_: Approved leave, active leave

**Excusing leave**:
A Lifecycle-live leave that removes the attendance expectation for an Attendance
case. The current excusing kinds are Sick leave, Annual leave, and National
Service.
_Avoid_: Superseding leave, any leave

**Superseding leave**:
A non-void leave whose paper explains covered absence days, causing the separate
day-level absence facts to be removed. The current kinds are Sick leave, Annual
leave, Leave Permit, and Administrative Leave; the legacy Unknown leave marker
follows Annual leave only for this timesheet operation.
_Avoid_: Excusing leave, replacement leave

**Absence episode**:
A contiguous run of recorded absence dates for one employee; any missing calendar
date splits the run into separate episodes.
_Avoid_: Leave, attendance case


### Inmate conduct

**Inmate violation occurrence**:
One inmate line on one Inmate Conduct Violations Record. Every occurrence counts
independently, even when the same inmate appears more than once on one Record or
across several Records.
_Avoid_: Inmate when counting violations, deduplicated inmate

**Violation month**:
The calendar month containing the occurrence date recorded on the Inmate Conduct
Violations Record. Every inmate violation occurrence on that Record belongs to
that month; filing time does not move it to another month.
_Avoid_: Filing month, creation month

**Violation narrative**:
The report-level description of the conduct violation, shared by every inmate
violation occurrence on the same Record.
_Avoid_: Per-inmate details

**Monthly violation register entry**:
The monthly view of one inmate violation occurrence. It retains the occurrence's
full source facts even when only a subset appears as columns. While the month is
open, only the latest version of an approved, non-deleted, non-voided Record
contributes entries. Closing the month freezes each entry's facts and order.
_Avoid_: Record, inmate summary

**Inmate population**:
One of the two groups a monthly violation register entry is sorted into by the
inmate's nationality: citizens or non-citizens. Membership is derived from the
nationality, never stored as its own flag, and a stateless inmate is a
non-citizen.
_Avoid_: Expatriates as the group's meaning, nationality table

**Pending completion entry**:
A monthly violation register entry with no resolvable nationality, and therefore
no inmate population. It appears in its own group in the register, is counted
there, blocks the month close, and is sealed in that group when an administrator
forces the close over it.
_Avoid_: Incomplete row, outstanding completion, unspecified nationality entry

**Incomplete mark**:
The flag an entry carries when a value it should hold is permanently missing,
because a forced close froze it or because a historical nationality matched
nothing. It marks values, not group membership, and any inmate population may
contain marked entries.
_Avoid_: Pending, draft, invalid entry

**Register serial number**:
The one-based chronological position of an inmate violation occurrence within its
inmate population, or within the pending completion group, in a Violation month.
It is recalculated while the month is open and frozen when the month closes; it is
not the occurrence's identity.
_Avoid_: Row ID, inmate number, position within the month

**Month close**:
The administrator action that freezes a Violation month's entries as the register's
source of truth. It is refused while the month is still running, and refused over
incomplete entries unless the administrator forces it with a recorded reason.
_Avoid_: Lock, seal, submit

**Month reopen**:
The administrator action that returns a closed Violation month to live projection.
It is the only way to correct a closed month, and the entries of the previous close
survive it until the month is closed again.
_Avoid_: Unlock, unfreeze

**Arrived after close**:
An inmate violation occurrence whose source Record was edited to an occurrence date
inside an already-closed Violation month. It is listed against that month without
entering its frozen entries or counts.
_Avoid_: Late violation, orphan row

### Access and organization

**Capability**:
A named application action that may come from a role default and then be granted
or denied for a particular user, with an English and Arabic label for operators.
_Avoid_: Permission when referring to the key, right

**Sensitive capability**:
An administrator-only Capability that cannot be granted by a per-user override
or requested through the access-request workflow.
_Avoid_: Hidden capability, elevated permission

**Workforce scope**:
The union of employee populations a user may see or change in workforce features,
including self and assigned organization, department, duty-unit, or duty-post
populations; request filters may only narrow it.
_Avoid_: Capability, role, filter

### Correspondence and intake

**Mailbox**:
A user's configured email account whose folders the application synchronizes and
whose Drafts folder can receive prepared outgoing messages.
_Avoid_: Outlook when referring to the account, shared inbox

**Outlook handoff**:
The transfer of a prepared outgoing message to the user's email client, either by
placing a MIME draft in the configured Mailbox or by opening a `mailto:` link. A
pending correspondence entry tracks the handoff until Sent-folder reconciliation.
_Avoid_: Send, delivery confirmation

**Scan**:
An inbound file waiting to be classified and filed, together with its source and
processing state.
_Avoid_: OCR result, attachment

**Triage decision**:
The proposed filing route for a Scan, including its document classification,
candidate Record or employee, confidence tier, and supporting classification
evidence such as alternatives, field confidence, and source snippets.
_Avoid_: Flattened field map, OCR text

### Fleet

**Vehicle fine**:
A monetary traffic violation associated with a fleet vehicle and, when known, an
employee, whether recorded manually or imported from EVG.
_Avoid_: Penalty as the record name, accident

**Vehicle accident**:
A dated incident involving a fleet vehicle, with its location, description,
open-or-closed state, and available driver, police, damage, photo, and letter details.
_Avoid_: Vehicle fine, damage report

**Maintenance event**:
A dated service, repair, tyre, or other maintenance occurrence for a fleet vehicle,
with any available cost, vendor, odometer, receipt, and next-due details.
_Avoid_: Reminder, maintenance schedule

**License renewal**:
The replacement of a vehicle's current license validity period with a new period,
while retaining the ended period, renewal cost, and prior license scan in its history.
_Avoid_: License edit, expiry reminder

## Implementation mappings

These names preserve current database and API spellings while product prose uses
the domain language above.

| Domain term | Current implementation name |
| --- | --- |
| Record | `Book` |
| General Book | `template_id = "General Book"` |
| Generated artifact | `Document` |
| Revision | `BookVersion` |
| Attendance case | `AttendanceCase` |
| Automatic verdict | `AttendanceEvaluation` |
| Attendance correction | `AttendanceAdjustment`; API path `/adjustments` |
| Approved attendance policy | `WorkAttendancePolicy` |
| Sensitive capability | `users.manage`, `system.admin` |
| Mailbox | `EmailAccount` |
| Scan | `ScanInbox` |
| Vehicle fine | `VehicleFine` |
| Vehicle accident | `VehicleAccident` |
| Maintenance event | `VehicleMaintenance` |
| License renewal | `VehicleLicenseRenewal`; existing API fields retain `license_*` |
