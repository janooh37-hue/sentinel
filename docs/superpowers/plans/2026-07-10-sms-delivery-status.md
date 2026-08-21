# SMS Delivery-Status Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface each SMS's *true* delivery outcome (Delivered / Failed / Pending) by reading it back from the on-site SMS-gateway, instead of only recording "the gateway accepted the request."

**Architecture:** The gateway (SMS Gate on the office Android phone) already returns a per-recipient delivery state via `GET /message/{id}`. We store the gateway message id today (`SmsMessage.provider_msg_id`) but never poll it. This plan adds (1) a `get_delivery()` transport call in `sms_client`, (2) two nullable columns on `sms_messages` for the delivery outcome, (3) a bounded scheduler poller that fills them in, (4) a manual "re-check now" endpoint, and (5) frontend badges plus delivery-aware resend so a SIM-level failure stops masquerading as a successful send.

**Tech Stack:** FastAPI + SQLAlchemy (SQLite), Alembic (hand-numbered `NNNN_slug` revisions), APScheduler `BackgroundScheduler`, httpx (with `MockTransport` in tests), React 19 + React Query + i18next, Vitest.

## Global Constraints

- **Origin / prior context:** This plan supersedes the handoff note `docs/superpowers/plans/2026-07-09-sms-delivery-status-handoff.md`. Read it for the motivating incident.
- **`status` and `delivery_state` are DIFFERENT and must not be conflated.** `status` (`'sent'|'failed'`) is set at *send time* from the gateway's HTTP 2xx (accept). `delivery_state` (`Delivered|Failed|Pending|Processed|Sent`, nullable) is the gateway's *recipient* outcome. A row can legitimately be `status='sent'` + `delivery_state='Failed'` — that exact case is the bug we are fixing.
- **Naive UTC timestamps only.** `pytest` runs with `filterwarnings=error`; `datetime.utcnow()` raises a `DeprecationWarning` (→ test failure). Use `datetime.now(UTC).replace(tzinfo=None)` (the repo's `_utcnow` convention).
- **Migrations:** hand-numbered `NNNN_<slug>`, single linear head. Current head is `0048_merge_sms_scaninbox`; this plan's migration is `0049_sms_delivery_state` with `down_revision = "0048_merge_sms_scaninbox"`. SQLite: use `op.batch_alter_table`. Review with the `alembic-migration-reviewer` agent.
- **Frontend contract is generated, not hand-written.** After the schema change you MUST resync `api.types.ts` via the `/sync-api-types` skill and commit `backend/openapi.json` + `frontend/src/lib/api.types.ts` together, or the frontend drifts silently.
- **Bilingual:** every new user-facing string needs `en` + `ar` in `frontend/src/locales/{en,ar}.json`. After Phase 4/5, run the `i18n-rtl-reviewer` and `notification-template-reviewer` agents.
- **Permission for the manual re-check:** the new `POST /sms/{id}/refresh-delivery` endpoint (and its re-check button) is gated by **`books.manage`** — the *same* capability that gates document/book creation (`create_book`, `books.py:366`), NOT `employees.notify`. Reuse the existing gate; do not invent a new capability. The existing `/sms/send` and `/sms/status` endpoints stay on `employees.notify` (unchanged). The background poller (scheduler job) has no permission check — it runs as the service.
- **Poll must be BOUNDED:** only rows with a `provider_msg_id`, a non-terminal `delivery_state`, and `created_at` within the last 24h. Never re-query terminal rows (`Delivered`/`Failed`) or scan all history.
- **No auto-resend.** A `RESULT_ERROR_GENERIC_FAILURE` will just fail again during a SIM block. Surface it; let the operator resend once the SIM is healthy.
- **Live prod:** every change must be committed **and pushed to `origin/main`** — `mng update` pulls `origin/main` onto the live server; unpushed fixes are silently overwritten.
- **Commands (from repo root):** backend `venv\Scripts\python.exe -m pytest`, `venv\Scripts\ruff.exe check .`, `venv\Scripts\mypy.exe`, `venv\Scripts\alembic.exe upgrade head`; frontend `pnpm -C frontend exec vitest run <file>`, `pnpm -C frontend exec tsc -b --noEmit`, `pnpm -C frontend run lint`.

## File Structure

**Backend**
- `backend/app/services/sms_client.py` — *modify.* Add `DeliveryResult` dataclass + `get_delivery(message_id)`. Extract a shared `_base_url()` helper (used by `send` too). This stays the ONLY module that knows the gateway HTTP shape.
- `backend/app/db/models.py` — *modify* (`SmsMessage`, ~line 429). Add `delivery_state`, `delivery_checked_at`.
- `backend/app/db/migrations/versions/0049_sms_delivery_state.py` — *create.*
- `backend/app/services/sms_service.py` — *modify.* Add `poll_pending_deliveries(db)` (bounded batch poll) and `refresh_delivery(db, sms_id)` (single row). Both DB-orchestration lives in the service, not the scheduler/router.
- `backend/app/services/scheduler_service.py` — *modify.* Add `_run_sms_delivery_poll` job + registration (mirrors `_run_grant_sweep`).
- `backend/app/schemas/sms.py` — *modify.* `SmsMessageRead` + `SmsStatusItem` gain `delivery_state` (and `SmsMessageRead` gains `delivery_checked_at`).
- `backend/app/api/v1/sms.py` — *modify.* Add `POST /sms/{sms_id}/refresh-delivery`.

**Frontend**
- `backend/openapi.json` + `frontend/src/lib/api.types.ts` — *regenerate* after the schema change.
- `frontend/src/lib/api.ts` — *modify.* Add a `refreshSmsDelivery(smsId)` wrapper (follow the `sendSms`/`getSmsStatus` pattern).
- `frontend/src/lib/smsDelivery.ts` — *create.* Shared `smsDeliveryTone(m)` so MessagesTab and BookRecordPage render identical logic (DRY).
- `frontend/src/components/sms/MessagesTab.tsx` (this is `frontend/src/pages/employees/tabs/MessagesTab.tsx`) — *modify.* Tri-state badge + "re-check" button.
- `frontend/src/pages/books/BookRecordPage.tsx` (`NotificationBlock`, ~line 837) — *modify.* Same tri-state badge.
- `frontend/src/components/sms/SendSmsButton.tsx` — *modify.* Treat `delivery_state === 'Failed'` as "not really delivered → offer resend".
- `frontend/src/locales/{en,ar}.json` — *modify.* New keys.
- Tests: `frontend/src/lib/smsDelivery.test.ts` (create), and edits to `MessagesTab.test.tsx` / `SendSmsButton.test.tsx`.

---

## Phase 1 — Transport: `sms_client.get_delivery`

### Task 1: Add `get_delivery` to the SMS client

**Files:**
- Modify: `backend/app/services/sms_client.py`
- Test: `backend/tests/test_sms_client.py`

**Interfaces:**
- Consumes: `get_settings()` (`sms_gateway_url`, `sms_username`, `sms_password`), module-level `_transport` (test seam).
- Produces:
  - `DeliveryResult(ok: bool, state: str | None = None, error: str | None = None)` — `ok=True` means the gateway was reached and a state was read (`state` set; `error` = the recipient-level error text, may be `None`); `ok=False` means transport/HTTP failure (`state=None`, `error` = the failure text).
  - `get_delivery(message_id: str) -> DeliveryResult`.
  - `_base_url() -> str` (internal helper; `send` also switches to it).

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_sms_client.py`:

```python
def test_get_delivery_reads_recipient_state(monkeypatch):
    _settings(monkeypatch)
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        return httpx.Response(200, json={
            "id": "sms-9",
            "state": "Delivered",
            "recipients": [{"phoneNumber": "+971501234567", "state": "Delivered"}],
        })

    monkeypatch.setattr(sc, "_transport", httpx.MockTransport(handler))
    res = sc.get_delivery("sms-9")
    assert res.ok is True
    assert res.state == "Delivered"
    assert res.error is None
    assert captured["method"] == "GET"
    assert captured["url"] == "http://192.168.1.50:8080/message/sms-9"


def test_get_delivery_surfaces_recipient_error_on_failure(monkeypatch):
    _settings(monkeypatch)

    def handler(request):
        return httpx.Response(200, json={
            "id": "sms-9",
            "state": "Failed",
            "recipients": [{
                "phoneNumber": "+971501234567",
                "state": "Failed",
                "error": "Send result: RESULT_ERROR_GENERIC_FAILURE (Generic failure cause)",
            }],
        })

    monkeypatch.setattr(sc, "_transport", httpx.MockTransport(handler))
    res = sc.get_delivery("sms-9")
    assert res.ok is True
    assert res.state == "Failed"
    assert "RESULT_ERROR_GENERIC_FAILURE" in res.error


def test_get_delivery_http_error_maps_to_not_ok(monkeypatch):
    _settings(monkeypatch)

    def handler(request):
        return httpx.Response(404, text="not found")

    monkeypatch.setattr(sc, "_transport", httpx.MockTransport(handler))
    res = sc.get_delivery("missing")
    assert res.ok is False
    assert res.state is None
    assert "404" in res.error


def test_get_delivery_retries_once_then_fails(monkeypatch):
    _settings(monkeypatch)
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(sc, "_transport", httpx.MockTransport(handler))
    res = sc.get_delivery("sms-9")
    assert res.ok is False
    assert calls["n"] == 2  # initial + one retry
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_client.py -k get_delivery -v`
Expected: FAIL — `AttributeError: module 'app.services.sms_client' has no attribute 'get_delivery'`.

- [ ] **Step 3: Implement `_base_url`, `DeliveryResult`, `get_delivery` and refactor `send`**

In `backend/app/services/sms_client.py`, add a `_get` transport helper next to `_post`, a `_base_url` helper, and the new dataclass + function. Also point `send`'s URL derivation at `_base_url()` (DRY — existing `send` tests still cover it):

```python
@dataclass(frozen=True)
class DeliveryResult:
    ok: bool
    state: str | None = None
    error: str | None = None


def _base_url() -> str:
    """Gateway base, tolerant of a scheme-less base or a trailing slash."""
    base = get_settings().sms_gateway_url.strip().rstrip("/")
    if base and "://" not in base:
        base = "http://" + base
    return base


def _get(url: str, auth: tuple[str, str], headers: dict) -> httpx.Response:
    with httpx.Client(transport=_transport, timeout=_TIMEOUT) as client:
        return client.get(url, auth=auth, headers=headers)


def get_delivery(message_id: str) -> DeliveryResult:
    """Read the gateway's delivery outcome for one message. We always send to a
    single recipient, so ``recipients[0]`` is the authoritative outcome."""
    cfg = get_settings()
    url = f"{_base_url()}/message/{message_id}"
    auth = (cfg.sms_username, cfg.sms_password)
    headers = {"Accept": "application/json"}

    last_err: str | None = None
    for attempt in range(2):  # initial + one retry on transport error
        try:
            resp = _get(url, auth, headers)
        except httpx.HTTPError as e:
            last_err = str(e) or e.__class__.__name__
            log.warning("sms: delivery transport error (attempt %d): %s", attempt + 1, last_err)
            continue
        if resp.status_code // 100 == 2:
            try:
                data = resp.json()
            except ValueError:
                data = {}
            recips = data.get("recipients") or []
            if recips:
                r0 = recips[0]
                return DeliveryResult(ok=True, state=r0.get("state"), error=r0.get("error"))
            return DeliveryResult(ok=True, state=data.get("state"))
        return DeliveryResult(ok=False, error=f"HTTP {resp.status_code}: {resp.text}")
    return DeliveryResult(ok=False, error=last_err or "network error")
```

Then update `send` — replace its inline base-URL block:

```python
    url = f"{_base_url()}/message"
```

(Delete the three lines that computed `base` inline in `send`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_client.py -v`
Expected: PASS (new `get_delivery` tests **and** all pre-existing `send` tests).

- [ ] **Step 5: Lint + typecheck**

Run: `venv\Scripts\ruff.exe check backend/app/services/sms_client.py && venv\Scripts\mypy.exe`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/sms_client.py backend/tests/test_sms_client.py
git commit -m "feat(sms): add gateway delivery-status read (get_delivery)"
```

---

## Phase 2 — Model + migration: delivery columns

### Task 2: Add `delivery_state` + `delivery_checked_at` to `SmsMessage`

**Files:**
- Modify: `backend/app/db/models.py` (`SmsMessage`, after the `body` column ~line 429)
- Create: `backend/app/db/migrations/versions/0049_sms_delivery_state.py`
- Test: `backend/tests/test_sms_model.py`

**Interfaces:**
- Produces: `SmsMessage.delivery_state: str | None`, `SmsMessage.delivery_checked_at: datetime | None`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_sms_model.py`:

```python
def test_sms_message_has_delivery_columns(db_session):
    from app.db.models import SmsMessage

    row = SmsMessage(
        employee_id="G0001",
        event_type="leave_requested",
        event_ref="leave_requested:1",
        language="ar",
        phone="+971501234567",
        status="sent",
        provider_msg_id="sms-9",
    )
    # Defaults: nullable, unset until first polled.
    assert row.delivery_state is None
    assert row.delivery_checked_at is None
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    row.delivery_state = "Failed"
    db_session.commit()
    db_session.refresh(row)
    assert row.delivery_state == "Failed"
```

> If `test_sms_model.py` uses a different session fixture name, match the file's existing convention (check the top of the file).

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_model.py::test_sms_message_has_delivery_columns -v`
Expected: FAIL — `AttributeError: 'SmsMessage' object has no attribute 'delivery_state'`.

- [ ] **Step 3: Add the columns to the model**

In `backend/app/db/models.py`, inside `class SmsMessage`, right after the `body` column:

```python
    # Gateway delivery outcome (added 0049). NULL until first polled.
    # Recipient state: Delivered | Failed | Pending | Processed | Sent.
    # Distinct from ``status`` (send-time accept/fail) — see the delivery poller.
    delivery_state: Mapped[str | None] = mapped_column(String(16), nullable=True)
    delivery_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

- [ ] **Step 4: Create the migration**

Create `backend/app/db/migrations/versions/0049_sms_delivery_state.py`:

```python
"""add delivery_state + delivery_checked_at to sms_messages

Revision ID: 0049_sms_delivery_state
Revises: 0048_merge_sms_scaninbox
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0049_sms_delivery_state"
down_revision: str | Sequence[str] | None = "0048_merge_sms_scaninbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("sms_messages") as batch:
        batch.add_column(sa.Column("delivery_state", sa.String(length=16), nullable=True))
        batch.add_column(sa.Column("delivery_checked_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sms_messages") as batch:
        batch.drop_column("delivery_checked_at")
        batch.drop_column("delivery_state")
```

- [ ] **Step 5: Apply the migration and confirm a single head**

Run: `venv\Scripts\alembic.exe upgrade head && venv\Scripts\alembic.exe heads`
Expected: upgrade runs clean; `heads` prints exactly one head — `0049_sms_delivery_state`.

- [ ] **Step 6: Run tests + typecheck**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_model.py -v && venv\Scripts\mypy.exe`
Expected: PASS, clean.

- [ ] **Step 7: Review the migration**

Dispatch the `alembic-migration-reviewer` agent on `backend/app/db/migrations/versions/0049_sms_delivery_state.py`. Address any finding.

- [ ] **Step 8: Commit**

```bash
git add backend/app/db/models.py backend/app/db/migrations/versions/0049_sms_delivery_state.py backend/tests/test_sms_model.py
git commit -m "feat(sms): add delivery_state + delivery_checked_at columns (0049)"
```

---

## Phase 3 — Service: bounded poll + single-row refresh

### Task 3: `poll_pending_deliveries` (bounded batch)

**Files:**
- Modify: `backend/app/services/sms_service.py`
- Test: `backend/tests/test_sms_service.py`

**Interfaces:**
- Consumes: `sms_client.get_delivery(message_id) -> DeliveryResult` (Task 1); `get_settings().sms_enabled`.
- Produces: `poll_pending_deliveries(db: Session, *, now: datetime | None = None) -> int` (count of rows reaching a terminal state this pass); module constants `_TERMINAL_DELIVERY_STATES = {"Delivered", "Failed"}`, `_DELIVERY_POLL_WINDOW_HOURS = 24`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_sms_service.py` (reuse the file's existing session fixture + `SmsMessage` factory conventions; the snippet below assumes a `db`/`db_session` session and env with `sms_enabled`):

```python
def test_poll_updates_state_and_error_for_failed(db_session, monkeypatch, enable_sms):
    from app.db.models import SmsMessage
    from app.services import sms_client, sms_service

    row = SmsMessage(
        employee_id="G0001", event_type="leave_requested",
        event_ref="leave_requested:1", language="ar", phone="+971501234567",
        status="sent", provider_msg_id="sms-fail",
    )
    db_session.add(row)
    db_session.commit()

    def fake_get_delivery(mid):
        assert mid == "sms-fail"
        return sms_client.DeliveryResult(ok=True, state="Failed", error="RESULT_ERROR_GENERIC_FAILURE")

    monkeypatch.setattr(sms_client, "get_delivery", fake_get_delivery)
    n = sms_service.poll_pending_deliveries(db_session)
    db_session.refresh(row)
    assert n == 1
    assert row.delivery_state == "Failed"
    assert "GENERIC_FAILURE" in row.error
    assert row.delivery_checked_at is not None


def test_poll_skips_terminal_and_missing_id_and_old_rows(db_session, monkeypatch, enable_sms):
    from datetime import UTC, datetime, timedelta
    from app.db.models import SmsMessage
    from app.services import sms_client, sms_service

    def mk(**kw):
        r = SmsMessage(
            employee_id="G0001", event_type="leave_requested",
            event_ref="leave_requested:1", language="ar", phone="+971501234567",
            status="sent",
        )
        for k, v in kw.items():
            setattr(r, k, v)
        db_session.add(r)
        return r

    old = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=48)
    mk(provider_msg_id="terminal", delivery_state="Delivered")   # already terminal
    mk(provider_msg_id=None)                                     # never accepted, no id
    mk(provider_msg_id="stale", created_at=old)                 # outside 24h window
    db_session.commit()

    called = []
    monkeypatch.setattr(sms_client, "get_delivery",
                        lambda mid: called.append(mid) or sms_client.DeliveryResult(ok=True, state="Delivered"))
    sms_service.poll_pending_deliveries(db_session)
    assert called == []  # none of the three rows are eligible


def test_poll_leaves_row_for_retry_when_gateway_unreachable(db_session, monkeypatch, enable_sms):
    from app.db.models import SmsMessage
    from app.services import sms_client, sms_service

    row = SmsMessage(
        employee_id="G0001", event_type="leave_requested",
        event_ref="leave_requested:1", language="ar", phone="+971501234567",
        status="sent", provider_msg_id="sms-x",
    )
    db_session.add(row)
    db_session.commit()

    monkeypatch.setattr(sms_client, "get_delivery",
                        lambda mid: sms_client.DeliveryResult(ok=False, error="network error"))
    n = sms_service.poll_pending_deliveries(db_session)
    db_session.refresh(row)
    assert n == 0
    assert row.delivery_state is None          # not overwritten
    assert row.delivery_checked_at is not None  # but we recorded the attempt
```

> `enable_sms` here stands for whatever the file already uses to set `sms_enabled=True` (env fixture / monkeypatch on `get_settings`). Match the existing tests in `test_sms_service.py`; do not invent a new fixture if one exists.

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_service.py -k poll -v`
Expected: FAIL — `AttributeError: module 'app.services.sms_service' has no attribute 'poll_pending_deliveries'`.

- [ ] **Step 3: Implement `poll_pending_deliveries`**

At the top of `backend/app/services/sms_service.py`, extend the datetime import and add `or_`:

```python
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import or_, select
```

Then add, near `last_status`:

```python
_TERMINAL_DELIVERY_STATES = {"Delivered", "Failed"}
_DELIVERY_POLL_WINDOW_HOURS = 24


def poll_pending_deliveries(db: Session, *, now: datetime | None = None) -> int:
    """Poll the gateway for the delivery outcome of recent, not-yet-terminal SMS.

    Bounded on purpose: only rows that were accepted by the gateway
    (``provider_msg_id`` present), have not reached a terminal ``delivery_state``,
    and were created within the last 24h. Returns how many rows reached a
    terminal state this pass. No-ops (returns 0) when SMS is disabled.
    """
    if not get_settings().sms_enabled:
        return 0
    now = now or datetime.now(UTC).replace(tzinfo=None)
    cutoff = now - timedelta(hours=_DELIVERY_POLL_WINDOW_HOURS)
    rows = list(
        db.scalars(
            select(SmsMessage).where(
                SmsMessage.provider_msg_id.is_not(None),
                SmsMessage.created_at >= cutoff,
                or_(
                    SmsMessage.delivery_state.is_(None),
                    SmsMessage.delivery_state.not_in(_TERMINAL_DELIVERY_STATES),
                ),
            )
        )
    )
    finalized = 0
    for row in rows:
        result = sms_client.get_delivery(row.provider_msg_id or "")
        row.delivery_checked_at = now
        if not result.ok:
            continue  # gateway unreachable — retry next tick, leave state as-is
        row.delivery_state = result.state
        if result.error:
            row.error = result.error
        if result.state in _TERMINAL_DELIVERY_STATES:
            finalized += 1
    db.commit()
    return finalized
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_service.py -k poll -v`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/sms_service.py backend/tests/test_sms_service.py
git commit -m "feat(sms): bounded delivery poll (poll_pending_deliveries)"
```

### Task 4: `refresh_delivery` (single row, on-demand)

**Files:**
- Modify: `backend/app/services/sms_service.py`
- Test: `backend/tests/test_sms_service.py`

**Interfaces:**
- Produces: `refresh_delivery(db: Session, sms_id: int) -> SmsMessage | None` — returns the (updated) row, or `None` if no such row. If the row has no `provider_msg_id` it is returned unchanged (nothing to poll).

- [ ] **Step 1: Write the failing test**

```python
def test_refresh_delivery_updates_single_row(db_session, monkeypatch, enable_sms):
    from app.db.models import SmsMessage
    from app.services import sms_client, sms_service

    row = SmsMessage(
        employee_id="G0001", event_type="leave_requested",
        event_ref="leave_requested:1", language="ar", phone="+971501234567",
        status="sent", provider_msg_id="sms-r",
    )
    db_session.add(row)
    db_session.commit()

    monkeypatch.setattr(sms_client, "get_delivery",
                        lambda mid: sms_client.DeliveryResult(ok=True, state="Delivered"))
    out = sms_service.refresh_delivery(db_session, row.id)
    assert out is not None and out.delivery_state == "Delivered"
    assert out.delivery_checked_at is not None


def test_refresh_delivery_missing_row_returns_none(db_session, enable_sms):
    from app.services import sms_service
    assert sms_service.refresh_delivery(db_session, 999999) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_service.py -k refresh_delivery -v`
Expected: FAIL — `AttributeError: ... has no attribute 'refresh_delivery'`.

- [ ] **Step 3: Implement `refresh_delivery`**

Add below `poll_pending_deliveries`:

```python
def refresh_delivery(db: Session, sms_id: int) -> SmsMessage | None:
    """On-demand delivery re-check for one message (the manual 're-check now')."""
    row = db.get(SmsMessage, sms_id)
    if row is None:
        return None
    if not row.provider_msg_id:
        return row  # nothing to poll (never accepted by the gateway)
    result = sms_client.get_delivery(row.provider_msg_id)
    row.delivery_checked_at = datetime.now(UTC).replace(tzinfo=None)
    if result.ok:
        row.delivery_state = result.state
        if result.error:
            row.error = result.error
    db.commit()
    db.refresh(row)
    return row
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_service.py -k refresh_delivery -v`
Expected: PASS.

- [ ] **Step 5: Full backend gate + commit**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_service.py -q && venv\Scripts\ruff.exe check . && venv\Scripts\mypy.exe`
Expected: PASS, clean.

```bash
git add backend/app/services/sms_service.py backend/tests/test_sms_service.py
git commit -m "feat(sms): on-demand single-row delivery refresh"
```

---

## Phase 4 — Scheduler: register the poller

### Task 5: `_run_sms_delivery_poll` on a 5-minute interval

**Files:**
- Modify: `backend/app/services/scheduler_service.py`
- Test: `backend/tests/test_scheduler_sms_delivery.py` (create)

**Interfaces:**
- Consumes: `sms_service.poll_pending_deliveries(session) -> int`.
- Produces: `_run_sms_delivery_poll() -> None`; constants `_SMS_DELIVERY_POLL_JOB_ID = "sms-delivery-poll"`, `_SMS_DELIVERY_POLL_INTERVAL_MINUTES = 5`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_scheduler_sms_delivery.py`:

```python
def test_run_sms_delivery_poll_invokes_service(monkeypatch):
    from app.services import scheduler_service, sms_service

    calls = {"n": 0}
    monkeypatch.setattr(
        sms_service, "poll_pending_deliveries",
        lambda session: (calls.__setitem__("n", calls["n"] + 1), 0)[1],
    )
    scheduler_service._run_sms_delivery_poll()  # opens its own SessionLocal
    assert calls["n"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scheduler_sms_delivery.py -v`
Expected: FAIL — `AttributeError: ... has no attribute '_run_sms_delivery_poll'`.

- [ ] **Step 3: Add the job body + constants + import**

In `backend/app/services/scheduler_service.py`, add `sms_service` to the services import line, add the constants beside the other job ids, and add the job body next to `_run_grant_sweep`:

```python
_SMS_DELIVERY_POLL_JOB_ID = "sms-delivery-poll"
_SMS_DELIVERY_POLL_INTERVAL_MINUTES = 5
```

```python
def _run_sms_delivery_poll() -> None:
    with SessionLocal() as session:
        try:
            n = sms_service.poll_pending_deliveries(session)
            if n:
                log.info("scheduler: %d SMS reached a terminal delivery state", n)
        except Exception:
            log.exception("scheduler: SMS delivery poll failed")
```

- [ ] **Step 4: Register the job in `start()`**

Inside `start()`, in the `if _scheduler is not None and _scheduler.running:` block (alongside the grant-sweep `add_job`):

```python
            _scheduler.add_job(
                _run_sms_delivery_poll,
                trigger=IntervalTrigger(minutes=_SMS_DELIVERY_POLL_INTERVAL_MINUTES),
                id=_SMS_DELIVERY_POLL_JOB_ID,
                replace_existing=True,
            )
            log.info(
                "scheduler: SMS delivery poll every %d min",
                _SMS_DELIVERY_POLL_INTERVAL_MINUTES,
            )
```

Also add `"_run_sms_delivery_poll"` to `__all__`.

- [ ] **Step 5: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scheduler_sms_delivery.py -v && venv\Scripts\mypy.exe`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/scheduler_service.py backend/tests/test_scheduler_sms_delivery.py
git commit -m "feat(sms): poll delivery status every 5 min in the scheduler"
```

---

## Phase 5 — API + schema + type resync

### Task 6: Expose `delivery_state` and add the refresh endpoint

**Files:**
- Modify: `backend/app/schemas/sms.py`
- Modify: `backend/app/api/v1/sms.py`
- Test: `backend/tests/test_sms_api.py`
- Regenerate: `backend/openapi.json`, `frontend/src/lib/api.types.ts`

**Interfaces:**
- Consumes: `sms_service.refresh_delivery(db, sms_id)` (Task 4).
- Produces: `SmsMessageRead.delivery_state: str | None`, `SmsMessageRead.delivery_checked_at: datetime | None`, `SmsStatusItem.delivery_state: str | None`; route `POST /sms/{sms_id}/refresh-delivery` → `SmsMessageRead`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_sms_api.py` (follow the file's existing auth/client fixtures; the snippet assumes a `client` with `employees.notify` and a helper to seed an `SmsMessage`):

```python
def test_refresh_delivery_endpoint_returns_updated_row(client, seed_sms, monkeypatch):
    from app.services import sms_client
    row = seed_sms(provider_msg_id="sms-api", status="sent")
    monkeypatch.setattr(sms_client, "get_delivery",
                        lambda mid: sms_client.DeliveryResult(ok=True, state="Delivered"))

    resp = client.post(f"/api/v1/sms/{row.id}/refresh-delivery")
    assert resp.status_code == 200
    body = resp.json()
    assert body["delivery_state"] == "Delivered"
    assert "delivery_checked_at" in body


def test_refresh_delivery_endpoint_404_for_missing(client):
    resp = client.post("/api/v1/sms/999999/refresh-delivery")
    assert resp.status_code == 404


def test_refresh_delivery_endpoint_requires_books_manage(client_without_books_manage, seed_sms):
    row = seed_sms(provider_msg_id="sms-x", status="sent")
    resp = client_without_books_manage.post(f"/api/v1/sms/{row.id}/refresh-delivery")
    assert resp.status_code == 403
```

> Match the real route prefix (`/api/v1` vs `/api`) and fixtures used by the other tests in `test_sms_api.py`. The success test's `client` must hold **`books.manage`** (the endpoint's gate — NOT `employees.notify`); `client_without_books_manage` is a client lacking it. Build both from the file's existing capability-fixture pattern (look at how other capability-gated tests construct users/tokens).

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_api.py -k refresh_delivery -v`
Expected: FAIL — 404/405 (route not defined) and missing `delivery_state` in the response.

- [ ] **Step 3: Add the schema fields**

In `backend/app/schemas/sms.py`, extend `SmsMessageRead`:

```python
    created_at: datetime
    delivery_state: str | None = None
    delivery_checked_at: datetime | None = None
```

And extend `SmsStatusItem` (so the record-surface button becomes delivery-aware in Task 9):

```python
    status: str
    delivery_state: str | None = None
    error: str | None
    created_at: datetime
```

- [ ] **Step 4: Add the endpoint**

In `backend/app/api/v1/sms.py`, import `SmsMessageRead` and add:

```python
@router.post("/{sms_id}/refresh-delivery", response_model=SmsMessageRead)
def refresh_delivery(
    sms_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> SmsMessage:
    row = sms_service.refresh_delivery(db, sms_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SMS not found")
    return row
```

> Gate is `books.manage` (same as document creation), per Global Constraints — NOT `employees.notify`. The test's client must therefore hold `books.manage`; add a test asserting a `books.manage`-less user gets 403.

Add the imports it needs: `from app.schemas.sms import SmsMessageRead` and `from app.db.models import SmsMessage, User` (extend the existing `User` import).

- [ ] **Step 5: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_api.py -k refresh_delivery -v`
Expected: PASS.

- [ ] **Step 6: Resync generated types**

Invoke the `/sync-api-types` skill (dumps `backend/openapi.json`, runs `pnpm -C frontend gen:api`, typechecks).
Then verify: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_api.py -q && pnpm -C frontend exec tsc -b --noEmit`
Expected: PASS; `frontend/src/lib/api.types.ts` now carries `delivery_state` / `delivery_checked_at` on the SMS read type.

- [ ] **Step 7: Commit (schema + endpoint + regenerated types together)**

```bash
git add backend/app/schemas/sms.py backend/app/api/v1/sms.py backend/tests/test_sms_api.py backend/openapi.json frontend/src/lib/api.types.ts
git commit -m "feat(sms): expose delivery_state + POST /sms/{id}/refresh-delivery; resync types"
```

---

## Phase 6 — Frontend: delivery badge, re-check, delivery-aware resend

### Task 7: Shared `smsDeliveryTone` helper

**Files:**
- Create: `frontend/src/lib/smsDelivery.ts`
- Test: `frontend/src/lib/smsDelivery.test.ts` (create)

**Interfaces:**
- Produces: `type SmsDeliveryTone = 'delivered' | 'failed' | 'pending'`; `smsDeliveryTone(m: { status: string; delivery_state?: string | null }): SmsDeliveryTone`.

Semantics: `Delivered` → `delivered`; `Failed` **or** send-time `status==='failed'` → `failed`; otherwise (accepted, awaiting confirmation, or `Pending`/`Processed`/`Sent`) → `pending`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/smsDelivery.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { smsDeliveryTone } from './smsDelivery'

describe('smsDeliveryTone', () => {
  it('delivered when gateway confirms delivery', () => {
    expect(smsDeliveryTone({ status: 'sent', delivery_state: 'Delivered' })).toBe('delivered')
  })
  it('failed when SIM reported a failure even though send was accepted', () => {
    expect(smsDeliveryTone({ status: 'sent', delivery_state: 'Failed' })).toBe('failed')
  })
  it('failed when the gateway never accepted the send', () => {
    expect(smsDeliveryTone({ status: 'failed', delivery_state: null })).toBe('failed')
  })
  it('pending when accepted but not yet confirmed', () => {
    expect(smsDeliveryTone({ status: 'sent', delivery_state: null })).toBe('pending')
    expect(smsDeliveryTone({ status: 'sent', delivery_state: 'Sent' })).toBe('pending')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/lib/smsDelivery.test.ts`
Expected: FAIL — cannot resolve `./smsDelivery`.

- [ ] **Step 3: Implement the helper**

Create `frontend/src/lib/smsDelivery.ts`:

```ts
export type SmsDeliveryTone = 'delivered' | 'failed' | 'pending'

/** Collapse (send-time status, gateway delivery_state) into one badge tone.
 *  A send can be accepted (status='sent') yet fail at the SIM
 *  (delivery_state='Failed') — that must read as failed, not done. */
export function smsDeliveryTone(
  m: { status: string; delivery_state?: string | null },
): SmsDeliveryTone {
  if (m.delivery_state === 'Delivered') return 'delivered'
  if (m.delivery_state === 'Failed' || m.status === 'failed') return 'failed'
  return 'pending'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/lib/smsDelivery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/smsDelivery.ts frontend/src/lib/smsDelivery.test.ts
git commit -m "feat(sms): shared smsDeliveryTone helper"
```

### Task 8: Delivery badge + re-check in MessagesTab and BookRecordPage

**Files:**
- Modify: `frontend/src/pages/employees/tabs/MessagesTab.tsx`
- Modify: `frontend/src/pages/books/BookRecordPage.tsx` (`NotificationBlock`)
- Modify: `frontend/src/lib/api.ts` (add `refreshSmsDelivery`)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/components/sms/MessagesTab.test.tsx`

**Interfaces:**
- Consumes: `smsDeliveryTone` (Task 7); the generated `SmsMessageRead` (now with `delivery_state`).
- Produces: `refreshSmsDelivery(smsId: number): Promise<SmsMessageRead>` in `api.ts`.

- [ ] **Step 1: Add locale keys**

`frontend/src/locales/en.json` under `employee.messages`:

```json
"delivered": "Delivered",
"pending": "Sent · awaiting confirmation",
"recheck": "Re-check",
"rechecking": "Checking…"
```

`frontend/src/locales/ar.json` under `employee.messages` (DRAFT — the `notification-template-reviewer` must confirm wording in Step 6):

```json
"delivered": "تم التسليم",
"pending": "أُرسل · بانتظار التأكيد",
"recheck": "إعادة الفحص",
"rechecking": "جارٍ الفحص…"
```

> `employee.messages.sent` and `employee.messages.failed` already exist — reuse them for the `pending` fallback label text `sent` is replaced by the richer `pending` copy above; keep `failed` as-is.

- [ ] **Step 2: Add the API wrapper**

In `frontend/src/lib/api.ts`, next to `sendSms`/`getSmsStatus`:

```ts
export async function refreshSmsDelivery(smsId: number): Promise<SmsMessageRead> {
  return apiPost(`/sms/${smsId}/refresh-delivery`)
}
```

> Match the file's actual HTTP helper (`apiPost`/`http.post`/generated client) and the `SmsMessageRead` import already present.

- [ ] **Step 3: Write the failing test**

Extend `frontend/src/components/sms/MessagesTab.test.tsx` with the three tones:

```tsx
it('shows a Delivered badge when the gateway confirms delivery', () => {
  render(<MessagesTab messages={[{ id: 1, event_type: 'leave_requested', body: 'x',
    phone: '+971', status: 'sent', delivery_state: 'Delivered', error: null,
    language: 'en', created_at: new Date().toISOString() } as any]} />)
  expect(screen.getByText('Delivered')).toBeInTheDocument()
})

it('shows a Failed badge when status=sent but delivery_state=Failed', () => {
  render(<MessagesTab messages={[{ id: 2, event_type: 'leave_requested', body: 'x',
    phone: '+971', status: 'sent', delivery_state: 'Failed',
    error: 'RESULT_ERROR_GENERIC_FAILURE', language: 'en',
    created_at: new Date().toISOString() } as any]} />)
  expect(screen.getByText(/Failed/)).toBeInTheDocument()
  expect(screen.getByText(/GENERIC_FAILURE/)).toBeInTheDocument()
})

it('shows an awaiting-confirmation badge when accepted but unconfirmed', () => {
  render(<MessagesTab messages={[{ id: 3, event_type: 'leave_requested', body: 'x',
    phone: '+971', status: 'sent', delivery_state: null, error: null,
    language: 'en', created_at: new Date().toISOString() } as any]} />)
  expect(screen.getByText(/awaiting confirmation/i)).toBeInTheDocument()
})
```

Run: `pnpm -C frontend exec vitest run src/components/sms/MessagesTab.test.tsx`
Expected: FAIL (badge logic still keys off `status` only).

- [ ] **Step 4: Update the badge rendering in MessagesTab**

Replace the per-row `const ok = m.status === 'sent'` block with tone-driven rendering:

```tsx
import { Check, AlertTriangle, Clock } from 'lucide-react'
import { smsDeliveryTone } from '@/lib/smsDelivery'
import { refreshSmsDelivery } from '@/lib/api'
// ...
const tone = smsDeliveryTone(m)
const badge = {
  delivered: { cls: 'bg-success-soft text-success', icon: <Check className="h-3 w-3" />, label: t('employee.messages.delivered') },
  failed:    { cls: 'bg-destructive/10 text-destructive', icon: <AlertTriangle className="h-3 w-3" />, label: t('employee.messages.failed') },
  pending:   { cls: 'bg-warning/10 text-warning', icon: <Clock className="h-3 w-3" />, label: t('employee.messages.pending') },
}[tone]
// badge span uses {badge.cls}, {badge.icon}, {badge.label}
// error line condition changes from `!ok && m.error` to `tone === 'failed' && m.error`
```

For `pending` rows only, render a small "Re-check" button — **gated on the `books.manage` capability** (`useCapabilities().has('books.manage')`, matching the endpoint gate; do NOT show it to users who only have `employees.notify`). It calls `refreshSmsDelivery(m.id)` and, on resolve, updates that row (via the parent's React Query cache invalidation or a local optimistic state — follow how MessagesTab currently receives `messages`; if it is a pure prop list, lift the re-check to invalidate the employee-detail query that produced it).

> Keep logical CSS (`ms-`/`me-`, `text-start`) — no hard left/right. `dir="ltr"` stays on the raw gateway error string (Latin technical text).

- [ ] **Step 5: Apply the same tone rendering to `NotificationBlock` in BookRecordPage.tsx**

Mirror Step 4 in `BookRecordPage.tsx` (~line 849) — same `smsDeliveryTone` + badge map + `tone === 'failed' && m.error` condition. (Re-check button optional here; the badge is the priority.)

- [ ] **Step 6: Run tests + i18n review**

Run: `pnpm -C frontend exec vitest run src/components/sms && pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint`
Expected: PASS, clean.
Then dispatch the `i18n-rtl-reviewer` and `notification-template-reviewer` agents on the changed locale + TSX files. Apply fixes.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/employees/tabs/MessagesTab.tsx frontend/src/pages/books/BookRecordPage.tsx frontend/src/lib/api.ts frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/components/sms/MessagesTab.test.tsx
git commit -m "feat(sms): delivery badge (delivered/failed/pending) + re-check on SMS surfaces"
```

### Task 9: Make the record-surface Resend button delivery-aware

**Files:**
- Modify: `frontend/src/components/sms/SendSmsButton.tsx`
- Test: `frontend/src/components/sms/SendSmsButton.test.tsx`

**Interfaces:**
- Consumes: `SmsStatus` (generated from `SmsStatusItem`, now with `delivery_state`).

Problem being fixed: today `alreadySent = last?.status === 'sent'`, so a send that was accepted but **Failed at the SIM** shows a done ✓ and hides resend. After this task, `delivery_state === 'Failed'` counts as *not delivered* → the button invites a resend and shows a warning.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/components/sms/SendSmsButton.test.tsx` (match its existing mock of `getSmsStatus`):

```tsx
it('offers resend when the last send was accepted but failed delivery', async () => {
  // getSmsStatus resolves enabled:true, last:{ status:'sent', delivery_state:'Failed', ... }
  render(<SendSmsButton eventType="leave_requested" recordId={1} />)
  expect(await screen.findByText(/resend/i)).toBeInTheDocument()
})
```

Run: `pnpm -C frontend exec vitest run src/components/sms/SendSmsButton.test.tsx`
Expected: FAIL — the button shows the done ✓ / non-resend label.

- [ ] **Step 2: Update the delivered check**

In `SendSmsButton.tsx`:

```tsx
const delivered = last?.status === 'sent' && last?.delivery_state !== 'Failed'
const alreadySent = delivered
```

Replace the two uses of the old `alreadySent`/`last?.status === 'sent'` accordingly, and in the optimistic `setLast(...)` after a resend, include `delivery_state: null` so the row returns to a pending (awaiting-confirmation) state rather than re-locking as done.

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/components/sms/SendSmsButton.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/sms/SendSmsButton.tsx frontend/src/components/sms/SendSmsButton.test.tsx
git commit -m "feat(sms): treat SIM-failed sends as not-delivered so resend is offered"
```

---

## Phase 7 — Verify + ship

### Task 10: Full gate, review, deploy

- [ ] **Step 1: Backend gate**

Run: `venv\Scripts\python.exe -m pytest && venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check . && venv\Scripts\mypy.exe`
Expected: all PASS, clean.

- [ ] **Step 2: Frontend gate**

Run: `pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint && pnpm -C frontend test`
Expected: all PASS.

- [ ] **Step 3: Bilingual review**

Confirm the `i18n-rtl-reviewer` and `notification-template-reviewer` findings from Task 8 are resolved (re-run if strings changed since).

- [ ] **Step 4: Requesting code review**

Use `superpowers:requesting-code-review` on the full branch diff before merge.

- [ ] **Step 5: Merge, push, deploy**

Merge the branch to `main`, then:

```bash
git push origin main
```

Then `scripts\mng.ps1 deploy` (build + restart; needs UAC on the console — be on **Tailscale**). Confirm with `scripts\mng.ps1 status` (version bumped, health OK). The poller starts on the next scheduler boot; watch `scripts\mng.ps1 logs` for `scheduler: SMS delivery poll every 5 min`.

> **Live verification:** with SMS provisioned, send a test SMS, then within ~5 min confirm the badge flips to Delivered (or Failed with the SIM error) in the employee Messages tab. Use the **Re-check** button to force it immediately rather than waiting for the tick.

---

## Operational cleanup (not a code task — do on the live DB)

Loose end from the originating session: test record **book 448 / leave 791** (Annual Leave, Aug 10–14, G3082) was generated to test delivery and its SMS **failed** at the SIM. It is a throwaway — soft-delete it:

- `book_service.delete_book(448)` + `leave_service.soft_delete_leave(791)`.
- Leave 791 has fresh dates, so it is NOT deduped/shared → safe to delete. (A same-dates leave dedups into an existing Leave row; only delete leave_ids whose sole owning book is a test book.)

Do this as a one-off from a venv Python shell on the server, not as part of the feature commits.

---

## Self-Review (author checklist — completed)

**Spec coverage vs the handoff's "Recommended design" (5 items):**
1. Model — 2 nullable columns → Task 2. ✅
2. Client `get_delivery` → Task 1. ✅
3. Poller (bounded, 24h, terminal-stop, 5-min) → Tasks 3 (logic) + 5 (scheduler). ✅
4. API/schema `delivery_state` + optional refresh endpoint → Task 6. ✅
5. Frontend badge (Delivered/Failed/Pending) + failed styling + error detail + Resend, bilingual → Tasks 7–9. ✅

**Open questions (all resolved per handoff + user):** polling (not webhook) ✅; new column vs extending `status` → new column ✅; 24h window ✅; no auto-resend ✅. User additionally opted **in** to the manual re-check endpoint (Task 6, gated by `books.manage` per user instruction — same as document creation) and delivery-aware resend (Task 9).

**Type consistency:** `DeliveryResult(ok/state/error)` defined in Task 1 and consumed identically in Tasks 3/4/6 tests. `smsDeliveryTone` signature (`{status, delivery_state}`) consistent across Tasks 7/8. `refreshSmsDelivery` name consistent (api.ts ↔ MessagesTab). `delivery_state` column/schema/type name consistent end-to-end.

**Placeholder scan:** no TBD/"handle edge cases"/"similar to Task N" — every code step shows the code. Fixture names (`enable_sms`, `seed_sms`, session fixture, `apiPost`) are flagged with a "match the file's existing convention" note because they depend on each test file's current setup, which the implementer must read; the *behavior* to test is fully specified.
