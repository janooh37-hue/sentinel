# Handoff — SMS delivery-status tracking (gateway → app)

**Created:** 2026-07-09 · **Status:** ready to build · **Origin:** live incident (below)

## One-line goal
Make the app show the **true delivery state** of each SMS (Delivered / Failed / Pending)
by reading it back from the SMS-gateway, instead of only recording "gateway accepted it."

---

## Why (the incident that motivated this)
A leave generated in the app logged `status=sent`, but the employee never received the
SMS. Root cause: our `status='sent'` only means **the on-site SMS-gateway (SMS Gate app on
the Android phone) accepted the request (HTTP 2xx)** — NOT that the SIM actually transmitted
it. In this case the phone's SIM returned `RESULT_ERROR_GENERIC_FAILURE` (a carrier/SIM-level
send failure, e.g. daily SMS cap or credit exhaustion after a burst of test sends). We only
discovered it by manually querying the gateway's `GET /message/{id}`.

**The gap:** a real delivery failure is invisible in the app. Operators think an SMS went out
when it silently failed at the SIM. This feature closes that gap by surfacing the gateway's
delivery state and flagging failures.

> NOTE: this feature makes SIM failures **visible**; it does not fix the SIM. The SIM
> reliability (credit, daily caps, throttling on bursts to one number) is a separate
> operational concern — see [[sms-notifications-via-sim-gateway]].

---

