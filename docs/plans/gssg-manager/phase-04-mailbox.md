# Phase 4 — Mailbox

Status: complete; merged and deployed. PR: #77. Branch: `refactor/p4-mailbox`. Release dependency: Phase 3.

Follow [WORKFLOW.md](WORKFLOW.md). Tests first and current-code verification are required before every implementation slice; required checks precede every build.

## Outcome and boundaries

`email_service` owns mailbox synchronization, drafting and handoff reconciliation. Remove private cross-service calls and the reverse dynamic import of handoff logic. Inject the IMAP connector as the external boundary. HTTP handoff responses, ledger behavior and attachment retention remain compatible.

Agreed boundaries: `draft_outgoing`, connection/sync functions, reconciliation behavior and existing email/ledger routes. Use real temporary files and SQLite; fake the IMAP server, not the mailbox business logic.

## Verify current code first

- [x] Read `email_service.py`, `outlook_handoff_service.py`, email routes and schemas. Inventory public exports and every IMAP operation actually used.
- [x] Trace append, attachment save, ledger flush/commit, cleanup, sent reconciliation and stale tagging, including partial failure order.
- [x] Locate account locks, sync-all connector propagation, retry behavior and connection cleanup paths.
- [x] Run `test_outlook_handoff.py` and existing email/ledger permission tests before moving anything.

## Test-first slices

| Slice | Tests before code | Verified implementation task |
| --- | --- | --- |
| 4.1 Draft success | Real message bytes contain expected subject, recipients, signature, threading headers and attachments; public ledger result identifies pending handoff | Introduce `ImapConnection`/connector contract and `draft_outgoing`; move attachment value type to email schemas |
| 4.2 Server state | Missing Drafts folder, create success/failure, append rejection, auth failure and logout behavior | Use a stateful `FakeImap` with folders/messages/status responses and configurable failures; do not use empty-success no-ops for sync |
| 4.3 Local failure | Saved attachments cleaned on failed draft; ledger/file state consistent if append or persistence fails; external append cannot be transactionally undone unless existing protocol supports it | Preserve actual ordering and document unavoidable recovery behavior; avoid duplicate retry drafts |
| 4.4 Reconciliation | Sync observes a sent message, matches only the intended pending entry, updates status once, preserves unmatched messages, handles repeated sync and stale handoffs | Move reconciliation/stale handling into mailbox owner; retain account-level locking |
| 4.5 Route cutover | Existing HTTP handoff result and capability-denial cases remain green | Route calls `email_service.draft_outgoing`; migrate scheduler and sync callers |

## Detailed tasks

- [x] Create `backend/tests/fakes/imap.py` and a connector/instance fixture with one consistent shape. Model select/search/fetch as operations on actual fake messages.
- [x] Port handoff behavior tests to `test_email_service.py` one behavior at a time. Keep original assertions until equivalent replacements pass.
- [x] Inject connector through `test_connection`, `sync_now`, `sync_all_accounts` and `draft_outgoing`, including nested calls.
- [x] Move private MIME, attachment, pending-match and cleanup helpers with their callers. Keep the public surface small; do not expose helpers just to preserve private tests.
- [x] Remove reverse dynamic imports, then delete `outlook_handoff_service.py` after executable import search is clear.
- [x] Review transaction ownership and account-lock lifetime after consolidation; merging files must not change either.

## Verification before build and release

- [x] Run the replacement email service/connection/route/scheduler tests, granular ledger gates and scheduler notification tests; then the backend gate.
- [x] Confirm no OpenAPI change for the handoff response and no obsolete executable imports.
- [x] Run notification-template and i18n reviews if message formatting/copy changes; moving byte-identical copy still requires proving parity.
- [x] Smoke using the stateful fake. A real Drafts/sent-folder smoke needs explicit authorization and an isolated account before creating external mail.
- [x] Rollback: ledger and server drafts may already exist; inspect pending/sent state before retrying, and avoid duplicate append after redeploy.

## Execution evidence

Starting commit: `d255072ca67f5a53b3a908f44d7c325c2d451909`, the verified
Phase 3 production merge. Fresh worktree `/tmp/sentinel-gssg-p4`, branch
`refactor/p4-mailbox`, initially clean. Repository instructions, workflow,
domain context and the current caller inventory were read before implementation.

Before application edits, the existing handoff, granular ledger gate, and
scheduler notification files passed all 25 tests in 20.07 seconds:

```bash
env PYTHONDONTWRITEBYTECODE=1 GSSG_DATA_DIR=<fresh-synthetic-directory> \
  /tmp/gssg-load/venv/bin/python -m pytest -p no:cacheprovider \
  backend/tests/test_outlook_handoff.py \
  backend/tests/test_granular_permits_ledger_gates.py \
  backend/tests/test_scheduler_notify.py
```

