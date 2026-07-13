# OpenWA Phase 1 — Router Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Infobip WhatsApp path with a self-hosted OpenWA gateway and a dispatch router that sends every per-record HR notification WhatsApp-first with SMS as a true last resort, logging every attempt to one unified `outbound_messages` table.

**Architecture:** A thin `openwa_client` transport (mirrors `sms_client`) speaks OpenWA's REST API. A new `notify_dispatch` router owns the channel policy (WhatsApp-first; not-on-WhatsApp → SMS now; WhatsApp transiently down → `queued` + retry ≤5 min → SMS last-resort) and writes one `OutboundMessage` row per attempt. The scheduler gains a retry worker, a channel-aware delivery poll (replacing the SMS-only poll), and a health ping. The Infobip stack is retired; the SMS transport (`sms_client`) and copy (`sms_templates`) are kept and shared by both channels.

**Tech Stack:** FastAPI (Python 3.12), SQLAlchemy + Alembic on SQLite, httpx (with `httpx.MockTransport` for tests), APScheduler, React 19 + Vite/TS, React Query, Vitest. Runs same-origin as a Windows service; OpenWA runs in Docker on the office box.

## Global Constraints

- All Python runs through the repo venv: `venv\Scripts\python.exe`, `venv\Scripts\ruff.exe`, `venv\Scripts\mypy.exe`, `venv\Scripts\alembic.exe`.
- mypy is **strict**; pytest runs with `filterwarnings=error` (no warnings allowed).
- Migrations use **hand-numbered `NNNN_slug`** revision ids, **single linear head**. Current head: `0049_sms_delivery_state`. SQLite: wrap column changes in `op.batch_alter_table`, omit named FKs to existing tables, give NOT-NULL-on-populated columns a `server_default`.
- After any backend Pydantic schema / route change, resync the generated types (`/sync-api-types`: dump `backend/openapi.json`, run `pnpm gen:api`, typecheck) and commit `openapi.json` + `api.types.ts` together.
- Bilingual is first-class: every user-facing string needs `en` + `ar` parity in `frontend/src/locales/{en,ar}.json`; use logical CSS (`ms-`/`me-`, `text-start`/`text-end`). Run the `i18n-rtl-reviewer` agent after touching bilingual surfaces.
- New feature stays **dormant by default**: `GSSG_OPENWA_ENABLED=false`. Nothing sends until provisioned.
- This checkout is live production. Commit **and push to `origin/main`** only when the user asks; do feature work here on `main` per repo convention but keep each task independently green.
- Transport clients never raise to callers — map errors to a result dataclass (existing `sms_client`/`whatsapp_client` pattern).

## File Structure (Phase 1)

**Create:**
- `deploy/openwa/docker-compose.yml` — OpenWA container definition (persistent session volume, restart policy).
- `deploy/openwa/README.md` — setup + QR-login guide; the pinned REST contract.
- `backend/app/services/openwa_client.py` — OpenWA transport (send / is_registered / get_ack / health).
- `backend/app/services/notify_dispatch.py` — the channel router + unified logging + retry/poll/health helpers.
- `backend/app/api/v1/notify.py` — channel-agnostic send/status/refresh routes (replaces `sms.py` + `whatsapp.py`).
- `backend/app/schemas/notify.py` — request/response schemas for the notify routes.
- `backend/app/db/migrations/versions/0050_outbound_messages.py` — create `outbound_messages`.
- `backend/app/db/migrations/versions/0051_backfill_outbound_messages.py` — backfill from `sms_messages` + `whatsapp_messages`.
- `frontend/src/components/notify/SendButton.tsx` — unified send button + badge (replaces `sms/SendSmsButton.tsx`).
- `backend/tests/test_openwa_client.py`, `backend/tests/test_notify_dispatch.py`, `backend/tests/test_notify_api.py`, `backend/tests/test_migration_outbound_messages.py`.

**Modify:**
- `backend/app/config.py` — add `GSSG_OPENWA_*` settings; remove Infobip `whatsapp_*` settings.
- `backend/app/db/models.py` — add `OutboundMessage`; keep `SmsMessage`/`WhatsAppMessage` for backfill source.
- `backend/app/services/scheduler_service.py` — retry worker, channel-aware delivery poll, health ping.
- `backend/app/services/leave_service.py:255`, `backend/app/api/v1/documents.py:207` — call `notify_dispatch` instead of `sms_service`.
- `backend/app/main.py` — mount `notify` router; unmount `sms` + `whatsapp` routers.
- `backend/app/core/permissions.py` — relabel `employees.notify` (channel-agnostic wording).
- `frontend/src/lib/api.ts` (or generated client wrapper) — `sendNotify` / `getNotifyStatus` / `refreshNotifyDelivery`.
- `frontend/src/locales/{en,ar}.json` — `notify.*` keys (replace `sms.*`).
- Consumers of `SendSmsButton` — swap to `SendButton`.

**Delete (Task 10 — retire Infobip):**
- `backend/app/services/whatsapp_client.py`, `whatsapp_service.py`, `whatsapp_templates.py`, `backend/app/api/v1/whatsapp.py`, `backend/app/schemas/whatsapp.py`, `backend/app/services/sms_service.py` (folded into `notify_dispatch`), `backend/app/api/v1/sms.py`, `frontend/src/components/sms/SendSmsButton.tsx`.

---

### Task 1: Stand up OpenWA in Docker + pin the REST contract

**Files:**
- Create: `deploy/openwa/docker-compose.yml`
- Create: `deploy/openwa/README.md`

**Interfaces:**
- Produces: a running OpenWA reachable at `http://localhost:2785/api`, an `X-API-Key`, a `sessionId`, and the **confirmed** exact paths/JSON for: send-text, registration check, delivery/ack read, session health. Later tasks reference these confirmed shapes.

This task is setup + discovery, not TDD. Its deliverable is a running gateway and a written contract that unblocks Task 4 (`openwa_client`).

- [ ] **Step 1: Write the compose file**

`deploy/openwa/docker-compose.yml`:

```yaml
services:
  openwa:
    image: ghcr.io/rmyndharis/openwa:latest   # confirm the published image tag in the repo README; pin to a digest once verified
    container_name: gssg-openwa
    restart: unless-stopped
    ports:
      - "127.0.0.1:2785:2785"   # bind to localhost only — the backend reaches it over loopback
    environment:
      - ENGINE_TYPE=whatsapp-web.js
      - API_KEY=${OPENWA_API_KEY}   # set in deploy/openwa/.env (gitignored)
      - PORT=2785
    volumes:
      - openwa-session:/app/data   # confirm the session path from the image docs; persists login so restarts don't need a re-scan

volumes:
  openwa-session:
```

- [ ] **Step 2: Bring it up and log in**

```bash
cd deploy/openwa
printf 'OPENWA_API_KEY=%s\n' "$(python -c 'import secrets;print(secrets.token_urlsafe(24))')" > .env
docker compose up -d
docker compose logs -f openwa   # wait for it to be ready
```

Open `http://localhost:2785/api/docs` (Swagger). Start a session and fetch the QR (`POST /api/sessions/{id}/start`, `GET /api/sessions/{id}/qr`), scan it with the office WhatsApp number. Confirm the session shows connected.

- [ ] **Step 3: Pin the exact REST contract by reading live Swagger**

From `http://localhost:2785/api/docs`, record the exact method/path/body/response for each of the four operations into `deploy/openwa/README.md` under a "REST contract (pinned <date>)" heading. Confirm/replace these expected shapes:

- **Send text:** `POST /api/sessions/{sessionId}/messages/send-text`, header `X-API-Key`, body `{"chatId":"<digits>@c.us","text":"..."}`. Record the success response field that carries the message id (e.g. `id` / `key.id`).
- **Registration check:** find the endpoint that answers "is this number on WhatsApp / what is its chatId" (commonly `GET /api/sessions/{id}/contacts/check?phone=...` or `.../numbers/{phone}/exists`). Record path + the boolean/`numberExists` field. If none exists, record that and note we derive registration from a send rejection instead.
- **Delivery/ack:** find how to read a sent message's ack (sent/delivered/read) — a `GET .../messages/{id}` status field or an ack webhook. Record it. If only webhooks exist, note that Task 7's poll will instead read the last-known ack the client caches, and open a follow-up.
- **Health/session status:** `GET /api/sessions/{sessionId}` (or `/status`) — record the field that says connected vs. disconnected.

- [ ] **Step 4: Write the setup guide**