## Current state (what exists today)
- `backend/app/services/sms_client.py` — `send(phone, text) -> SendResult(ok, message_id, error)`.
  On gateway 2xx it returns `message_id = data["id"]` (the gateway's message id). This module is
  the ONLY place that knows the gateway HTTP shape.
- `SmsMessage` model (`backend/app/db/models.py:406`): columns `status` (`'sent'|'failed'` — set at
  **send time** from `SendResult.ok`), `provider_msg_id` (the gateway id — **already stored**),
  `error`, `body`, `event_type`, `event_ref`, `phone`, `employee_id`, `created_at`, `sent_by`.
- `sms_service._log_row(...)` writes each attempt; `send_for_event` / `auto_send_for_book` /
  `auto_send_leave_status` are the send entry points.
- API `backend/app/api/v1/sms.py`: `POST /sms/send`, `GET /sms/status`. Schema
  `backend/app/schemas/sms.py` (`SmsMessageRead` has `status`, no delivery field).
- Frontend: `frontend/src/pages/employees/tabs/MessagesTab.tsx` (per-employee SMS history) and
  `frontend/src/pages/books/BookRecordPage.tsx` (per-record SMS) render `SmsMessageRead`.
- Scheduler: `backend/app/services/scheduler_service.py` uses APScheduler `BackgroundScheduler`
  + `IntervalTrigger`, already runs periodic jobs (`_run_email_sync`, `_run_scan_drain`,
  `_run_grant_sweep`) inside the uvicorn process. **Add the delivery poller here.**

## The gateway delivery API (verified working)
`GET {gateway_url}/message/{id}` with HTTP Basic auth (`GSSG_SMS_USERNAME`/`_PASSWORD`) returns:
```json
{
  "id": "jXSwf4lGNehgaGuTIcscv",
  "state": "Failed",                       // overall: Pending | Processed | Sent | Delivered | Failed
  "recipients": [{"phoneNumber": "+9715...", "state": "Failed",
                  "error": "Send result: RESULT_ERROR_GENERIC_FAILURE (Generic failure cause)"}],
  "states": {"Pending": "..ts..", "Processed": "..ts..", "Failed": "..ts.."},
  "textMessage": {"text": "..."}
}
```
We always send to exactly one recipient, so `recipients[0]` is the delivery outcome.
Terminal states: **Delivered** (success) and **Failed** (SIM/carrier error, `recipients[0].error`).
Non-terminal: Pending / Processed / Sent (queued/handed to radio, not yet confirmed).

> Alternative to polling: SMS Gate supports **webhooks** (push delivery events). Cleaner (no
> poll lag) but requires the phone to reach this server's URL and a public/LAN webhook endpoint.
> **Recommendation: start with polling** (simplest in local mode, no inbound exposure); consider
> a webhook later. Decision left to the builder — see Open questions.

---

## Recommended design
1. **Model:** add two nullable columns to `sms_messages` (migration `NNNN_sms_delivery_state`,
   single linear head, `server_default` not needed since nullable):
   - `delivery_state: str | None` — the gateway's recipient state (`Delivered|Failed|Pending|Processed|Sent`), NULL until first polled.
   - `delivery_checked_at: datetime | None` — last poll time.
   Keep `status` as-is (send-time accept/fail) so nothing existing breaks; `delivery_state` is the
   authoritative "did it reach the handset" signal.
2. **Client:** add `sms_client.get_delivery(message_id) -> DeliveryResult(state, error)` — the only
   place that knows `GET /message/{id}`. One retry on transport error, like `send`.
3. **Poller** (`scheduler_service`): every ~5 min, select `SmsMessage` rows where
   `provider_msg_id IS NOT NULL` AND `delivery_state` is NULL or non-terminal AND `created_at`
   within the last ~24h (bound the work — do NOT scan all history). For each, call
   `get_delivery`, update `delivery_state` + `error` + `delivery_checked_at`. Stop polling a row
   once terminal (Delivered/Failed).
4. **API/schema:** add `delivery_state` (+ maybe `delivery_checked_at`) to `SmsMessageRead`;
   resync `api.types.ts` (`/sync-api-types`). Optional on-demand refresh endpoint
   `POST /sms/{id}/refresh-delivery` for a manual "re-check now" button.
5. **Frontend (`MessagesTab.tsx` + record SMS surfaces):** show a delivery badge —
   Delivered (green ✓), Failed (red ✕ + the recipient error on hover/expand), Pending (amber,
   "sent, awaiting confirmation"). Failed rows should be visually distinct and offer **Resend**
   (reuse the existing send path / `SendSmsButton`). Bilingual labels (en/ar) — this is a
   bilingual surface, run `i18n-rtl-reviewer` after.

---

## Implementation plan (phased, TDD)
- **Phase 1 — client + model.** `sms_client.get_delivery` (unit-test with `httpx.MockTransport`
  parsing Delivered/Failed/Pending). Migration adding `delivery_state` + `delivery_checked_at`
  (review with `alembic-migration-reviewer`; SQLite batch-alter if needed — columns are nullable
  so a plain add is fine).
- **Phase 2 — poller.** Add `_run_sms_delivery_poll` to `scheduler_service` + register on an
  interval (mirror `_run_grant_sweep`). Test the update logic against a fake gateway (monkeypatch
  `sms_client.get_delivery`). Bound the query (recent + non-terminal only).
- **Phase 3 — API/schema.** Expose `delivery_state` on `SmsMessageRead`; resync types; typecheck.
- **Phase 4 — frontend.** MessagesTab + record SMS row: delivery badge, failed styling, error
  detail, Resend. Add en/ar strings. vitest for the badge states.
- **Phase 5 — verify.** Backend `pytest`, `ruff`, `mypy`; frontend `tsc`/`eslint`/`vitest`;
  `i18n-rtl-reviewer`. Commit + push to `origin/main`, then `mng deploy` (needs UAC on the
  console — be on **Tailscale**; see [[deploy-and-mng-cli]]).

## Files to touch
- `backend/app/services/sms_client.py` (add `get_delivery`)
- `backend/app/services/scheduler_service.py` (add poller job)
- `backend/app/db/models.py` (2 columns) + new migration under `db/migrations/versions/`
- `backend/app/schemas/sms.py` (`SmsMessageRead.delivery_state`)
- `backend/app/api/v1/sms.py` (optional refresh endpoint) + `backend/openapi.json`
- `frontend/src/lib/api.types.ts` (regen), `frontend/src/pages/employees/tabs/MessagesTab.tsx`
  (+ `.test.tsx`), `frontend/src/pages/books/BookRecordPage.tsx`, `frontend/src/locales/{en,ar}.json`

## Gotchas
- Poll must be **bounded** (recent + non-terminal rows only) — do not re-query terminal rows or
  scan all history each tick.
- `status` (send-time) and `delivery_state` (delivered?) are **different**; don't conflate.
  A row can be `status=sent` + `delivery_state=Failed` — that's exactly the case we're fixing.
- Multi-recipient: we always send to one number → use `recipients[0]`.
- Migration: hand-numbered `NNNN_slug`, keep a single linear head (`alembic-heads-guard`).
- After schema change, **resync `api.types.ts`** or the frontend drifts (committed types, not
  regenerated by `mng build`).
- Don't auto-resend on failure automatically (a GENERIC_FAILURE will just fail again during a
  SIM block) — surface it and let the operator resend once the SIM is healthy.

## Open questions (decide before/while building)
1. **Polling vs webhook** — recommend polling first (no inbound exposure). Revisit webhook if
   poll lag matters.
2. **`delivery_state` new column vs extending `status` vocabulary** — recommend a new column to
   preserve existing `status` semantics and avoid touching every read site's assumptions.
3. **How far back to poll** — recommend last 24h; older un-confirmed rows stay whatever they are.
4. **Auto-resend?** — recommend NO (manual resend only).

## Loose end from this session
- Test record **book 448 / leave 791** (Annual Leave, Aug 10–14, G3082) was generated to test
  delivery and its SMS **failed** at the SIM. It's a throwaway — soft-delete it
  (`book_service.delete_book(448)` + `leave_service.soft_delete_leave(791)`; leave 791 has fresh
  dates so it is NOT deduped/shared — safe to delete). Earlier session note: a same-dates leave
  **dedups** into an existing Leave row, so only delete leave_ids whose sole owning book is a test
  book.