Baseline runtime OpenAPI captured all 275 paths. The first two-builder barrier
requires a stateful IMAP fake followed by a real HTTP/SQLite/file/MIME test on
the old owner before moving the connector or route. Existing behavior moves
retain GREEN-before/GREEN-after evidence; the newly exposed public draft
boundary may initially fail because it does not exist.

Current-code nuance: server `NO` responses can be handled silently by folder
discovery/fetch and differ from raised exceptions. Preserve the actual existing
watermark behavior for each case; the plan's partial-error prose does not
authorize a new retry or synchronization policy.

The baseline checkpoint initially awaited the fake contract, failure cases,
coverage transfers and reviews. Their final evidence and the completed Windows
gate and release follow below.

The first old-route HTTP characterization passed before the move (1 test,
3.97 seconds), clearing the two-builder barrier. The first direct draft test
then failed because the new public boundary did not exist and passed after
that boundary was implemented with full MIME/persistence assertions.

The typed connector contract uses covariant `Sequence` response containers.
LIST, FETCH and logout admit byte tuples as the actual imaplib contract does;
ordinary responses admit bytes and null. Early review removed an attempted
normalizing adapter that would have added new runtime rejection behavior.
The structural protocol accepts the raw logged-in IMAP4 connection under strict
mypy without casts or `Any`, preserving existing response handling.

During a combined transitional run after the route cutover, two legacy tests
still patched `_connect` while the new route resolved `connect_imap`. They
attempted an SSL connection to the configured IMAP host and failed while
decrypting synthetic credentials, before login or mailbox commands. The builder
corrected the stale patch targets. Mailbox test modules now also replace both
IMAP transport constructors with a local failure guard, so a missed connector
patch cannot open a socket. This failed harness run is not counted as product
RED or successful verification; guarded reruns are required.

Final frozen focused matrix: 60 passed in 27.40 seconds across service (26),
connection/route/scheduler (20), granular ledger gates and existing scheduler
notification tests (14). All 11 legacy handoff tests have passing replacements;
the old service/test files and temporary private aliases are removed. The final
public dedup test observes actual imports and skipped duplicates rather than
inspecting the private snapshot helper. Test-local transport guards and settings/
crypto cache teardown apply throughout the replacement mailbox suites.

Final runtime OpenAPI equals the complete 275-path baseline exactly. Full local
Ruff improves from 24 to 22 existing diagnostics; mypy improves from 31 to 27
existing errors in 10 files. Normalized comparison finds no new diagnostic.
Ruff 0.16.6's detailed formatter renderer crashes identically on baseline and
candidate; the same formatter with concise output completes, with 199 existing
unformatted files versus 203 at baseline and no newly unformatted file. Owned
new/moved files pass focused lint/format checks.

The isolated real HTTP smoke passed: three capability denials before connection;
connection NOOP/logout; exact mailto/draft responses with English/Arabic MIME
content and attachment; first sync importing two messages with reconciliation,
scan enqueue and stale tagging; repeated sync importing zero/skipping two;
append/create/retry rejection with HTTP 502 and no new row or orphan file.
The server uses only the stateful IMAP fake and blocks real transport constructors.
One frontend comment now names the surviving backend tag owner; executable
frontend code, UI strings and API contracts are unchanged.

Independent standards, spec, notification-template and i18n/RTL reviews passed
against exact candidate `41223db20f8f8531b82ecc3f1a011b32900664d6`. Moved
user-visible literals and MIME fields match the starting commit; only internal
docstrings changed. No material findings remain. PR #77 contains the candidate
and final validation evidence. The production release is recorded below.

The exact candidate passed the supported Windows backend suite: **2,016 passed,
9 existing skips in 1,233.51 seconds**. Windows Ruff
0.15.19 reports 22 existing lint diagnostics (24 at baseline), formatting reports
135 existing unformatted files and 493 formatted (139/486 at baseline), and mypy
reports 27 existing errors in 10 files (31 in 11 at baseline). Local normalized
comparisons identify no new diagnostics. A same-host Windows format-list
comparison confirms four removed entries and no newly unformatted file. The Windows gate completed against
`41223db20f8f8531b82ecc3f1a011b32900664d6` in the isolated
`gssg-p4-check-c1c566fc444b` worktree. Logs/results use
`gssg-p4-win-c1c566fc444b`; the synthetic data and evidence are retained.

Release rollback uses a reviewed revert merged and pushed before `mng update`.
It does not reset the live database or automatically replay draft attempts.

PR #77 merged as `f4619ed97e8e05ddd9b6314f7699294bd87e1da4` on
5 September 2026. `mng update` completed at 09:16 Dubai time: frontend build and
import smoke passed, service Running and health OK. A separate production HEAD
check confirmed that exact merge commit before the fresh Phase 5 worktree began.
