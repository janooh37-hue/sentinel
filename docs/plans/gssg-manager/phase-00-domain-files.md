# Phase 0 — Domain language and ADR

Status: complete. PR #73 merged and deployed on 2026-09-05.
Branch: `refactor/p0-domain-files`. Dependency: none.

Follow [WORKFLOW.md](WORKFLOW.md). This phase writes documentation only; do not create artificial failing tests for Markdown existence. Establish the acceptance checklist below before drafting, then verify the statements against code before every document revision.

## Outcome and scope

Create root `CONTEXT.md` and `docs/adr/0001-superseding-vs-excusing-leave.md`. Define the vocabulary used by later phases without renaming persisted models or routes. Use the `domain-modeling` skill when executing this phase.

## Verify the code before drafting

- [x] Read `backend/app/core/leave_lifecycle.py`, `backend/app/services/workforce_leave.py`, and `backend/app/services/absence_service.py`.
- [x] Trace approved-policy selection in attendance evaluation, punch allocation and queue evaluation. Verify effective-date boundaries and shift priority.
- [x] Trace attendance correction application, revocation, ETags and read-time overlay in `workforce_admin_service.py` and the workforce read/dashboard callers.
- [x] Inspect `Book`, `Document`, `BookVersion`, `AttendanceEvaluation`, `AttendanceAdjustment`, `EmailAccount` and `ScanInbox` models and their callers.
- [x] Read permissions and permission-request enforcement before defining sensitive capabilities.
- [x] Check whether CONTEXT.md or ADRs have been added since the audit; extend existing documents instead of creating competing definitions.

## Acceptance checks prepared first

| Check | Expected evidence | Result and source evidence |
| --- | --- | --- |
| Canonical Record vocabulary | Record is persisted as Book; General Book is a form kind, not a synonym for every Record | Accepted. `Book` is the registered row; `form_kind.resolve_service` and `word_book_service.create_word_book` establish General Book as one template/service kind. |
| Artifact definition | Covers template-generated and Word-authored DOCX/PDF outputs; does not imply every artifact starts from template data | Accepted. `Document` carries DOCX/PDF paths; `BookVersion` links committed artifacts; `word_book_service.finish_word_session` copies a Word-saved DOCX before conversion. |
| Attendance correction | Supervisor correction overlays the automatic verdict at read time; revocation removes the overlay; no reevaluation is implied | Accepted. The `workforce.attendance.correct` gate controls creation and revocation; the active unrevoked correction is selected and overlaid by `workforce_admin_service`. Revocation removes that leaf and may reveal an earlier unrevoked correction. Read and dashboard services consume the overlay, and the live API path does not enqueue reevaluation. |
| Policy resolution | Approved, effective policies; shift specificity, latest start and deterministic tie-break verified in code | Accepted. All three selectors use an inclusive `effective_from`, exclusive `effective_to`, shift-specific-first, latest-start, highest-ID ordering. Punch allocation additionally requires the paired approver field. |
| Leave liveness | Includes deletion, type and status conditions; unknown request-group types are not automatically annual | Accepted. `workforce_leave._excusing_reason` checks deletion, kind, and canonical status; `leave_lifecycle.is_annual` recognizes only explicit Annual labels. |
| Superseding versus excusing | Separate code-backed questions and sets; no invented HR or payroll justification | Accepted. `absence_service.supersedes_absence` and `workforce_leave._excusing_reason` answer different questions. ADR 0001 records the missing business rationale as unknown. |
| Capability sensitivity | Definitions match backend role/per-user/request enforcement | Accepted. `perm_service` blocks per-user grants for `users.manage` and `system.admin`; `permission_request_service` rejects requests for the same set; admin role resolution supplies them. |
| Language | Human terminology in definitions; implementation names only in explicit mapping/source notes | Accepted. Definitions use product terms; database/API spellings are isolated under `CONTEXT.md`'s Implementation mappings and the ADR's Source evidence. |

## Tasks

- [x] Draft grouped definitions for Record, General Book, generated artifact, revision, attendance case, automatic verdict, attendance correction and effective attendance.
- [x] Define approved attendance policy, lifecycle-live leave, excusing leave, superseding leave and absence episode. Include the inclusive start/exclusive end convention only after source verification.
- [x] Define capability, sensitive capability, workforce scope, mailbox, Outlook handoff, scan and triage decision. Triage includes classification evidence; it is not only a flattened field map.
- [x] Define vehicle fine, accident, maintenance event and license renewal using existing product language.
- [x] Add `_Avoid_` notes for ambiguous terms, preserving database/API spellings in implementation mappings.
- [x] Draft the ADR with context, observed behavior, decision, alternatives and consequences. Keep superseding leave separate from excusing leave. Cite the actual predicates and caller responsibilities.
- [x] Do not repeat the old claim that national service is not a paper or that a Leave Permit can never excuse absence as a business fact unless confirmed. Record a business rationale as unknown when code only establishes behavior.
- [x] Review each definition against its source and update the evidence record before finalizing.

