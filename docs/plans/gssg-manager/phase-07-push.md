# Phase 7 — Push notifications

Status: not started. Branch: `refactor/p7-push`. Release dependency: Phase 6.

Follow [WORKFLOW.md](WORKFLOW.md): tests first, current-code verification before each implementation slice, and required checks before every build.

## Outcome and policy boundary

`push_service` owns subscriptions, bilingual actionable copy, delivery and deduplication; scheduler opens/closes sessions and schedules execution. The external deliverer is injected/faked. Existing public callers retain their behavior unless an explicit delivery-policy change is chosen.

Current audit finding: scheduler `_notify_user` marks actionable references sent even when `send_to_user` returns zero successes. This is an existing reliability issue. First characterize it. Record an explicit decision before changing it: preserve current user-level marking during movement, or make failed delivery retryable. For retryable delivery decide how partial success, multiple endpoints, no subscriptions and recurring actions behave. Do not promise exactly-once delivery across network and database failures.

Agreed boundaries: `compose_actionable`, `send_to_user`, `notify_actionable`, `notify_all_active`, subscription operations and external `Deliverer`. A new retry contract or dedup storage model needs a separately recorded decision and possibly a follow-up phase.

## Verify current code first

- [ ] Read `push_service.py`, scheduler copy/notifier functions, `notification_service.py`, `admin_notify.py`, vehicle reminders and included-papers notifications.
- [ ] Inspect PushSent keys/lifetime, transactions, subscription deletion and pywebpush error handling.
- [ ] Trace no-subscription, all-failed, partially successful, repeated-tick and action-recurrence paths before choosing assertions.
- [ ] Inventory exact EN/AR strings, locale fallback, links and attachment counts. Run existing push-copy, scanback-push and scheduler tests.

## Test-first slices

| Slice | Tests before code | Verified implementation task |
| --- | --- | --- |
| 7.1 Copy | `test_push_service.py`: port literal EN/AR email/document/scan/scanback copy, plural/count/attachment details and correct destination | Move composition into push module; keep copy parity independently of delivery |
| 7.2 Delivery | Two subscriptions with AR/default locale, success count, PushGone removal, transient failure retained, unexpected failure behavior | Introduce named Deliverer external boundary and outbox fake; preserve backend subscription semantics |
| 7.3 Existing dedup | First/second tick, zero subscriptions, all failures, partial success and recurrence through notifier public behavior | Characterize current marking and return counts before moving notifier logic |
| 7.4 Chosen policy | If retry behavior is approved: transient all-failure retries later; partial-success handling matches explicit policy; repeated successful tick stays deduplicated; recurring actionable identity behaves as specified | Implement separately from pure code movement; assess schema needs before claiming completion |
| 7.5 Caller migration | Scheduler, included papers, departure flip, admin requests and vehicle reminders produce expected outbox content | Replace internal `send_to_user` mocks with external delivery fake where useful; keep caller-specific behavior tests |

## Detailed tasks

- [ ] Move copy and notifier ownership without widening the public API solely to support old private-helper tests.
- [ ] Keep email-preview/sender-name tests through a meaningful public notification boundary; do not expose helpers only to make tests compile.
- [ ] `notify_all_active` receives a session; scheduler retains session management. Check commit behavior and durable markers explicitly.
- [ ] Preserve actionable identity and link semantics. Record whether dedup is per user or endpoint and whether it represents attempted or successful delivery.
- [ ] Preserve departure-specific copy if it remains its own use case; sharing delivery does not require forcing all copy into one generic builder.
- [ ] If policy needs schema migration, follow new-migration and required Alembic review; otherwise keep schema unchanged.

## Verification before build and release

- [ ] Run push service, notification service, scheduler, reminders, included-papers, book routes and scanback tests; then backend checks.
- [ ] Run `notification-template-reviewer` and `i18n-rtl-reviewer`; inspect literal EN/AR output and fallback cases.
- [ ] Smoke outbox delivery, repeated tick and simulated failure recovery. Real push requires explicit authorization and a named test device.
- [ ] Rollback: PushSent markers affect retry behavior after revert; inspect the chosen policy and any migration compatibility. Do not bulk delete markers and resend historical notifications.

## Execution evidence

Pending: delivery-policy decision, current zero-success evidence, copy fixtures, baseline/RED/GREEN commands, reviewer results and durable-state/release evidence.
