# Phase 4 — Mailbox

Status: not started. Branch: `refactor/p4-mailbox`. Release dependency: Phase 3.

Follow [WORKFLOW.md](WORKFLOW.md). Tests first and current-code verification are required before every implementation slice; required checks precede every build.

## Outcome and boundaries

`email_service` owns mailbox synchronization, drafting and handoff reconciliation. Remove private cross-service calls and the reverse dynamic import of handoff logic. Inject the IMAP connector as the external boundary. HTTP handoff responses, ledger behavior and attachment retention remain compatible.

Agreed boundaries: `draft_outgoing`, connection/sync functions, reconciliation behavior and existing email/ledger routes. Use real temporary files and SQLite; fake the IMAP server, not the mailbox business logic.

## Verify current code first

- [ ] Read `email_service.py`, `outlook_handoff_service.py`, email routes and schemas. Inventory public exports and every IMAP operation actually used.
- [ ] Trace append, attachment save, ledger flush/commit, cleanup, sent reconciliation and stale tagging, including partial failure order.
- [ ] Locate account locks, sync-all connector propagation, retry behavior and connection cleanup paths.
- [ ] Run `test_outlook_handoff.py` and existing email/ledger permission tests before moving anything.

## Test-first slices

| Slice | Tests before code | Verified implementation task |
| --- | --- | --- |
| 4.1 Draft success | Real message bytes contain expected subject, recipients, signature, threading headers and attachments; public ledger result identifies pending handoff | Introduce `ImapConnection`/connector contract and `draft_outgoing`; move attachment value type to email schemas |
| 4.2 Server state | Missing Drafts folder, create success/failure, append rejection, auth failure and logout behavior | Use a stateful `FakeImap` with folders/messages/status responses and configurable failures; do not use empty-success no-ops for sync |
| 4.3 Local failure | Saved attachments cleaned on failed draft; ledger/file state consistent if append or persistence fails; external append cannot be transactionally undone unless existing protocol supports it | Preserve actual ordering and document unavoidable recovery behavior; avoid duplicate retry drafts |
| 4.4 Reconciliation | Sync observes a sent message, matches only the intended pending entry, updates status once, preserves unmatched messages, handles repeated sync and stale handoffs | Move reconciliation/stale handling into mailbox owner; retain account-level locking |
| 4.5 Route cutover | Existing HTTP handoff result and capability-denial cases remain green | Route calls `email_service.draft_outgoing`; migrate scheduler and sync callers |

## Detailed tasks

- [ ] Create `backend/tests/fakes/imap.py` and a connector/instance fixture with one consistent shape. Model select/search/fetch as operations on actual fake messages.
- [ ] Port handoff behavior tests to `test_email_service.py` one behavior at a time. Keep original assertions until equivalent replacements pass.
- [ ] Inject connector through `test_connection`, `sync_now`, `sync_all_accounts` and `draft_outgoing`, including nested calls.
- [ ] Move private MIME, attachment, pending-match and cleanup helpers with their callers. Keep the public surface small; do not expose helpers just to preserve private tests.
- [ ] Remove reverse dynamic imports, then delete `outlook_handoff_service.py` after executable import search is clear.
- [ ] Review transaction ownership and account-lock lifetime after consolidation; merging files must not change either.

## Verification before build and release

- [ ] Run email service, handoff tests still awaiting migration, granular ledger gates and scheduler notification tests; then the backend gate.
- [ ] Confirm no OpenAPI change for the handoff response and no obsolete executable imports.
- [ ] Run notification-template and i18n reviews if message formatting/copy changes; moving byte-identical copy still requires proving parity.
- [ ] Smoke using the stateful fake. A real Drafts/sent-folder smoke needs explicit authorization and an isolated account before creating external mail.
- [ ] Rollback: ledger and server drafts may already exist; inspect pending/sent state before retrying, and avoid duplicate append after redeploy.

## Execution evidence

Pending: baseline, fake protocol contract, each failure scenario, RED/GREEN results, message parity, source review and release/rollback observations.