## Verification and completion

- [x] Check both files exist, Markdown links resolve, and terminology does not contradict current code.
- [x] Confirm no application code, templates, schema, routes or runtime configuration changed.
- [x] Run `git diff --check`, including whitespace checks for the untracked new files.
- [x] Run the required `i18n-rtl-reviewer` document review. Technical planning prose need not create new application locale keys; any proposed user-facing terminology must work in both languages.
- [x] Review and release the documentation PR under the shared workflow; no application bundle is required for documentation alone.
- [x] Rollback: revert only the documentation change if definitions are incorrect; correct downstream plans before implementation.

## Execution evidence

Release: [PR #73](https://github.com/janooh37-hue/sentinel/pull/73),
implementation commit `d8f9fc9565380d2a39592aa46031e579112248e7`, merged as
`f6f19382582fe04c8b2d6131b222e9deb8172481`. The user authorized `mng update`
on the Windows production host and supplied an authenticated Remmina session.
At approximately 03:22 Asia/Dubai on 2026-09-05, the update completed, the
backend smoke check passed, and the restarted service reported Running with
health OK (`v4.0.0a0`). A separate `git rev-parse HEAD` in the production
checkout confirmed the merge commit. No application bundle was needed.
This post-release record is carried forward in the next phase PR.

Starting commit: `f8d603d4d2f4298514015f085d8f96fe9647856b`.
The worktree already contained the revised plan set and historical plan as
untracked planning inputs; Phase 0 did not alter files outside its assigned
documentation scope.

Source anchors reviewed:

- Records and artifacts: `backend/app/db/models.py`,
  `backend/app/core/form_kind.py`, `backend/app/services/book_service.py`,
  `backend/app/services/document_service.py`, and
  `backend/app/services/word_book_service.py`.
- Attendance policy and verdicts:
  `backend/app/db/workforce_models.py`,
  `backend/app/services/attendance_evaluation_service.py`,
  `backend/app/services/attendance_punch_service.py`, and
  `backend/app/services/attendance_queue_service.py`.
- Corrections and read-time projections:
  `backend/app/services/workforce_admin_service.py`,
  `backend/app/services/workforce_read_service.py`,
  `backend/app/services/workforce_dashboard_service.py`, and
  `backend/app/api/v1/workforce.py`.
- Leave and absence: `backend/app/core/leave_lifecycle.py`,
  `backend/app/core/timesheet_codes.py`,
  `backend/app/services/workforce_leave.py`, and
  `backend/app/services/absence_service.py`.
- Access: `backend/app/core/permissions.py`,
  `backend/app/services/perm_service.py`,
  `backend/app/services/permission_request_service.py`, and
  `backend/app/services/workforce_scope_service.py`.
- Correspondence and intake: `backend/app/db/models.py`,
  `backend/app/services/email_service.py`,
  `backend/app/services/outlook_handoff_service.py`,
  `backend/app/services/scan_inbox_service.py`,
  `backend/app/services/scan_triage_service.py`, and
  `backend/app/core/extraction/types.py`.
- Fleet: `backend/app/db/models.py`, `backend/app/schemas/vehicle.py`, and
  `backend/app/services/vehicle_service.py`.

| Slice | Commit | Current-code findings | Test and exact command | Before: RED/GREEN and reason | After: result | Reviewer / build / smoke evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 0 — domain files | `f8d603d4` starting point; documentation uncommitted | Policy selectors agree on half-open dates and priority; live correction path overlays without reevaluation; superseding and excusing sets differ; triage currently flattens richer extraction evidence | `git diff --check`; `git diff --no-index --check /dev/null CONTEXT.md`; the same no-index check for the ADR and this phase file; `realpath -e` for every relative link target. No application tests by design. | N/A — the phase forbids artificial tests for Markdown. | Tracked diff check passed; all three no-index checks reported no whitespace errors (exit 1 only because each file differs from `/dev/null`); every link target resolved. | `i18n-rtl-reviewer` found one should-fix: use the UI's existing “License renewal” spelling consistently with English `license` and Arabic “الترخيص / تجديد الترخيص”; corrected in `CONTEXT.md`, with no other findings. PR review, commit, merge, deploy, and release smoke pending. |