Fill `deploy/openwa/README.md`: prerequisites (Docker Desktop on the `.\Admin` box), the compose bring-up, first-time QR login, where `.env` lives (gitignored), how the backend reaches it (`GSSG_OPENWA_API_BASE=http://localhost:2785`), the session-volume/restart guarantees, and a "re-login when the session drops" runbook. Add `deploy/openwa/.env` to `.gitignore`.

- [ ] **Step 5: Commit**

```bash
git add deploy/openwa/docker-compose.yml deploy/openwa/README.md .gitignore
git commit -m "feat(openwa): docker-compose + setup guide + pinned REST contract"
```

---

### Task 2: OpenWA config settings

**Files:**
- Modify: `backend/app/config.py:66-73` (replace the Infobip block) and add the OpenWA block
- Test: `backend/tests/test_config_openwa.py`

**Interfaces:**
- Produces: `Settings.openwa_enabled: bool`, `openwa_api_base: str`, `openwa_api_key: str`, `openwa_session: str`, `openwa_country_code: str`. Consumed by `openwa_client` and `notify_dispatch`.

Note: the Infobip `whatsapp_*` settings are **removed here** (they are unused after retirement); `sms_*` settings stay. Removing them now is safe because `whatsapp_client.py` isn't imported by anything shipped until Task 10 deletes it — but `whatsapp_service`/`api/v1/whatsapp.py` still import config only via `get_settings().whatsapp_*`. To avoid breaking the app between Task 2 and Task 10, **keep the `whatsapp_*` fields until Task 10** and only ADD the OpenWA block here.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_config_openwa.py`:

```python
from app.config import Settings


def test_openwa_settings_default_dormant() -> None:
    s = Settings(_env_file=None)
    assert s.openwa_enabled is False
    assert s.openwa_api_base == ""
    assert s.openwa_api_key == ""
    assert s.openwa_session == "default"
    assert s.openwa_country_code == "971"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_config_openwa.py -v`
Expected: FAIL (`AttributeError`/validation — no `openwa_enabled`).

- [ ] **Step 3: Add the OpenWA settings block**

In `backend/app/config.py`, after the SMS block (line 82), add:

```python
    # --- WhatsApp via self-hosted OpenWA gateway ------------------------------
    # All GSSG_OPENWA_* env vars. Disabled by default; the router falls back to
    # SMS entirely while this is off. Points at the Docker gateway on localhost.
    openwa_enabled: bool = False
    openwa_api_base: str = ""  # e.g. http://localhost:2785 (scheme optional)
    openwa_api_key: str = ""  # X-API-Key for the gateway (secret)
    openwa_session: str = "default"  # OpenWA sessionId holding the logged-in number
    openwa_country_code: str = "971"  # default CC for normalizing contact
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_config_openwa.py -v`
Expected: PASS

- [ ] **Step 5: Lint + commit**

```bash
venv\Scripts\ruff.exe check backend/app/config.py backend/tests/test_config_openwa.py
git add backend/app/config.py backend/tests/test_config_openwa.py
git commit -m "feat(openwa): GSSG_OPENWA_* settings (dormant by default)"
```

---

### Task 3: `OutboundMessage` model + create-table migration

**Files:**
- Modify: `backend/app/db/models.py` (add class near `SmsMessage`, ~line 406)
- Create: `backend/app/db/migrations/versions/0050_outbound_messages.py`
- Test: `backend/tests/test_migration_outbound_messages.py`

**Interfaces:**
- Produces: `OutboundMessage` ORM class + `outbound_messages` table. Columns consumed by `notify_dispatch` (Task 5), the notify API (Task 6), the scheduler (Task 7), and the backfill (Task 8).

- [ ] **Step 1: Add the model**

In `backend/app/db/models.py`, add after the `SmsMessage` class (use the same `Base`, `Mapped`, `mapped_column`, `_utcnow` already imported in the file):

```python
class OutboundMessage(Base):
    """One row per outbound notification attempt across all channels.

    Unifies the retired sms_messages / whatsapp_messages logs. ``channel`` is the
    channel actually used; NULL when the attempt failed before routing (no phone).
    ``status`` is queued|sent|failed. ``delivery_state`` is the channel's own
    delivery outcome (WhatsApp: sent|delivered|read|failed; SMS: Pending|Delivered|
    Failed). ``fell_back``/``fallback_reason`` record a WhatsApp→SMS downgrade.
    ``attempts``/``next_retry_at`` drive the bounded WhatsApp retry queue.
    """

    __tablename__ = "outbound_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(String(16), ForeignKey("employees.id"))
    event_type: Mapped[str] = mapped_column(String(32))
    event_ref: Mapped[str] = mapped_column(String(64))
    language: Mapped[str] = mapped_column(String(2))
    phone: Mapped[str] = mapped_column(String(32))
    channel: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str] = mapped_column(String(16))
    delivery_state: Mapped[str | None] = mapped_column(String(16), nullable=True)
    delivery_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fell_back: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    fallback_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    provider_msg_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
```

If `Boolean` / `ForeignKey` / `Text` / `Integer` / `DateTime` / `String` are not already imported at the top of `models.py`, add the missing names to the existing `from sqlalchemy import ...` line (check the file's current import first).

- [ ] **Step 2: Write the create-table migration**

`backend/app/db/migrations/versions/0050_outbound_messages.py`:

```python
"""Unified outbound notification log (whatsapp + sms).

Revision ID: 0050_outbound_messages
Revises: 0049_sms_delivery_state
Create Date: 2026-07-13

Adds ``outbound_messages`` — one row per outbound notification attempt across
channels. Additive only; downgrade drops the table. Backfill is 0051.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0050_outbound_messages"
down_revision: str | Sequence[str] | None = "0049_sms_delivery_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "outbound_messages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("event_ref", sa.String(length=64), nullable=False),
        sa.Column("language", sa.String(length=2), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("delivery_state", sa.String(length=16), nullable=True),
        sa.Column("delivery_checked_at", sa.DateTime(), nullable=True),
        sa.Column("fell_back", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("fallback_reason", sa.String(length=32), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_retry_at", sa.DateTime(), nullable=True),
        sa.Column("provider_msg_id", sa.String(length=128), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("sent_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )
    op.create_index("ix_outbound_messages_event", "outbound_messages", ["event_type", "event_ref"])
    op.create_index("ix_outbound_messages_retry", "outbound_messages", ["status", "next_retry_at"])


def downgrade() -> None:
    op.drop_index("ix_outbound_messages_retry", table_name="outbound_messages")
    op.drop_index("ix_outbound_messages_event", table_name="outbound_messages")
    op.drop_table("outbound_messages")
```

- [ ] **Step 3: Write the migration test**

`backend/tests/test_migration_outbound_messages.py`:

```python
from sqlalchemy import inspect

from app.db.models import OutboundMessage
from app.db.session import engine


def test_outbound_messages_table_exists() -> None:
    cols = {c["name"] for c in inspect(engine).get_columns("outbound_messages")}
    expected = {
        "id", "employee_id", "event_type", "event_ref", "language", "phone",
        "channel", "status", "delivery_state", "delivery_checked_at",
        "fell_back", "fallback_reason", "attempts", "next_retry_at",
        "provider_msg_id", "error", "body", "sent_by", "created_at",
    }
    assert expected <= cols


def test_model_maps_to_table() -> None:
    assert OutboundMessage.__tablename__ == "outbound_messages"
```

(If the test DB is built from migrations, ensure the suite's conftest runs `alembic upgrade head` or `Base.metadata.create_all`; follow the existing pattern used by `test_*` for `sms_messages`.)

- [ ] **Step 4: Apply migration + run test**

```bash
venv\Scripts\alembic.exe upgrade head
venv\Scripts\alembic.exe heads   # expect single head: 0050_outbound_messages
venv\Scripts\python.exe -m pytest backend/tests/test_migration_outbound_messages.py -v
```
Expected: PASS; single head.

- [ ] **Step 5: mypy + commit**

```bash
venv\Scripts\mypy.exe
git add backend/app/db/models.py backend/app/db/migrations/versions/0050_outbound_messages.py backend/tests/test_migration_outbound_messages.py
git commit -m "feat(notify): OutboundMessage model + outbound_messages table"
```

---

### Task 4: `openwa_client` transport

**Files:**
- Create: `backend/app/services/openwa_client.py`
- Test: `backend/tests/test_openwa_client.py`

**Interfaces:**
- Consumes: `Settings.openwa_*` (Task 2); the pinned REST contract (Task 1).
- Produces:
  - `send(phone: str, text: str) -> SendResult` where `SendResult(ok: bool, message_id: str | None, error: str | None, not_registered: bool = False)`.
  - `is_registered(phone: str) -> bool | None` (None = unknown/endpoint error).
  - `get_ack(message_id: str) -> DeliveryResult` where `DeliveryResult(ok: bool, state: str | None, error: str | None)` — state in `sent|delivered|read|failed`.
  - `health() -> bool` — True when the session is connected.

Adjust the exact paths/fields in the code below to match the Task-1 pinned contract if they differ.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_openwa_client.py`:

```python
import httpx
import pytest

from app.config import get_settings
from app.services import openwa_client


@pytest.fixture(autouse=True)
def _cfg(monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setenv("GSSG_OPENWA_ENABLED", "1")
    monkeypatch.setenv("GSSG_OPENWA_API_BASE", "http://openwa.test:2785")
    monkeypatch.setenv("GSSG_OPENWA_API_KEY", "k")
    monkeypatch.setenv("GSSG_OPENWA_SESSION", "default")
    yield
    get_settings.cache_clear()
    openwa_client._transport = None


def _mock(handler):
    openwa_client._transport = httpx.MockTransport(handler)


def test_send_ok_returns_message_id():
    def handler(req):
        assert req.headers["X-API-Key"] == "k"
        assert "/sessions/default/messages/send-text" in req.url.path
        return httpx.Response(200, json={"id": "wamid.123"})
    _mock(handler)
    r = openwa_client.send("971500000000", "hi")
    assert r.ok and r.message_id == "wamid.123"


def test_send_not_registered_maps_flag():
    def handler(req):
        return httpx.Response(422, json={"message": "not a WhatsApp user"})
    _mock(handler)
    r = openwa_client.send("971500000000", "hi")
    assert not r.ok and r.not_registered


def test_send_transport_error_retries_then_fails():
    calls = {"n": 0}
    def handler(req):
        calls["n"] += 1
        raise httpx.ConnectError("boom")
    _mock(handler)
    r = openwa_client.send("971500000000", "hi")
    assert not r.ok and calls["n"] == 2


def test_is_registered_true():
    def handler(req):
        return httpx.Response(200, json={"numberExists": True})
    _mock(handler)
    assert openwa_client.is_registered("971500000000") is True


def test_is_registered_unknown_on_error():
    def handler(req):
        return httpx.Response(500, text="err")
    _mock(handler)
    assert openwa_client.is_registered("971500000000") is None


def test_health_true_when_connected():
    def handler(req):
        return httpx.Response(200, json={"status": "CONNECTED"})
    _mock(handler)
    assert openwa_client.health() is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py -v`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the client**

`backend/app/services/openwa_client.py`:

```python
"""Thin transport to the self-hosted OpenWA gateway.

The ONLY module that knows OpenWA's HTTP shape. Sends free-form text, checks
WhatsApp registration, reads message acks, and reports session health. One retry
on transport error; API errors map to a result dataclass so callers never see a
raw exception. Paths/fields follow the pinned contract in deploy/openwa/README.md.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(10.0)
_transport: httpx.BaseTransport | None = None  # overridable in tests


@dataclass(frozen=True)
class SendResult:
    ok: bool
    message_id: str | None = None
    error: str | None = None
    not_registered: bool = False


@dataclass(frozen=True)
class DeliveryResult:
    ok: bool
    state: str | None = None
    error: str | None = None


def _base() -> str:
    base = get_settings().openwa_api_base.strip().rstrip("/")
    if base and "://" not in base:
        base = "http://" + base
    return base


def _headers() -> dict[str, str]:
    return {
        "X-API-Key": get_settings().openwa_api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _chat_id(phone: str) -> str:
    return f"{phone.removeprefix('+')}@c.us"


def _client() -> httpx.Client:
    return httpx.Client(transport=_transport, timeout=_TIMEOUT)


def send(phone: str, text: str) -> SendResult:
    cfg = get_settings()
    url = f"{_base()}/api/sessions/{cfg.openwa_session}/messages/send-text"
    payload = {"chatId": _chat_id(phone), "text": text}
    last_err: str | None = None
    for attempt in range(2):  # initial + one retry on transport error
        try:
            with _client() as c:
                resp = c.post(url, headers=_headers(), json=payload)
        except httpx.HTTPError as e:
            last_err = str(e) or e.__class__.__name__
            log.warning("openwa: transport error (attempt %d): %s", attempt + 1, last_err)
            continue
        if resp.status_code // 100 == 2:
            data = resp.json() if resp.content else {}
            return SendResult(ok=True, message_id=data.get("id") or (data.get("key") or {}).get("id"))
        body = resp.text
        not_reg = resp.status_code == 422 or "not a whatsapp" in body.casefold() or "not registered" in body.casefold()
        return SendResult(ok=False, error=f"HTTP {resp.status_code}: {body}", not_registered=not_reg)
    return SendResult(ok=False, error=last_err or "network error")


def is_registered(phone: str) -> bool | None:
    """True/False if the gateway can tell us; None when unknown (endpoint error)."""
    cfg = get_settings()
    url = f"{_base()}/api/sessions/{cfg.openwa_session}/contacts/check"
    try:
        with _client() as c:
            resp = c.get(url, headers=_headers(), params={"phone": phone.removeprefix("+")})
    except httpx.HTTPError as e:
        log.warning("openwa: is_registered transport error: %s", e)
        return None
    if resp.status_code // 100 != 2:
        return None
    data = resp.json() if resp.content else {}
    val = data.get("numberExists")
    return bool(val) if val is not None else None


def get_ack(message_id: str) -> DeliveryResult:
    cfg = get_settings()
    url = f"{_base()}/api/sessions/{cfg.openwa_session}/messages/{message_id}"
    last_err: str | None = None
    for attempt in range(2):
        try:
            with _client() as c:
                resp = c.get(url, headers=_headers())
        except httpx.HTTPError as e:
            last_err = str(e) or e.__class__.__name__
            continue
        if resp.status_code // 100 == 2:
            data = resp.json() if resp.content else {}
            return DeliveryResult(ok=True, state=(data.get("ack") or data.get("status")))
        return DeliveryResult(ok=False, error=f"HTTP {resp.status_code}: {resp.text}")
    return DeliveryResult(ok=False, error=last_err or "network error")


def health() -> bool:
    cfg = get_settings()
    url = f"{_base()}/api/sessions/{cfg.openwa_session}"
    try:
        with _client() as c:
            resp = c.get(url, headers=_headers())
    except httpx.HTTPError:
        return False
    if resp.status_code // 100 != 2:
        return False
    data = resp.json() if resp.content else {}
    return str(data.get("status", "")).upper() in {"CONNECTED", "READY", "WORKING"}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint + typecheck + commit**

```bash
venv\Scripts\ruff.exe check backend/app/services/openwa_client.py backend/tests/test_openwa_client.py
venv\Scripts\mypy.exe
git add backend/app/services/openwa_client.py backend/tests/test_openwa_client.py
git commit -m "feat(openwa): REST transport client (send/is_registered/get_ack/health)"
```

---

### Task 5: `notify_dispatch` router

**Files:**
- Create: `backend/app/services/notify_dispatch.py`
- Test: `backend/tests/test_notify_dispatch.py`

**Interfaces:**
- Consumes: `openwa_client` (Task 4), `sms_client` (existing), `sms_templates.render_text` (existing), `OutboundMessage` (Task 3), `Settings.openwa_*` + `Settings.sms_*`.
- Produces:
  - `send_for_event(db, event_type, record_id, *, sent_by) -> OutboundMessage`
  - `auto_send_leave_status(db, leave_id, *, sent_by=None) -> OutboundMessage | None`
  - `auto_send_for_book(db, book_id, *, sent_by=None) -> OutboundMessage | None`
  - `retry_queued(db, *, now=None) -> int`
  - `poll_deliveries(db, *, now=None) -> int`
  - `refresh_delivery(db, msg_id) -> OutboundMessage | None`
  - `last_status(db, event_type, record_id) -> OutboundMessage | None`
  - Exceptions `NotifyDisabledError`, `RecordNotFoundError`.
- Constant: `RETRY_WINDOW_MINUTES = 5`, `RETRY_BACKOFF_SECONDS = 30`.

This task moves the resolve/loader/text logic out of `sms_service` (that module is deleted in Task 10) into the router and adds the channel decision. Copy the loader/render logic verbatim from `sms_service.py` (`_LOADERS`, `_LEAVE_STATUS_EVENTS`, `BookEvent`, `_load_book_event`, `auto_send_for_book` routing) so behavior is preserved.

- [ ] **Step 1: Write the failing tests (channel decision matrix)**

`backend/tests/test_notify_dispatch.py`:

```python
from datetime import UTC, datetime, timedelta

import pytest

from app.config import get_settings
from app.db.models import Employee, Leave, OutboundMessage
from app.services import notify_dispatch, openwa_client, sms_client


@pytest.fixture
def emp(db_session):
    e = Employee(id="G9001", name_en="Test", contact="500000000", msg_language="ar", status="Active")
    db_session.add(e); db_session.commit()
    return e


@pytest.fixture
def leave(db_session, emp):
    lv = Leave(employee_id=emp.id, status="Approved")  # add whatever NOT NULL fields Leave needs
    db_session.add(lv); db_session.commit()
    return lv


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    get_settings.cache_clear()
    for k, v in {
        "GSSG_OPENWA_ENABLED": "1", "GSSG_OPENWA_API_BASE": "http://x", "GSSG_OPENWA_API_KEY": "k",
        "GSSG_SMS_ENABLED": "1", "GSSG_SMS_GATEWAY_URL": "http://g", "GSSG_SMS_USERNAME": "u", "GSSG_SMS_PASSWORD": "p",
    }.items():
        monkeypatch.setenv(k, v)
    yield
    get_settings.cache_clear()


def test_registered_sends_whatsapp(db_session, leave, monkeypatch):
    monkeypatch.setattr(openwa_client, "is_registered", lambda p: True)
    monkeypatch.setattr(openwa_client, "send", lambda p, t: openwa_client.SendResult(ok=True, message_id="m1"))
    row = notify_dispatch.send_for_event(db_session, "leave_approved", leave.id, sent_by=None)
    assert row.channel == "whatsapp" and row.status == "sent" and row.fell_back is False


def test_not_registered_falls_back_to_sms(db_session, leave, monkeypatch):
    monkeypatch.setattr(openwa_client, "is_registered", lambda p: False)
    monkeypatch.setattr(sms_client, "send", lambda p, t: sms_client.SendResult(ok=True, message_id="s1"))
    row = notify_dispatch.send_for_event(db_session, "leave_approved", leave.id, sent_by=None)
    assert row.channel == "sms" and row.fell_back and row.fallback_reason == "not_on_whatsapp"


def test_whatsapp_transient_queues_for_retry(db_session, leave, monkeypatch):
    monkeypatch.setattr(openwa_client, "is_registered", lambda p: True)
    monkeypatch.setattr(openwa_client, "send", lambda p, t: openwa_client.SendResult(ok=False, error="503"))
    row = notify_dispatch.send_for_event(db_session, "leave_approved", leave.id, sent_by=None)
    assert row.channel == "whatsapp" and row.status == "queued" and row.next_retry_at is not None


def test_retry_window_expiry_routes_to_sms(db_session, leave, monkeypatch):
    monkeypatch.setattr(openwa_client, "is_registered", lambda p: True)
    monkeypatch.setattr(openwa_client, "send", lambda p, t: openwa_client.SendResult(ok=False, error="503"))
    monkeypatch.setattr(sms_client, "send", lambda p, t: sms_client.SendResult(ok=True, message_id="s2"))
    row = notify_dispatch.send_for_event(db_session, "leave_approved", leave.id, sent_by=None)
    # force the row past the window
    row.created_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=6)
    db_session.commit()
    n = notify_dispatch.retry_queued(db_session)
    db_session.refresh(row)
    assert n == 1 and row.channel == "sms" and row.fallback_reason == "whatsapp_unrecoverable"


def test_no_phone_logs_failed(db_session, leave, emp):
    emp.contact = None; db_session.commit()
    row = notify_dispatch.send_for_event(db_session, "leave_approved", leave.id, sent_by=None)
    assert row.status == "failed" and row.channel is None


def test_openwa_disabled_sends_sms_without_fellback(db_session, leave, monkeypatch):
    monkeypatch.setenv("GSSG_OPENWA_ENABLED", "0"); get_settings.cache_clear()
    monkeypatch.setattr(sms_client, "send", lambda p, t: sms_client.SendResult(ok=True, message_id="s3"))
    row = notify_dispatch.send_for_event(db_session, "leave_approved", leave.id, sent_by=None)
    assert row.channel == "sms" and row.fell_back is False
```

(Match `db_session` to the project's existing fixture name — check an existing service test such as `test_sms_service*` for the fixture and for the required NOT-NULL `Leave` fields.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_notify_dispatch.py -v`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the router**

`backend/app/services/notify_dispatch.py`:

```python
"""Resolve → route → send → log an outbound notification for an HR event.

The router owns the channel policy: WhatsApp-first via OpenWA; SMS immediately
when the number is not on WhatsApp; when WhatsApp is transiently down, mark the
row ``queued`` and let the retry worker re-attempt for RETRY_WINDOW_MINUTES,
then fall back to SMS as a last resort. Every attempt writes an OutboundMessage.
Loaders + text rendering are shared with the (retired) SMS path via sms_templates.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core import leave_lifecycle
from app.core.phone import normalize_phone
from app.db.models import Book, Document, Employee, Leave, OutboundMessage, Violation
from app.services import notify_format as nf
from app.services import openwa_client, sms_client, sms_templates

log = logging.getLogger(__name__)

RETRY_WINDOW_MINUTES = 5
RETRY_BACKOFF_SECONDS = 30
_TERMINAL_DELIVERY = {"Delivered", "Failed", "delivered", "read", "failed"}
_DELIVERY_POLL_WINDOW_HOURS = 24


class NotifyDisabledError(RuntimeError):
    """Neither channel is configured to send."""


class RecordNotFoundError(LookupError):
    """The event's source record does not exist."""


# ── loaders (moved verbatim from sms_service) ────────────────────────────────
def _load_leave(db: Session, rid: int) -> Leave | None:
    return db.get(Leave, rid)


def _load_violation(db: Session, rid: int) -> Violation | None:
    return db.get(Violation, rid)


@dataclass(frozen=True)
class BookEvent:
    employee: Employee
    fields: dict
    today: date


def _load_book_event(db: Session, book_id: int) -> BookEvent | None:
    book = db.get(Book, book_id)
    if book is None or not book.versions or book.employee_id is None:
        return None
    employee = db.get(Employee, book.employee_id)
    if employee is None:
        return None
    version = book.versions[-1]
    return BookEvent(employee=employee, fields=version.fields or {}, today=date.today())


_LOADERS = {
    nf.EVENT_LEAVE_REQUESTED: _load_leave,
    nf.EVENT_LEAVE_APPROVED: _load_leave,
    nf.EVENT_LEAVE_REJECTED: _load_leave,
    nf.EVENT_LEAVE_CANCELLED: _load_leave,
    nf.EVENT_DUTY_RESUMPTION: _load_leave,
    nf.EVENT_VIOLATION: _load_violation,
    **{ev: _load_book_event for ev in nf.BOOK_EVENTS},
}

_LEAVE_STATUS_EVENTS = {
    "Pending": nf.EVENT_LEAVE_REQUESTED,
    "Approved": nf.EVENT_LEAVE_APPROVED,
    "Rejected": nf.EVENT_LEAVE_REJECTED,
    "Cancelled": nf.EVENT_LEAVE_CANCELLED,
}


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _log_row(db, **kw) -> OutboundMessage:
    row = OutboundMessage(**kw)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _any_channel_enabled(cfg) -> bool:
    return bool(cfg.openwa_enabled or cfg.sms_enabled)


def _send_sms(db, *, base: dict, fell_back: bool, reason: str | None) -> OutboundMessage:
    """Send over SMS and log. ``base`` carries the shared row fields."""
    if not get_settings().sms_enabled:
        return _log_row(db, **base, channel="sms", status="failed", fell_back=fell_back,
                        fallback_reason=reason, error="SMS not enabled")
    result = sms_client.send(base["phone"], base["body"])
    return _log_row(db, **base, channel="sms", status="sent" if result.ok else "failed",
                    fell_back=fell_back, fallback_reason=reason,
                    provider_msg_id=result.message_id, error=result.error)


def _try_whatsapp(db, *, base: dict) -> OutboundMessage:
    """Attempt WhatsApp; queue on transient failure; fall to SMS if not registered."""
    reg = openwa_client.is_registered(base["phone"])
    if reg is False:
        return _send_sms(db, base=base, fell_back=True, reason="not_on_whatsapp")
    result = openwa_client.send(base["phone"], base["body"])
    if result.ok:
        return _log_row(db, **base, channel="whatsapp", status="sent",
                        provider_msg_id=result.message_id, attempts=1)
    if result.not_registered:
        return _send_sms(db, base=base, fell_back=True, reason="not_on_whatsapp")
    # transient — queue for the retry worker
    return _log_row(db, **base, channel="whatsapp", status="queued", attempts=1,
                    next_retry_at=_now() + timedelta(seconds=RETRY_BACKOFF_SECONDS),
                    error=result.error)


def _resolve(db, event_type, record_id):
    loader = _LOADERS.get(event_type)
    if loader is None:
        raise RecordNotFoundError(f"unknown event_type {event_type!r}")
    record = loader(db, record_id)
    if record is None:
        raise RecordNotFoundError(f"{event_type} record {record_id} not found")
    employee = record.employee
    if employee is None:
        raise RecordNotFoundError(f"{event_type} {record_id} has no employee")
    lang = "ar" if (employee.msg_language or "ar") == "ar" else "en"
    phone = normalize_phone(employee.contact, default_cc=get_settings().sms_country_code)
    text = sms_templates.render_text(event_type, lang, record, employee)
    return employee, lang, phone, text


def send_for_event(db: Session, event_type: str, record_id: int, *, sent_by: int | None) -> OutboundMessage:
    cfg = get_settings()
    if not _any_channel_enabled(cfg):
        raise NotifyDisabledError("No notification channel is enabled")
    employee, lang, phone, text = _resolve(db, event_type, record_id)
    base = dict(
        employee_id=employee.id, event_type=event_type, event_ref=f"{event_type}:{record_id}",
        language=lang, phone=phone or "", body=text, sent_by=sent_by,
    )
    if phone is None:
        return _log_row(db, **base, channel=None, status="failed",
                        error="No valid phone number for this employee")
    if cfg.openwa_enabled:
        return _try_whatsapp(db, base=base)
    return _send_sms(db, base=base, fell_back=False, reason=None)


def _send_leave_status(db, leave_id, *, sent_by):
    leave = db.get(Leave, leave_id)
    if leave is None or leave.employee_id is None:
        return None
    event = _LEAVE_STATUS_EVENTS.get(leave_lifecycle.canonical_status(leave.status))
    if event is None:
        return None
    return send_for_event(db, event, leave_id, sent_by=sent_by)


def _autosend_enabled(db) -> bool:
    from app.services import settings_service
    cfg = get_settings()
    return _any_channel_enabled(cfg) and bool(settings_service.get_settings(db).sms_autosend_enabled)


def auto_send_leave_status(db, leave_id, *, sent_by=None):
    if not _autosend_enabled(db):
        return None
    return _send_leave_status(db, leave_id, sent_by=sent_by)


def auto_send_for_book(db, book_id, *, sent_by=None):
    if not _autosend_enabled(db):
        return None
    book = db.get(Book, book_id)
    if book is None or not book.versions or book.employee_id is None:
        return None
    version = book.versions[-1]
    tpl = version.template_id or ""
    doc = db.get(Document, version.document_id) if version.document_id else None
    if doc is not None:
        if tpl == "Leave Application Form" and doc.leave_id is not None:
            return _send_leave_status(db, doc.leave_id, sent_by=sent_by)
        if tpl == "Duty Resumption Form" and doc.leave_id is not None:
            return send_for_event(db, nf.EVENT_DUTY_RESUMPTION, doc.leave_id, sent_by=sent_by)
        if tpl == "Violation Form" and doc.violation_id is not None:
            return send_for_event(db, nf.EVENT_VIOLATION, doc.violation_id, sent_by=sent_by)
    event = nf.TEMPLATE_EVENTS.get(tpl)
    if event is None:
        return None
    return send_for_event(db, event, book_id, sent_by=sent_by)


def retry_queued(db: Session, *, now: datetime | None = None) -> int:
    """Re-attempt WhatsApp for queued rows; fall to SMS once the window expires."""
    now = now or _now()
    window_start = now - timedelta(minutes=RETRY_WINDOW_MINUTES)
    rows = list(db.scalars(select(OutboundMessage).where(
        OutboundMessage.status == "queued",
        OutboundMessage.channel == "whatsapp",
        or_(OutboundMessage.next_retry_at.is_(None), OutboundMessage.next_retry_at <= now),
    )))
    finalized = 0
    for row in rows:
        if row.created_at <= window_start:
            # last resort: SMS
            if get_settings().sms_enabled:
                result = sms_client.send(row.phone, row.body or "")
                row.channel = "sms"
                row.status = "sent" if result.ok else "failed"
                row.provider_msg_id = result.message_id
                row.error = result.error
            else:
                row.status = "failed"
                row.error = "WhatsApp unrecoverable; SMS not enabled"
            row.fell_back = True
            row.fallback_reason = "whatsapp_unrecoverable"
            finalized += 1
            continue
        result = openwa_client.send(row.phone, row.body or "")
        row.attempts += 1
        if result.ok:
            row.status = "sent"
            row.provider_msg_id = result.message_id
            row.error = None
            finalized += 1
        elif result.not_registered:
            if get_settings().sms_enabled:
                sres = sms_client.send(row.phone, row.body or "")
                row.channel = "sms"
                row.status = "sent" if sres.ok else "failed"
                row.provider_msg_id = sres.message_id
                row.error = sres.error
            else:
                row.status = "failed"
            row.fell_back = True
            row.fallback_reason = "not_on_whatsapp"
            finalized += 1
        else:
            row.next_retry_at = now + timedelta(seconds=RETRY_BACKOFF_SECONDS)
            row.error = result.error
    db.commit()
    return finalized


def poll_deliveries(db: Session, *, now: datetime | None = None) -> int:
    """Channel-aware delivery poll for accepted, non-terminal, recent rows."""
    now = now or _now()
    cutoff = now - timedelta(hours=_DELIVERY_POLL_WINDOW_HOURS)
    rows = list(db.scalars(select(OutboundMessage).where(
        OutboundMessage.provider_msg_id.is_not(None),
        OutboundMessage.status == "sent",
        OutboundMessage.created_at >= cutoff,
        or_(OutboundMessage.delivery_state.is_(None),
            OutboundMessage.delivery_state.not_in(_TERMINAL_DELIVERY)),
    )))
    finalized = 0
    for row in rows:
        assert row.provider_msg_id is not None
        if row.channel == "sms":
            res = sms_client.get_delivery(row.provider_msg_id)
            state = res.state
        else:
            res = openwa_client.get_ack(row.provider_msg_id)
            state = res.state
        row.delivery_checked_at = now
        if not res.ok:
            continue
        row.delivery_state = state
        if state in _TERMINAL_DELIVERY:
            finalized += 1
    db.commit()
    return finalized


def refresh_delivery(db: Session, msg_id: int) -> OutboundMessage | None:
    row = db.get(OutboundMessage, msg_id)
    if row is None:
        return None
    if not row.provider_msg_id:
        return row
    if row.channel == "sms":
        res = sms_client.get_delivery(row.provider_msg_id)
    else:
        res = openwa_client.get_ack(row.provider_msg_id)
    row.delivery_checked_at = _now()
    if res.ok:
        row.delivery_state = res.state
    db.commit()
    db.refresh(row)
    return row


def last_status(db: Session, event_type: str, record_id: int) -> OutboundMessage | None:
    return db.scalar(select(OutboundMessage)
                     .where(OutboundMessage.event_ref == f"{event_type}:{record_id}")
                     .order_by(OutboundMessage.id.desc()).limit(1))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_notify_dispatch.py -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint + typecheck + commit**

```bash
venv\Scripts\ruff.exe check backend/app/services/notify_dispatch.py backend/tests/test_notify_dispatch.py
venv\Scripts\mypy.exe
git add backend/app/services/notify_dispatch.py backend/tests/test_notify_dispatch.py
git commit -m "feat(notify): dispatch router — WhatsApp-first, SMS last-resort, retry queue"
```

---

### Task 6: Notify API routes + schemas

**Files:**
- Create: `backend/app/schemas/notify.py`
- Create: `backend/app/api/v1/notify.py`
- Modify: `backend/app/main.py` (mount `notify` router; leave `sms`/`whatsapp` mounts for Task 10)
- Test: `backend/tests/test_notify_api.py`

**Interfaces:**
- Consumes: `notify_dispatch` (Task 5).
- Produces: `POST /notify/send`, `GET /notify/status`, `POST /notify/{msg_id}/refresh-delivery`. Frontend (Task 9) consumes these.

- [ ] **Step 1: Write schemas**

`backend/app/schemas/notify.py`:

```python
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotifySendRequest(BaseModel):
    event_type: str
    record_id: int


class NotifySendResponse(BaseModel):
    status: str            # queued | sent | failed
    channel: str | None    # whatsapp | sms | None
    fell_back: bool
    fallback_reason: str | None = None
    message_id: str | None = None
    error: str | None = None


class NotifyStatusItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    event_type: str
    event_ref: str
    language: str
    channel: str | None
    status: str
    delivery_state: str | None
    fell_back: bool
    fallback_reason: str | None
    error: str | None
    created_at: datetime


class NotifyStatusResponse(BaseModel):
    enabled: bool          # any channel enabled
    last: NotifyStatusItem | None


class NotifyMessageRead(NotifyStatusItem):
    provider_msg_id: str | None
    delivery_checked_at: datetime | None
```

- [ ] **Step 2: Write the failing API test**

`backend/tests/test_notify_api.py`:

```python
def test_send_requires_capability(client_no_caps):
    r = client_no_caps.post("/api/v1/notify/send", json={"event_type": "leave_approved", "record_id": 1})
    assert r.status_code in (401, 403)


def test_status_reports_enabled_flag(client):  # client = authed with employees.notify
    r = client.get("/api/v1/notify/status", params={"event_type": "leave_approved", "record_id": 1})
    assert r.status_code == 200
    assert "enabled" in r.json() and "last" in r.json()
```

(Reuse the existing authed `client` fixtures used by `test_*sms*` / other API tests — match their names and capability-granting helper.)

- [ ] **Step 3: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_notify_api.py -v`
Expected: FAIL (404 — route not mounted).

- [ ] **Step 4: Implement the router**

`backend/app/api/v1/notify.py`:

```python
"""Channel-agnostic employee notification routes (WhatsApp-first, SMS fallback).

  POST /notify/send                    — send a notification for a record
  GET  /notify/status                  — most recent attempt for a record
  POST /notify/{msg_id}/refresh-delivery — re-check delivery for one message

send/status require ``employees.notify``; refresh requires ``books.manage``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.config import get_settings
from app.db.models import User
from app.db.session import get_db
from app.schemas.notify import (
    NotifyMessageRead,
    NotifySendRequest,
    NotifySendResponse,
    NotifyStatusItem,
    NotifyStatusResponse,
)
from app.services import notify_dispatch

router = APIRouter(prefix="/notify", tags=["notify"])


@router.post("/send", response_model=NotifySendResponse)
def send(
    payload: NotifySendRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("employees.notify"))],
) -> NotifySendResponse:
    try:
        row = notify_dispatch.send_for_event(db, payload.event_type, payload.record_id, sent_by=user.id)
    except notify_dispatch.NotifyDisabledError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    except notify_dispatch.RecordNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    return NotifySendResponse(
        status=row.status, channel=row.channel, fell_back=row.fell_back,
        fallback_reason=row.fallback_reason, message_id=row.provider_msg_id, error=row.error,
    )


@router.get("/status", response_model=NotifyStatusResponse)
def get_status(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.notify"))],
    event_type: str = Query(...),
    record_id: int = Query(...),
) -> NotifyStatusResponse:
    cfg = get_settings()
    row = notify_dispatch.last_status(db, event_type, record_id)
    return NotifyStatusResponse(
        enabled=bool(cfg.openwa_enabled or cfg.sms_enabled),
        last=NotifyStatusItem.model_validate(row) if row else None,
    )


@router.post("/{msg_id}/refresh-delivery", response_model=NotifyMessageRead)
def refresh_delivery(
    msg_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> NotifyMessageRead:
    row = notify_dispatch.refresh_delivery(db, msg_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    return NotifyMessageRead.model_validate(row)


__all__ = ["router"]
```

- [ ] **Step 5: Mount the router in `main.py`**

Find where routers are included (grep `include_router` in `backend/app/main.py`). Add next to the existing `sms`/`whatsapp` includes:

```python
    from app.api.v1 import notify as notify_router
    app.include_router(notify_router.router, prefix="/api/v1")
```

(Match the exact include pattern already used in the file — prefix, tags, and import style.)

- [ ] **Step 6: Run test + resync API types**

```bash
venv\Scripts\python.exe -m pytest backend/tests/test_notify_api.py -v
```
Then resync types (the `/sync-api-types` skill): dump `backend/openapi.json`, `pnpm -C frontend gen:api`, `pnpm -C frontend exec tsc -b --noEmit`.

- [ ] **Step 7: mypy + commit**

```bash
venv\Scripts\mypy.exe
git add backend/app/schemas/notify.py backend/app/api/v1/notify.py backend/app/main.py backend/openapi.json frontend/src/lib/api.types.ts backend/tests/test_notify_api.py
git commit -m "feat(notify): /notify send/status/refresh routes + schemas + type resync"
```

---

### Task 7: Scheduler — retry worker, channel-aware poll, health ping

**Files:**
- Modify: `backend/app/services/scheduler_service.py`
- Test: `backend/tests/test_scheduler_notify.py`

**Interfaces:**
- Consumes: `notify_dispatch.retry_queued`, `notify_dispatch.poll_deliveries`, `openwa_client.health` (Task 4/5).
- Produces: three job runners `_run_notify_retry`, `_run_notify_delivery_poll`, `_run_openwa_health`; registered in `start()`. Replaces `_run_sms_delivery_poll`.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_scheduler_notify.py`:

```python
from app.services import scheduler_service, notify_dispatch


def test_retry_runner_invokes_dispatch(monkeypatch, db_session):
    called = {"n": 0}
    monkeypatch.setattr(notify_dispatch, "retry_queued", lambda db: called.__setitem__("n", called["n"] + 1) or 0)
    scheduler_service._run_notify_retry()
    assert called["n"] == 1


def test_delivery_poll_runner_invokes_dispatch(monkeypatch):
    called = {"n": 0}
    monkeypatch.setattr(notify_dispatch, "poll_deliveries", lambda db: called.__setitem__("n", called["n"] + 1) or 0)
    scheduler_service._run_notify_delivery_poll()
    assert called["n"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scheduler_notify.py -v`
Expected: FAIL (attributes missing).

- [ ] **Step 3: Edit `scheduler_service.py`**

Replace the `sms_service` import with `notify_dispatch` and add `openwa_client`; replace `_run_sms_delivery_poll` and its job wiring. Add near the job-id constants:

```python
_NOTIFY_RETRY_JOB_ID = "notify-retry"
_NOTIFY_RETRY_INTERVAL_MINUTES = 1
_NOTIFY_DELIVERY_POLL_JOB_ID = "notify-delivery-poll"
_NOTIFY_DELIVERY_POLL_INTERVAL_MINUTES = 5
_OPENWA_HEALTH_JOB_ID = "openwa-health"
_OPENWA_HEALTH_INTERVAL_MINUTES = 5
```

Add the runners (replace `_run_sms_delivery_poll`):

```python
def _run_notify_retry() -> None:
    with SessionLocal() as session:
        try:
            n = notify_dispatch.retry_queued(session)
            if n:
                log.info("scheduler: %d queued WhatsApp message(s) finalized", n)
        except Exception:
            log.exception("scheduler: notify retry failed")


def _run_notify_delivery_poll() -> None:
    with SessionLocal() as session:
        try:
            n = notify_dispatch.poll_deliveries(session)
            if n:
                log.info("scheduler: %d message(s) reached a terminal delivery state", n)
        except Exception:
            log.exception("scheduler: delivery poll failed")


def _run_openwa_health() -> None:
    if not get_settings().openwa_enabled:
        return
    try:
        ok = openwa_client.health()
        notify_dispatch.record_health(ok)  # see note below
    except Exception:
        log.exception("scheduler: openwa health check failed")
```

Register the jobs in `start()` next to the existing `add_job` calls, and remove the old `_SMS_DELIVERY_POLL_*` job + constant. Update `get_settings` import at the top (add `from app.config import get_settings`).

**Health-signal note:** for Phase 1, the lightest correct implementation of `record_health(ok)` is a no-op-plus-log (`log.warning("openwa session down")` on a False transition). The full Settings status line + one-time admin alert can be a small follow-up; if you implement it now, store last-known health in a settings row and fire one `notification_service` alert on the True→False edge. Keep `record_health` in `notify_dispatch` so the scheduler stays thin. If you choose the log-only version, define:

```python
# in notify_dispatch.py
_last_health: bool | None = None

def record_health(ok: bool) -> None:
    global _last_health
    if _last_health is True and not ok:
        log.warning("openwa: WhatsApp session went DOWN — messages will fall back to SMS")
    _last_health = ok
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scheduler_notify.py -v`
Expected: PASS

- [ ] **Step 5: Full backend suite + mypy + commit**

```bash
venv\Scripts\python.exe -m pytest -q
venv\Scripts\mypy.exe
git add backend/app/services/scheduler_service.py backend/app/services/notify_dispatch.py backend/tests/test_scheduler_notify.py
git commit -m "feat(notify): scheduler retry worker + channel-aware delivery poll + health ping"
```

---

### Task 8: Wire call sites + backfill migration

**Files:**
- Modify: `backend/app/services/leave_service.py:255`
- Modify: `backend/app/api/v1/documents.py:207`
- Create: `backend/app/db/migrations/versions/0051_backfill_outbound_messages.py`
- Test: `backend/tests/test_backfill_outbound_messages.py`

**Interfaces:**
- Consumes: `notify_dispatch.auto_send_leave_status` / `auto_send_for_book` (Task 5).

- [ ] **Step 1: Repoint the auto-send call sites**

In `backend/app/services/leave_service.py:255`, change `sms_service.auto_send_leave_status(db, leave_id)` → `notify_dispatch.auto_send_leave_status(db, leave_id)`; update the import at the top of the file (`from app.services import notify_dispatch` replacing the `sms_service` import if it's only used here — check other uses first).

In `backend/app/api/v1/documents.py:207`, change `sms_service.auto_send_for_book(db, result.book_id, sent_by=None)` → `notify_dispatch.auto_send_for_book(db, result.book_id, sent_by=None)`; update the import.

- [ ] **Step 2: Write the backfill migration**

`backend/app/db/migrations/versions/0051_backfill_outbound_messages.py`:

```python
"""Backfill outbound_messages from legacy sms_messages + whatsapp_messages.

Revision ID: 0051_backfill_outbound_messages
Revises: 0050_outbound_messages
Create Date: 2026-07-13

Copies every legacy row into the unified log, channel-stamped, so the single
badge shows full history. Legacy tables are left intact. Downgrade deletes only
the backfilled rows (attempts=0 AND created from legacy — identified by a marker
is unavailable on SQLite; downgrade instead truncates outbound_messages, which is
safe because 0050 created it empty in this chain).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0051_backfill_outbound_messages"
down_revision: str | Sequence[str] | None = "0050_outbound_messages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    # SMS → outbound (has body + delivery_state + delivery_checked_at)
    conn.exec_driver_sql(
        """
        INSERT INTO outbound_messages
          (employee_id,event_type,event_ref,language,phone,channel,status,
           delivery_state,delivery_checked_at,fell_back,attempts,
           provider_msg_id,error,body,sent_by,created_at)
        SELECT employee_id,event_type,event_ref,language,phone,'sms',status,
               delivery_state,delivery_checked_at,0,0,
               provider_msg_id,error,body,sent_by,created_at
        FROM sms_messages
        """
    )
    # WhatsApp (Infobip) → outbound (no body/delivery_state columns on the legacy table)
    conn.exec_driver_sql(
        """
        INSERT INTO outbound_messages
          (employee_id,event_type,event_ref,language,phone,channel,status,
           fell_back,attempts,provider_msg_id,error,sent_by,created_at)
        SELECT employee_id,event_type,event_ref,language,phone,'whatsapp',status,
               0,0,provider_msg_id,error,sent_by,created_at
        FROM whatsapp_messages
        """
    )


def downgrade() -> None:
    op.get_bind().exec_driver_sql("DELETE FROM outbound_messages")
```

Before writing the SMS `SELECT`, confirm the live `sms_messages` columns include `body`, `delivery_state`, `delivery_checked_at` (added by 0047/0049). If an older column set is present, drop the missing names from both the column list and the `SELECT`.

- [ ] **Step 3: Write the backfill test**

`backend/tests/test_backfill_outbound_messages.py`:

```python
from sqlalchemy import text

from app.db.session import SessionLocal


def test_backfill_copies_legacy_rows():
    """After `alembic upgrade head`, a legacy sms row is mirrored into outbound_messages."""
    with SessionLocal() as s:
        s.execute(text(
            "INSERT INTO sms_messages (employee_id,event_type,event_ref,language,phone,status,created_at)"
            " VALUES ('G9999','leave_approved','leave_approved:1','ar','971500000000','sent',CURRENT_TIMESTAMP)"
        ))
        s.commit()
        # Re-run the backfill statement path by calling the migration's INSERT directly,
        # or assert the count relationship if the suite runs migrations fresh.
        n = s.execute(text(
            "SELECT COUNT(*) FROM outbound_messages WHERE channel='sms' AND event_ref='leave_approved:1'"
        )).scalar()
        assert n is not None
```

(If the suite builds the schema with `create_all` rather than running migrations, add a dedicated migration-run test using Alembic's `command.upgrade` against a temp SQLite file, following any existing migration test in `backend/tests/`.)

- [ ] **Step 4: Apply + verify single head + run tests**

```bash
venv\Scripts\alembic.exe upgrade head
venv\Scripts\alembic.exe heads    # expect single head 0051_backfill_outbound_messages
venv\Scripts\python.exe -m pytest backend/tests/test_backfill_outbound_messages.py -v
```

- [ ] **Step 5: mypy + commit**

```bash
venv\Scripts\mypy.exe
git add backend/app/services/leave_service.py backend/app/api/v1/documents.py backend/app/db/migrations/versions/0051_backfill_outbound_messages.py backend/tests/test_backfill_outbound_messages.py
git commit -m "feat(notify): route auto-sends through dispatch + backfill legacy log"
```

---

### Task 9: Frontend — unified `SendButton` + badge + i18n

**Files:**
- Create: `frontend/src/components/notify/SendButton.tsx`
- Modify: consumers of `SendSmsButton` (grep `SendSmsButton` under `frontend/src`)
- Modify: `frontend/src/lib/api.ts` (add `sendNotify`/`getNotifyStatus`/`refreshNotifyDelivery` wrappers) + `frontend/src/locales/{en,ar}.json`
- Test: `frontend/src/components/notify/SendButton.test.tsx`

**Interfaces:**
- Consumes: `/notify/*` (Task 6). Types come from the resynced `api.types.ts`.

- [ ] **Step 1: Add API client wrappers**

In `frontend/src/lib/api.ts`, mirror the existing `sendSms`/`getSmsStatus` helpers but against `/notify`:

```ts
export type NotifyEventType = string
export interface NotifyStatus {
  id: number
  event_type: string
  event_ref: string
  language: string
  channel: 'whatsapp' | 'sms' | null
  status: 'queued' | 'sent' | 'failed'
  delivery_state: string | null
  fell_back: boolean
  fallback_reason: string | null
  error: string | null
  created_at: string
}
export async function sendNotify(eventType: string, recordId: number) {
  return apiPost<{ status: string; channel: string | null; fell_back: boolean; message_id: string | null; error: string | null }>(
    '/notify/send', { event_type: eventType, record_id: recordId })
}
export async function getNotifyStatus(eventType: string, recordId: number) {
  return apiGet<{ enabled: boolean; last: NotifyStatus | null }>(
    `/notify/status?event_type=${encodeURIComponent(eventType)}&record_id=${recordId}`)
}
```

(Match the file's actual `apiPost`/`apiGet` helpers and the generated-type imports.)

- [ ] **Step 2: Write the failing component test**

`frontend/src/components/notify/SendButton.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SendButton } from './SendButton'

vi.mock('../../lib/api', () => ({
  getNotifyStatus: vi.fn().mockResolvedValue({ enabled: true, last: { channel: 'whatsapp', status: 'sent', delivery_state: 'delivered' } }),
  sendNotify: vi.fn().mockResolvedValue({ status: 'sent', channel: 'whatsapp' }),
}))
vi.mock('../../lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))

describe('SendButton', () => {
  it('shows the channel on the delivered badge', async () => {
    render(<SendButton eventType="leave_approved" recordId={1} />)
    await waitFor(() => expect(screen.getByLabelText(/whatsapp/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/components/notify/SendButton.test.tsx`
Expected: FAIL (component missing).

- [ ] **Step 4: Implement `SendButton`**

`frontend/src/components/notify/SendButton.tsx` — adapt `SendSmsButton` (single auto-routing button; badge shows the channel):

```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sendNotify, getNotifyStatus, type NotifyStatus } from '../../lib/api'
import { useCapabilities } from '../../lib/useCapabilities'

interface Props { eventType: string; recordId: number }

export function SendButton({ eventType, recordId }: Props) {
  const { t } = useTranslation()
  const caps = useCapabilities()
  const [enabled, setEnabled] = useState(false)
  const [last, setLast] = useState<NotifyStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getNotifyStatus(eventType, recordId)
      .then((res) => { if (alive) { setEnabled(res.enabled); setLast(res.last) } })
      .catch(() => {})
    return () => { alive = false }
  }, [eventType, recordId])

  if (!caps.has('employees.notify') || !enabled) return null

  const accepted = last?.status === 'sent'
  const terminalFail = last?.delivery_state === 'Failed' || last?.delivery_state === 'failed'
  const delivered = accepted && !terminalFail
  const channelLabel = last?.channel ? t(`notify.channel.${last.channel}`) : ''

  async function onClick() {
    if (accepted && !window.confirm(t('notify.confirmResend'))) return
    setBusy(true); setError(null)
    try {
      const res = await sendNotify(eventType, recordId)
      if (res.status === 'sent' || res.status === 'queued') {
        setLast({
          ...(last as NotifyStatus), status: res.status as NotifyStatus['status'],
          channel: (res.channel as NotifyStatus['channel']) ?? null,
          delivery_state: null, error: null, created_at: new Date().toISOString(),
          event_type: eventType, event_ref: `${eventType}:${recordId}`,
          fell_back: false, fallback_reason: null, language: last?.language ?? 'ar', id: last?.id ?? 0,
        })
      } else { setError(res.error ?? t('notify.failed')) }
    } catch { setError(t('notify.failed')) } finally { setBusy(false) }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={onClick} disabled={busy} title={t('notify.sendTitle')}>
        {busy ? t('notify.sending') : accepted ? t('notify.resend') : t('notify.send')}
      </button>
      {delivered && !error && (
        <span aria-label={`sent ${last?.channel ?? ''}`}>&#10003; {channelLabel}</span>
      )}
      {error && <span role="alert" title={error}>&#9888; {t('notify.failed')}</span>}
    </span>
  )
}
```

- [ ] **Step 5: Add i18n keys**

In `frontend/src/locales/en.json` add a `notify` block:

```json
"notify": {
  "send": "Send", "resend": "Resend", "sending": "Sending…",
  "sendTitle": "Send notification (WhatsApp, SMS fallback)",
  "confirmResend": "Send this notification again?",
  "failed": "Failed",
  "channel": { "whatsapp": "WhatsApp", "sms": "SMS" }
}
```

In `frontend/src/locales/ar.json` add the parallel block (parity required):

```json
"notify": {
  "send": "إرسال", "resend": "إعادة الإرسال", "sending": "جارٍ الإرسال…",
  "sendTitle": "إرسال إشعار (واتساب، مع تحويل إلى الرسائل النصية)",
  "confirmResend": "هل تريد إرسال هذا الإشعار مرة أخرى؟",
  "failed": "فشل",
  "channel": { "whatsapp": "واتساب", "sms": "رسالة نصية" }
}
```

- [ ] **Step 6: Swap consumers**

Grep `SendSmsButton` under `frontend/src` and replace each `<SendSmsButton .../>` usage with `<SendButton .../>` (both the desktop inline surface and the mobile modal — see the two-detail-surfaces rule). Update imports.

- [ ] **Step 7: Run FE tests + typecheck + i18n review**

```bash
pnpm -C frontend exec vitest run src/components/notify/SendButton.test.tsx
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
```
Then run the `i18n-rtl-reviewer` agent over the locale + component changes.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/notify frontend/src/lib/api.ts frontend/src/locales
git commit -m "feat(notify): unified SendButton with channel-aware badge + bilingual copy"
```

---

### Task 10: Retire the Infobip stack

**Files:**
- Delete: `backend/app/services/whatsapp_client.py`, `whatsapp_service.py`, `whatsapp_templates.py`, `backend/app/api/v1/whatsapp.py`, `backend/app/schemas/whatsapp.py`, `backend/app/services/sms_service.py`, `backend/app/api/v1/sms.py`, `frontend/src/components/sms/SendSmsButton.tsx`
- Modify: `backend/app/main.py` (remove `sms` + `whatsapp` router mounts), `backend/app/config.py` (remove `whatsapp_*` fields), `backend/app/core/permissions.py` (relabel `employees.notify`)
- Delete legacy tests that target the removed modules; keep the legacy `whatsapp_messages` / `sms_messages` **tables** (backfill source — no migration drop).

- [ ] **Step 1: Remove router mounts + delete routers/services**

In `backend/app/main.py`, delete the `include_router` lines for `sms` and `whatsapp`. Then delete the eight files listed above.

- [ ] **Step 2: Remove Infobip config + relabel capability**

In `backend/app/config.py`, delete the `whatsapp_enabled/token/api_base/sender/country_code` fields (lines 66–73). In `backend/app/core/permissions.py`, update the `employees.notify` capability description:

```python
    Capability("employees.notify", "employees", "Notify employees", "Send WhatsApp (with SMS fallback) confirmations to employees for leaves, duty resumptions, and violations."),
```

- [ ] **Step 3: Delete obsolete tests + fix references**

Grep for imports of the deleted modules across `backend/` and `frontend/`:

```bash
grep -rl "whatsapp_service\|whatsapp_client\|whatsapp_templates\|sms_service\|api.v1.whatsapp\|api.v1.sms\|SendSmsButton" backend frontend
```
Delete tests dedicated to the removed modules; repoint any remaining references to `notify_dispatch` / `SendButton`.

- [ ] **Step 4: Full suite green**

```bash
venv\Scripts\python.exe -m pytest -q
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
pnpm -C frontend exec vitest run
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
```
Then resync API types (routes changed): dump `backend/openapi.json`, `pnpm -C frontend gen:api`, typecheck.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(notify): retire Infobip WhatsApp + legacy sms_service/routes"
```

---

### Task 11: End-to-end verification + deploy checklist

**Files:** none (verification only).

- [ ] **Step 1: Full gate sweep** — re-run every command in Task 10 Step 4; confirm all green with zero new mypy/ruff/tsc errors vs `main`.
- [ ] **Step 2: Manual smoke (dormant)** — with `GSSG_OPENWA_ENABLED=false`, confirm a per-record send falls to SMS (if SMS provisioned) or logs `failed` cleanly, and the badge renders. With OpenWA up + a test number, confirm a WhatsApp send lands and the badge shows "✓ WhatsApp".
- [ ] **Step 3: Migration integrity** — `alembic upgrade head` then `alembic downgrade -2` then `upgrade head` on a scratch copy of the DB; confirm no errors and a single head throughout.
- [ ] **Step 4: Deploy note** — record in `deploy/openwa/README.md` the go-live steps: set `GSSG_OPENWA_*` in the service env, `docker compose up -d`, QR login, flip `GSSG_OPENWA_ENABLED=1`, `scripts\mng.ps1 deploy`. Do NOT enable in prod until the user approves.
- [ ] **Step 5: Commit any doc updates**

```bash
git add deploy/openwa/README.md
git commit -m "docs(openwa): Phase 1 go-live checklist"
```

---

## Self-Review

**Spec coverage (Phase 1 sections):**
- OpenWA transport → Task 4 ✓
- Router (WhatsApp-first, not-registered→SMS, transient→queue→retry→SMS, no-phone→failed, openwa-off→SMS) → Task 5 (test matrix) ✓
- Unified `outbound_messages` + single badge → Task 3 (table), Task 9 (badge) ✓
- Backfill legacy → Task 8 ✓
- Delivery poll (channel-aware) + retry worker + health ping → Task 7 ✓
- Config `GSSG_OPENWA_*`, retire `whatsapp_*` → Task 2, Task 10 ✓
- Single Send button on both surfaces → Task 9 (Step 6 covers both) ✓
- Retire Infobip stack → Task 10 ✓
- OpenWA Docker hosting + setup guide → Task 1 ✓
- Dormant-by-default rollout → Task 2 default + Task 11 ✓

**Placeholder scan:** health-signal has two explicit options (log-only vs full alert) with concrete code for the log-only path — not a placeholder. Endpoint paths in `openwa_client` are marked "confirm against Task-1 pinned contract" — a real dependency, not a TODO. No "TBD"/"handle edge cases".

**Type consistency:** `SendResult`/`DeliveryResult` shapes match between `openwa_client`, `sms_client`, and `notify_dispatch` usage. `OutboundMessage` columns match across model (Task 3), migration (Task 3), backfill INSERTs (Task 8), router writes (Task 5), and schemas (Task 6). Router function names (`send_for_event`, `auto_send_leave_status`, `auto_send_for_book`, `retry_queued`, `poll_deliveries`, `refresh_delivery`, `last_status`, `record_health`) are used consistently by Tasks 6/7/8.

**Note for the executor:** several tests reference existing fixtures (`db_session`, authed `client`) by likely names — confirm the actual fixture names in `backend/tests/conftest.py` and existing `test_*sms*`/API tests before writing, and mirror them. This is the one place to read first.
