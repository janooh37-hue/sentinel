# OpenWA Phase 2c — WhatsApp Group Announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin pick one or more existing WhatsApp groups (fetched live from the office number), type a message, optionally attach a book's PDF or an uploaded file, and post it to those groups — one send per group, logged.

**Architecture:** This REPLACES the spec's §2c per-person broadcast. Groups are instruction-only, so there is **no audience resolution, no per-person fan-out, no throttling/daily-cap, and no SMS fallback** — group messages are WhatsApp-only. The OpenWA transport gains `list_groups()` and `send_file()`, and `send()` is refactored around a `send_to_chat(chat_id, text)` core so a group `@g.us` id reuses the existing send-text path. A thin `announce_service` fans a single compose action out to the selected groups (text, or file-with-caption when an attachment is present) and logs a `group_announcement` parent + one `group_announcement_send` child per group. A dedicated `/messages/broadcast` page (gated `messages.broadcast`) drives it.

**Tech Stack:** FastAPI (Python 3.12), SQLAlchemy (SQLite), Alembic (`NNNN_slug` revisions), httpx (+ `httpx.MockTransport` in tests), React 19 + Vite/TS, React Query, React Router v7, Radix + Tailwind 4. Generated `api.types.ts` via `pnpm gen:api`.

## Global Constraints

- **Single linear Alembic head.** Next revision is `0053_...`; `down_revision = "0052_duty_supervisors"`. Additive only; new tables, no `ALTER` on existing tables; SQLite-safe.
- **Type resync required after any backend schema/route change:** `venv\Scripts\python.exe -X utf8 scripts/dump_openapi.py` → `pnpm -C frontend run gen:api` → `tsc`. Commit `api.types.ts` ONLY — `backend/openapi.json` is GITIGNORED (do not `git add` it).
- **Bilingual parity mandatory** for all UI chrome (en/ar identical keys; no English leaking into Arabic); logical CSS (`ms-`/`me-`, `text-start`/`text-end`) + `dir="auto"` on free-text. The user-typed *message content* is free text (not translated). After touching UI/locales, run `i18n-rtl-reviewer`.
- **Ships dormant.** Group send is WhatsApp-only and requires `openwa_enabled=true` + a connected gateway (Phase 1 Task 1, still pending). With OpenWA disabled the page's group list is empty and send is refused — never falls back to SMS. Unit tests mock the transport.
- **Admin-gated:** every announcement route requires `require_capability("messages.broadcast")`. The frontend nav item + page are gated on the same capability.
- **OpenWA endpoints are best-effort/operator-verified.** `deploy/openwa/README.md` documents the *expected* REST shapes ("verify against live Swagger"). `list_groups`/`send-file` are added there as expected shapes; the transport maps errors to result dataclasses (never raises).
- **Strict gates:** `venv\Scripts\ruff.exe check` + `format --check` on touched files, `venv\Scripts\mypy.exe` (no NEW errors vs the 47 baseline), `venv\Scripts\python.exe -m pytest` (`filterwarnings=error`), `pnpm -C frontend test`, `pnpm -C frontend exec tsc -b --noEmit`.
- **Run Python via the repo venv:** `venv\Scripts\python.exe` etc. Body-size limit is 30 MiB (`MAX_BODY_BYTES`); attachments must stay under it.

## Verified codebase facts (do not re-derive)

- `openwa_client.py` (`backend/app/services/`): `send(phone, text) -> SendResult` posts `{"chatId": _chat_id(phone), "text": text}` to `POST {base}/api/sessions/{session}/messages/send-text`; `_chat_id(phone) = f"{phone.removeprefix('+')}@c.us"`; `_base()`, `_headers()` (X-API-Key), `_client()` (httpx, `_transport` overridable in tests), `SendResult{ok, message_id, error, not_registered}`. Success parses `data.get("id") or data.get("key",{}).get("id")`.
- Capabilities: `backend/app/core/permissions.py` — `CAPABILITIES: Final[tuple[Capability, ...]]` of `Capability(id, group, label, description)`; `CAPABILITY_IDS`/`ALL_CAPABILITIES = frozenset(all ids)`; `_OPERATOR_CAPS`, `_MANAGER_CAPS = _OPERATOR_CAPS | {...}`; `ROLE_CAPS = {OPERATOR: _OPERATOR_CAPS, MANAGER: _MANAGER_CAPS, ADMIN: ALL_CAPABILITIES}`. Adding an id to `CAPABILITIES` auto-grants ADMIN (via `ALL_CAPABILITIES`), NOT operator/manager.
- `require_capability("...")` (`backend/app/api/deps.py`) used as a `Depends`; `get_db` imported from `app.db.session`.
- Document PDF: `Document.pdf_path: str | None` (relative); absolute = `settings.data_dir / pdf_path`; `.read_bytes()`. Signed-lock swap via `book_service.is_document_signed_locked(db, document_id)` → serve `signed_rel` unless `original=True`. Companion PDFs merged via `merge_pdfs_to_bytes(...)`. All in `download_document` (`backend/app/api/v1/documents.py:369-559`) — mirror its resolution.
- Upload pattern: `upload: Annotated[UploadFile, File(alias="file")]`, `data = await upload.read()`; body limit `MAX_BODY_BYTES = 30*1024*1024` (`main.py:55`).
- Frontend: routes in `frontend/src/App.tsx` (`<Routes>`, ~199-246) using `<RequireCapability cap="...">`; nav in `frontend/src/components/shell/navItems.ts` (`NAV_ITEMS`) + gating in the nav component via `useCapabilities()` (`frontend/src/lib/useCapabilities.ts` → `.has(cap)`); `CapabilityGate` in `components/shell/`. api.ts: object methods via `request<T>('METHOD','/path',body?)` and `multipart<T>(path, FormData)` (`api.ts:767`). Latest migration `0052_duty_supervisors`.

---

### Task 1: `messages.broadcast` capability

**Files:**
- Modify: `backend/app/core/permissions.py` (add one `Capability(...)` to the `CAPABILITIES` tuple)
- Test: `backend/tests/test_permissions_messages_broadcast.py`

**Interfaces:**
- Produces: capability id `"messages.broadcast"`, group `"messages"`. In `ALL_CAPABILITIES` (so ADMIN role has it); NOT in `_OPERATOR_CAPS`/`_MANAGER_CAPS`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_permissions_messages_broadcast.py
from app.core import permissions as perm


def test_messages_broadcast_capability_registered():
    assert "messages.broadcast" in perm.CAPABILITY_IDS
    cap = next(c for c in perm.CAPABILITIES if c.id == "messages.broadcast")
    assert cap.group == "messages"


def test_messages_broadcast_admin_only_by_default():
    assert "messages.broadcast" in perm.ALL_CAPABILITIES          # admin
    assert "messages.broadcast" not in perm._OPERATOR_CAPS
    assert "messages.broadcast" not in perm._MANAGER_CAPS
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_permissions_messages_broadcast.py -v`
Expected: FAIL (`messages.broadcast` not in `CAPABILITY_IDS`).

- [ ] **Step 3: Add the capability**

In `backend/app/core/permissions.py`, add to the `CAPABILITIES` tuple (place near other admin-ish caps; match the existing `Capability(id, group, label, description)` shape):

```python
    Capability(
        "messages.broadcast",
        "messages",
        "Send group announcements",
        "Post announcements (text or a document) to WhatsApp groups.",
    ),
```

- [ ] **Step 4: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_permissions_messages_broadcast.py -v`
Expected: PASS. (If a test enumerates the full capability list elsewhere and now fails on count, update that fixture — it's asserting the registry.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/permissions.py backend/tests/test_permissions_messages_broadcast.py
git commit -m "feat(notify): messages.broadcast capability (admin group announcements)"
```

---

### Task 2: OpenWA transport — `send_to_chat`, `list_groups`, `send_file`

**Files:**
- Modify: `backend/app/services/openwa_client.py`
- Modify: `deploy/openwa/README.md` (document the two new expected endpoints)
- Test: `backend/tests/test_openwa_client_groups.py`

**Interfaces:**
- Produces:
  - `send_to_chat(chat_id: str, text: str) -> SendResult` — the core of `send`; posts `{"chatId": chat_id, "text": text}`. `send(phone, text)` now calls `send_to_chat(_chat_id(phone), text)` (behavior unchanged for phones).
  - `@dataclass(frozen=True) Group{ id: str, name: str }`.
  - `list_groups() -> list[Group]` — `GET {base}/api/sessions/{session}/groups`; parses a list of `{id/chatId, name/subject}`; returns `[]` on any error (never raises).
  - `send_file(chat_id: str, *, data: bytes, filename: str, caption: str) -> SendResult` — `POST {base}/api/sessions/{session}/messages/send-file` with `{"chatId", "file": <base64>, "filename", "caption"}`; success parses id like `send`; one transport retry.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_openwa_client_groups.py
import base64

import httpx

from app.services import openwa_client as wa


def _mock(handler):
    wa._transport = httpx.MockTransport(handler)


def teardown_function():
    wa._transport = None


def test_send_to_chat_posts_group_chat_id(monkeypatch):
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"] = str(req.url)
        seen["json"] = __import__("json").loads(req.content)
        return httpx.Response(200, json={"id": "G1"})

    _mock(handler)
    monkeypatch.setattr(wa, "get_settings", lambda: __import__("types").SimpleNamespace(
        openwa_api_base="http://x", openwa_api_key="k", openwa_session="s"))
    res = wa.send_to_chat("123-456@g.us", "hi")
    assert res.ok and res.message_id == "G1"
    assert seen["json"]["chatId"] == "123-456@g.us"   # group id passed verbatim, no @c.us
    assert "send-text" in seen["url"]


def test_send_still_wraps_phone_as_c_us(monkeypatch):
    seen = {}

    def handler(req):
        seen["json"] = __import__("json").loads(req.content)
        return httpx.Response(200, json={"id": "m1"})

    _mock(handler)
    monkeypatch.setattr(wa, "get_settings", lambda: __import__("types").SimpleNamespace(
        openwa_api_base="http://x", openwa_api_key="k", openwa_session="s"))
    wa.send("971500", "hi")
    assert seen["json"]["chatId"] == "971500@c.us"


def test_list_groups_parses(monkeypatch):
    def handler(req):
        return httpx.Response(200, json=[{"id": "1@g.us", "name": "Alpha"},
                                         {"id": "2@g.us", "name": "Bravo"}])

    _mock(handler)
    monkeypatch.setattr(wa, "get_settings", lambda: __import__("types").SimpleNamespace(
        openwa_api_base="http://x", openwa_api_key="k", openwa_session="s"))
    groups = wa.list_groups()
    assert [(g.id, g.name) for g in groups] == [("1@g.us", "Alpha"), ("2@g.us", "Bravo")]


def test_list_groups_empty_on_error(monkeypatch):
    _mock(lambda req: httpx.Response(500, text="boom"))
    monkeypatch.setattr(wa, "get_settings", lambda: __import__("types").SimpleNamespace(
        openwa_api_base="http://x", openwa_api_key="k", openwa_session="s"))
    assert wa.list_groups() == []


def test_send_file_posts_base64(monkeypatch):
    seen = {}

    def handler(req):
        seen["json"] = __import__("json").loads(req.content)
        return httpx.Response(200, json={"id": "f1"})

    _mock(handler)
    monkeypatch.setattr(wa, "get_settings", lambda: __import__("types").SimpleNamespace(
        openwa_api_base="http://x", openwa_api_key="k", openwa_session="s"))
    res = wa.send_file("1@g.us", data=b"PDFBYTES", filename="a.pdf", caption="see this")
    assert res.ok and res.message_id == "f1"
    assert base64.b64decode(seen["json"]["file"]) == b"PDFBYTES"
    assert seen["json"]["chatId"] == "1@g.us"
    assert seen["json"]["filename"] == "a.pdf"
    assert seen["json"]["caption"] == "see this"
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client_groups.py -v`
Expected: FAIL (`send_to_chat`/`list_groups`/`send_file` missing).

- [ ] **Step 3: Refactor `send` + add the new functions**

In `openwa_client.py`:

```python
@dataclass(frozen=True)
class Group:
    id: str
    name: str


def send_to_chat(chat_id: str, text: str) -> SendResult:
    """Send free-form text to any WhatsApp chat id (person @c.us or group @g.us)."""
    cfg = get_settings()
    url = f"{_base()}/api/sessions/{cfg.openwa_session}/messages/send-text"
    payload = {"chatId": chat_id, "text": text}
    last_err: str | None = None
    for attempt in range(2):
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
        not_reg = (
            resp.status_code == 422
            or "not a whatsapp" in body.casefold()
            or "not registered" in body.casefold()
        )
        return SendResult(ok=False, error=f"HTTP {resp.status_code}: {body}", not_registered=not_reg)
    return SendResult(ok=False, error=last_err or "network error")


def send(phone: str, text: str) -> SendResult:
    return send_to_chat(_chat_id(phone), text)


def list_groups() -> list[Group]:
    """Groups the connected number belongs to. Empty on any error (never raises)."""
    cfg = get_settings()
    url = f"{_base()}/api/sessions/{cfg.openwa_session}/groups"
    try:
        with _client() as c:
            resp = c.get(url, headers=_headers())
    except httpx.HTTPError as e:
        log.warning("openwa: list_groups transport error: %s", e)
        return []
    if resp.status_code // 100 != 2:
        return []
    data = resp.json() if resp.content else []
    rows = data.get("groups", data) if isinstance(data, dict) else data
    out: list[Group] = []
    for r in rows if isinstance(rows, list) else []:
        gid = r.get("id") or r.get("chatId") or r.get("_serialized")
        name = r.get("name") or r.get("subject") or gid
        if gid:
            out.append(Group(id=str(gid), name=str(name)))
    return out


def send_file(chat_id: str, *, data: bytes, filename: str, caption: str) -> SendResult:
    import base64

    cfg = get_settings()
    url = f"{_base()}/api/sessions/{cfg.openwa_session}/messages/send-file"
    payload = {
        "chatId": chat_id,
        "file": base64.b64encode(data).decode("ascii"),
        "filename": filename,
        "caption": caption,
    }
    last_err: str | None = None
    for _attempt in range(2):
        try:
            with _client() as c:
                resp = c.post(url, headers=_headers(), json=payload)
        except httpx.HTTPError as e:
            last_err = str(e) or e.__class__.__name__
            continue
        if resp.status_code // 100 == 2:
            d = resp.json() if resp.content else {}
            return SendResult(ok=True, message_id=d.get("id") or (d.get("key") or {}).get("id"))
        return SendResult(ok=False, error=f"HTTP {resp.status_code}: {resp.text}")
    return SendResult(ok=False, error=last_err or "network error")
```

Keep the existing `is_registered`/`get_ack`/`health`/`_chat_id` unchanged.

- [ ] **Step 4: Document the new endpoints in the README contract**

In `deploy/openwa/README.md`, add two rows to the expected-shapes table (mark as verify-against-Swagger like the others):

```
| List groups | `GET /api/sessions/{session}/groups` | `[ { "id": "<id>@g.us", "name": "<subject>" }, ... ]` |
| Send file   | `POST /api/sessions/{session}/messages/send-file` | `{ "chatId": "<id>", "file": "<base64>", "filename": "<name>", "caption": "<text>" }` → `{ "id": "..." }` |
```

- [ ] **Step 5: Run to verify pass + regression on existing openwa tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client_groups.py backend/tests/ -k openwa -v`
Expected: new tests PASS; existing `openwa_client` tests still PASS (the `send` refactor is behavior-preserving for phones).

- [ ] **Step 6: Ruff + commit**

Run: `venv\Scripts\ruff.exe check backend/app/services/openwa_client.py backend/tests/test_openwa_client_groups.py` and `format --check` the same.
```bash
git add backend/app/services/openwa_client.py backend/tests/test_openwa_client_groups.py deploy/openwa/README.md
git commit -m "feat(openwa): send_to_chat + list_groups + send_file transport"
```

---

### Task 3: `group_announcements` + `group_announcement_sends` tables + migration 0053

**Files:**
- Modify: `backend/app/db/models.py`
- Create: `backend/app/db/migrations/versions/0053_group_announcements.py`
- Test: `backend/tests/test_group_announcement_models.py`

**Interfaces:**
- Produces:
  - `GroupAnnouncement` (`group_announcements`): `id`, `body: str | None`, `attachment_kind: str` (`none`|`book`|`upload`), `attachment_name: str | None`, `book_id: int | None`, `sent_by: int | None`, `created_at`.
  - `GroupAnnouncementSend` (`group_announcement_sends`): `id`, `announcement_id: int` (FK omitted), `group_id: str`, `group_name: str`, `status: str` (`sent`|`failed`), `provider_msg_id: str | None`, `error: str | None`, `created_at`. Index on `announcement_id`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_group_announcement_models.py
from sqlalchemy import select

from app.db.models import GroupAnnouncement, GroupAnnouncementSend


def test_announcement_and_sends_roundtrip(db_session):
    ann = GroupAnnouncement(body="hello", attachment_kind="none", sent_by=1)
    db_session.add(ann)
    db_session.commit()
    db_session.add(GroupAnnouncementSend(
        announcement_id=ann.id, group_id="1@g.us", group_name="Alpha",
        status="sent", provider_msg_id="m1"))
    db_session.commit()
    got = db_session.scalar(select(GroupAnnouncementSend).where(
        GroupAnnouncementSend.announcement_id == ann.id))
    assert got.group_name == "Alpha" and got.status == "sent"
    assert ann.attachment_kind == "none" and ann.created_at is not None
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_group_announcement_models.py -v`
Expected: FAIL (ImportError).

- [ ] **Step 3: Add the models**

In `backend/app/db/models.py` (reuse existing imports: `Mapped`, `mapped_column`, `Integer`, `String`, `Text`, `DateTime`, `Index`, `_utcnow`, `Base`):

```python
class GroupAnnouncement(Base):
    """One compose action: a message (± attachment) posted to N WhatsApp groups."""

    __tablename__ = "group_announcements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_kind: Mapped[str] = mapped_column(String(16), default="none", server_default="none")
    attachment_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    book_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sent_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class GroupAnnouncementSend(Base):
    """One row per target group for a GroupAnnouncement (WhatsApp only)."""

    __tablename__ = "group_announcement_sends"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    announcement_id: Mapped[int] = mapped_column(Integer)  # FK omitted (app-side integrity)
    group_id: Mapped[str] = mapped_column(String(64))
    group_name: Mapped[str] = mapped_column(String(256))
    status: Mapped[str] = mapped_column(String(16))  # 'sent' | 'failed'
    provider_msg_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    __table_args__ = (Index("ix_group_announcement_sends_ann", "announcement_id"),)
```

- [ ] **Step 4: Create migration 0053**

```python
# backend/app/db/migrations/versions/0053_group_announcements.py
"""create group_announcements + group_announcement_sends

Revision ID: 0053
Revises: 0052_duty_supervisors
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0053"
down_revision = "0052_duty_supervisors"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "group_announcements",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("attachment_kind", sa.String(length=16), nullable=False, server_default="none"),
        sa.Column("attachment_name", sa.String(length=256), nullable=True),
        sa.Column("book_id", sa.Integer(), nullable=True),
        sa.Column("sent_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "group_announcement_sends",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("announcement_id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.String(length=64), nullable=False),
        sa.Column("group_name", sa.String(length=256), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("provider_msg_id", sa.String(length=128), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_group_announcement_sends_ann", "group_announcement_sends", ["announcement_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_group_announcement_sends_ann", table_name="group_announcement_sends")
    op.drop_table("group_announcement_sends")
    op.drop_table("group_announcements")
```

- [ ] **Step 5: Run test + alembic round-trip**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_group_announcement_models.py -v` → PASS.
Run: `venv\Scripts\alembic.exe upgrade head && venv\Scripts\alembic.exe downgrade -1 && venv\Scripts\alembic.exe upgrade head && venv\Scripts\alembic.exe heads` (dev/throwaway DB) → no errors, single head `0053`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/db/models.py backend/app/db/migrations/versions/0053_group_announcements.py backend/tests/test_group_announcement_models.py
git commit -m "feat(notify): group_announcements + sends tables (migration 0053)"
```

---

### Task 4: Book-PDF attachment resolver

**Files:**
- Create: `backend/app/services/announce_service.py`
- Test: `backend/tests/test_announce_book_pdf.py`

**Interfaces:**
- Consumes: `Book`/`Document` models, `book_service.is_document_signed_locked`, the companion-merge helper used by `download_document` (find it in `documents.py`, e.g. `merge_pdfs_to_bytes`), `get_settings().data_dir`.
- Produces: `resolve_book_pdf(db, book_id: int) -> tuple[str, bytes]` — `(filename, pdf_bytes)` for the book's current served PDF, mirroring `download_document`'s resolution (signed-lock swap; companion merge when applicable). Raises `BookPdfError` (a module exception) with a clear message when the book/document/pdf is missing.

- [ ] **Step 1: Read the reference resolution**

Read `backend/app/api/v1/documents.py:369-559` (`download_document`) and note EXACTLY how it: gets the current `Document` for a book, decides signed-vs-original (`book_service.is_document_signed_locked`), resolves the absolute path under `settings.data_dir`, performs the containment check, and reads bytes / merges companions (the helper name + call). Mirror this in the resolver. Also read how a `Book` exposes its current version/document (`book.versions[-1].document_id` or a `book_service` accessor).

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_announce_book_pdf.py
import pytest

from app.services import announce_service


def test_resolve_book_pdf_missing_raises(db_session):
    with pytest.raises(announce_service.BookPdfError):
        announce_service.resolve_book_pdf(db_session, 999999)
```
(A full happy-path test requires a generated book+PDF fixture. If the suite already has a book/PDF factory, add a happy-path case asserting `(filename.endswith(".pdf"), len(bytes) > 0)`; otherwise this error-path test plus the API test in Task 6 cover it — note the choice in your report.)

- [ ] **Step 3: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_announce_book_pdf.py -v`
Expected: FAIL (module/exception missing).

- [ ] **Step 4: Implement the resolver**

Create `announce_service.py` with `class BookPdfError(RuntimeError)` and `resolve_book_pdf(db, book_id)` mirroring the download resolution (reuse `book_service` + the merge helper; do NOT duplicate the containment check incorrectly — copy it faithfully). Return `(filename, bytes)` where `filename` is a sensible `f"{ref_number or book_id}.pdf"`.

- [ ] **Step 5: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_announce_book_pdf.py -v` → PASS.

- [ ] **Step 6: Ruff + commit**

```bash
git add backend/app/services/announce_service.py backend/tests/test_announce_book_pdf.py
git commit -m "feat(notify): resolve a book's served PDF bytes for attachment"
```

---

### Task 5: `announce_service` — list groups + send announcement

**Files:**
- Modify: `backend/app/services/announce_service.py`
- Test: `backend/tests/test_announce_service_send.py`

**Interfaces:**
- Consumes: `openwa_client` (as a module — `openwa_client.list_groups/send_to_chat/send_file`), `GroupAnnouncement`, `GroupAnnouncementSend`, `get_settings`.
- Produces:
  - `groups_available(db) -> list[openwa_client.Group]` — returns `openwa_client.list_groups()` when `openwa_enabled`, else `[]`.
  - `@dataclass Attachment{ filename: str, data: bytes }`.
  - `@dataclass GroupSendResult{ group_id, group_name, ok: bool, error: str | None }`.
  - `@dataclass AnnouncementResult{ announcement_id: int, sent: int, failed: int, results: list[GroupSendResult] }`.
  - `send_announcement(db, *, groups: list[tuple[str, str]], text: str, attachment: Attachment | None, book_id: int | None, sent_by: int | None) -> AnnouncementResult` — requires `openwa_enabled` (raise `NotifyDisabledError` otherwise — import from `notify_dispatch`); writes a `GroupAnnouncement` parent; for each `(group_id, group_name)`: if attachment → `openwa_client.send_file(group_id, data=..., filename=..., caption=text)` else `openwa_client.send_to_chat(group_id, text)`; write a `GroupAnnouncementSend` child per group; aggregate.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_announce_service_send.py
from types import SimpleNamespace

import pytest

from app.services import announce_service as a
from app.services import notify_dispatch


def _enabled(monkeypatch, on=True):
    monkeypatch.setattr(a, "get_settings", lambda: SimpleNamespace(openwa_enabled=on))


def test_send_text_to_each_group(db_session, monkeypatch):
    _enabled(monkeypatch)
    calls = []
    monkeypatch.setattr(a.openwa_client, "send_to_chat",
                        lambda cid, txt: (calls.append((cid, txt)) or SimpleNamespace(ok=True, message_id="m", error=None)))
    res = a.send_announcement(db_session, groups=[("1@g.us", "Alpha"), ("2@g.us", "Bravo")],
                              text="notice", attachment=None, book_id=None, sent_by=3)
    assert res.sent == 2 and res.failed == 0
    assert [c[0] for c in calls] == ["1@g.us", "2@g.us"]
    assert all(c[1] == "notice" for c in calls)


def test_send_file_when_attachment(db_session, monkeypatch):
    _enabled(monkeypatch)
    seen = {}
    monkeypatch.setattr(a.openwa_client, "send_file",
                        lambda cid, *, data, filename, caption: (seen.update(cid=cid, filename=filename, caption=caption, n=len(data)) or SimpleNamespace(ok=True, message_id="f", error=None)))
    res = a.send_announcement(db_session, groups=[("1@g.us", "Alpha")], text="see doc",
                              attachment=a.Attachment(filename="x.pdf", data=b"PDF"), book_id=None, sent_by=1)
    assert res.sent == 1
    assert seen == {"cid": "1@g.us", "filename": "x.pdf", "caption": "see doc", "n": 3}


def test_failed_group_recorded(db_session, monkeypatch):
    _enabled(monkeypatch)
    monkeypatch.setattr(a.openwa_client, "send_to_chat",
                        lambda cid, txt: SimpleNamespace(ok=False, message_id=None, error="HTTP 500"))
    res = a.send_announcement(db_session, groups=[("1@g.us", "Alpha")], text="x",
                              attachment=None, book_id=None, sent_by=None)
    assert res.sent == 0 and res.failed == 1
    assert res.results[0].error == "HTTP 500"


def test_disabled_raises(db_session, monkeypatch):
    _enabled(monkeypatch, on=False)
    with pytest.raises(notify_dispatch.NotifyDisabledError):
        a.send_announcement(db_session, groups=[("1@g.us", "Alpha")], text="x",
                            attachment=None, book_id=None, sent_by=None)
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_announce_service_send.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `announce_service.py`: import `openwa_client` and `notify_dispatch` (module refs so tests patch `a.openwa_client.*`), `get_settings`, the models, and `dataclass`/`field`. Implement `groups_available`, the dataclasses, and `send_announcement` per the interface — one `GroupAnnouncement` row (with `attachment_kind` = `"none"`/`"book"`/`"upload"` derived from `attachment`/`book_id`), then per-group send + `GroupAnnouncementSend` child, committing once at the end. Persist `provider_msg_id`/`error` from each `SendResult`.

- [ ] **Step 4: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_announce_service_send.py -v` → PASS (4 tests).

- [ ] **Step 5: Ruff + commit**

```bash
git add backend/app/services/announce_service.py backend/tests/test_announce_service_send.py
git commit -m "feat(notify): announce_service — group list + fan-out send with logging"
```

---

### Task 6: Announcements API — groups + send (multipart) + resync

**Files:**
- Create: `backend/app/schemas/announcement.py`
- Create: `backend/app/api/v1/announcements.py`
- Modify: `backend/app/main.py` (mount)
- Modify: `backend/openapi.json` (regenerated, NOT committed), `frontend/src/lib/api.types.ts`
- Test: `backend/tests/test_announcements_api.py`

**Interfaces:**
- Consumes: `announce_service`, `require_capability("messages.broadcast")`, `get_db`, `get_current_user`.
- Produces routes (prefix `/announcements`, all gated `messages.broadcast`):
  - `GET /groups` → `list[GroupOut{id, name}]` (from `announce_service.groups_available`).
  - `POST /send` — multipart form: `group_ids` (repeated form field), `text` (Form, may be empty if attachment present), `book_id` (Form, optional), `file` (UploadFile, optional). Resolves attachment: `file` → `Attachment(file.filename, await file.read())`; else `book_id` → `announce_service.resolve_book_pdf`; else none. At least one of `text`/attachment must be non-empty (422 otherwise). Returns `AnnouncementOut{announcement_id, sent, failed, results:[{group_id, group_name, ok, error}]}`. `group_names` for the send come from a fresh `groups_available` lookup keyed by id (so the log stores real names).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_announcements_api.py
# Reuse the admin-auth client fixtures pattern from backend/tests/test_duty_supervisors_api.py,
# but the admin user must have `messages.broadcast` (admin role has ALL caps, so the existing
# admin fixture already qualifies). `client` (manager) must be rejected.
from types import SimpleNamespace

from app.services import announce_service


def test_list_groups(admin_client, monkeypatch):
    monkeypatch.setattr(announce_service, "groups_available",
                        lambda db: [SimpleNamespace(id="1@g.us", name="Alpha")])
    r = admin_client.get("/api/v1/announcements/groups")
    assert r.status_code == 200
    assert r.json() == [{"id": "1@g.us", "name": "Alpha"}]


def test_send_text(admin_client, monkeypatch):
    monkeypatch.setattr(announce_service, "groups_available",
                        lambda db: [SimpleNamespace(id="1@g.us", name="Alpha")])
    monkeypatch.setattr(announce_service, "send_announcement",
                        lambda db, *, groups, text, attachment, book_id, sent_by: SimpleNamespace(
                            announcement_id=1, sent=1, failed=0,
                            results=[SimpleNamespace(group_id="1@g.us", group_name="Alpha", ok=True, error=None)]))
    r = admin_client.post("/api/v1/announcements/send",
                          data={"group_ids": ["1@g.us"], "text": "hi"})
    assert r.status_code == 200, r.text
    assert r.json()["sent"] == 1


def test_send_requires_text_or_attachment(admin_client, monkeypatch):
    monkeypatch.setattr(announce_service, "groups_available",
                        lambda db: [SimpleNamespace(id="1@g.us", name="Alpha")])
    r = admin_client.post("/api/v1/announcements/send", data={"group_ids": ["1@g.us"], "text": ""})
    assert r.status_code == 422


def test_send_requires_capability(client):
    r = client.post("/api/v1/announcements/send", data={"group_ids": ["1@g.us"], "text": "hi"})
    assert r.status_code in (401, 403)
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_announcements_api.py -v` → FAIL (404).

- [ ] **Step 3: Schemas**

```python
# backend/app/schemas/announcement.py
from __future__ import annotations

from pydantic import BaseModel


class GroupOut(BaseModel):
    id: str
    name: str


class GroupSendOut(BaseModel):
    group_id: str
    group_name: str
    ok: bool
    error: str | None = None


class AnnouncementOut(BaseModel):
    announcement_id: int
    sent: int
    failed: int
    results: list[GroupSendOut]
```

- [ ] **Step 4: Router**

Create `backend/app/api/v1/announcements.py` (prefix `/announcements`). `GET /groups` returns `[GroupOut(id=g.id, name=g.name) for g in announce_service.groups_available(db)]`. `POST /send` uses `group_ids: Annotated[list[str], Form()]`, `text: Annotated[str, Form()] = ""`, `book_id: Annotated[int | None, Form()] = None`, `file: Annotated[UploadFile | None, File()] = None`. Build the attachment (file → read bytes; elif book_id → `announce_service.resolve_book_pdf`, wrapping `BookPdfError` in a 422/404); require `text.strip() or attachment` (else `HTTPException(422)`); resolve `groups` = `[(g.id, g.name) for g in groups_available(db) if g.id in set(group_ids)]` (422 if none match); call `send_announcement(...)` with `sent_by=user.id`; map to `AnnouncementOut`. Mount in `main.py` mirroring the `duty_supervisors` include.

- [ ] **Step 5: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_announcements_api.py -v` → PASS.

- [ ] **Step 6: Resync types**

`venv\Scripts\python.exe -X utf8 scripts/dump_openapi.py` → `pnpm -C frontend run gen:api` → `pnpm -C frontend exec tsc -b --noEmit`. Confirm `GroupOut`/`AnnouncementOut`/`GroupSendOut` appear in `api.types.ts`. Do NOT commit `openapi.json`.

- [ ] **Step 7: Commit (tracked files only)**

```bash
git add backend/app/schemas/announcement.py backend/app/api/v1/announcements.py backend/app/main.py backend/tests/test_announcements_api.py frontend/src/lib/api.types.ts
git commit -m "feat(notify): announcements API (groups + multipart send) + resync"
```

---

### Task 7: Frontend — "Send to Group" page + route + nav + i18n

**Files:**
- Create: `frontend/src/pages/announcements/SendToGroupPage.tsx`
- Modify: `frontend/src/App.tsx` (route), `frontend/src/components/shell/navItems.ts` (nav item) + the nav component's capability gating
- Modify: `frontend/src/lib/api.ts` (`listGroups`, `sendAnnouncement`)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/pages/announcements/SendToGroupPage.test.tsx`

**Interfaces:**
- Consumes: `/announcements` API (Task 6); `useCapabilities().has('messages.broadcast')` for nav gating; `<RequireCapability cap="messages.broadcast">` for the route; `multipart()` helper for send.
- Produces: `<SendToGroupPage />` — live group multi-select (checkboxes from `listGroups`), a message `<textarea dir="auto">`, an attachment control (none | pick a book by id | upload a file), a confirm line ("Send to N groups"), submit, and a per-group result list. Bilingual chrome; the typed message is free text.

- [ ] **Step 1: Add i18n keys (both files, full parity)**

`sendToGroup` block: `title, subtitle, groups, noGroups, message, messagePlaceholder, attachment, attachNone, attachBook, attachUpload, bookIdLabel, confirm ("Send to {{count}} group(s)"), send, sending, resultSent ("Sent: {{count}}"), resultFailed ("Failed: {{count}}"), sendError, needContent ("Type a message or add an attachment"), pickGroup ("Select at least one group")`. Plus `nav.sendToGroup` for the nav label. Arabic values translated; identical placeholders. Mutation errors use a translated key (`sendError`), never a raw `apiErrorMessage`.

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/src/pages/announcements/SendToGroupPage.test.tsx  (mirror the harness in
// frontend/src/pages/dutyLocations/SupervisorDesignations.test.tsx)
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SendToGroupPage } from "./SendToGroupPage";

vi.mock("../../lib/api", () => ({
  api: {
    listGroups: vi.fn().mockResolvedValue([{ id: "1@g.us", name: "Alpha" }]),
    sendAnnouncement: vi.fn(),
  },
  apiErrorMessage: (e: unknown) => String(e),
}));

describe("SendToGroupPage", () => {
  it("lists groups from the gateway", async () => {
    renderWithProviders(<SendToGroupPage />);
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm -C frontend exec vitest run src/pages/announcements/SendToGroupPage.test.tsx` → FAIL (module missing).

- [ ] **Step 4: api.ts methods**

```ts
listGroups: () => request<GroupOut[]>('GET', '/announcements/groups'),
sendAnnouncement: (form: FormData) => multipart<AnnouncementOut>('/announcements/send', form),
```
Import the generated `GroupOut`/`AnnouncementOut` types as other schemas are imported at the top of `api.ts`.

- [ ] **Step 5: Implement the page**

`SendToGroupPage.tsx`: `useQuery(['announce-groups'], api.listGroups)` → checkbox list (empty state `noGroups` when `[]` — this also covers OpenWA-off). Message `<textarea dir="auto">`. Attachment radio: none / book (numeric `book_id` input) / upload (`<input type="file">`). Submit via `useMutation` building `FormData` (append each `group_ids`, `text`, optional `book_id`, optional `file`), calling `api.sendAnnouncement`; disable submit unless ≥1 group AND (message non-empty OR attachment present); on success render `resultSent`/`resultFailed` + per-group rows; on error `toast.error(t('sendToGroup.sendError'))`. Bilingual via `useTranslation`; logical CSS; `dir="auto"` on the message + any free-text.

- [ ] **Step 6: Route + nav**

- `App.tsx`: add `<Route path="/messages/broadcast" element={<RequireCapability cap="messages.broadcast"><SendToGroupPage /></RequireCapability>} />`.
- `navItems.ts`: add `{ to: '/messages/broadcast', key: 'nav.sendToGroup', Icon: MessageSquare }` (import `MessageSquare` from lucide).
- In the nav component that renders `NAV_ITEMS`, gate this item on `useCapabilities().has('messages.broadcast')` (follow how any existing capability-gated nav entry is hidden; if none, wrap the item render in the `has(...)` check).

- [ ] **Step 7: Typecheck + test**

Run: `pnpm -C frontend exec tsc -b --noEmit` → clean.
Run: `pnpm -C frontend exec vitest run src/pages/announcements/SendToGroupPage.test.tsx` → PASS.

- [ ] **Step 8: Bilingual review + commit**

Run `i18n-rtl-reviewer` on the diff; fix findings (translated error keys, parity, `dir="auto"`).
```bash
git add frontend/src/pages/announcements/ frontend/src/App.tsx frontend/src/components/shell/navItems.ts frontend/src/lib/api.ts frontend/src/locales/en.json frontend/src/locales/ar.json
# plus the nav component file you edited for gating
git commit -m "feat(notify): Send to Group page + route + nav (messages.broadcast)"
```

---

### Task 8: Finalization — gates + reviews + branch wrap-up

**Files:** none (verification + review only).

- [ ] **Step 1: Full backend gates** — `venv\Scripts\python.exe -m pytest` (all green); `venv\Scripts\mypy.exe` (no NEW errors vs 47 baseline); `ruff check` + `format --check` on all new/changed backend files.
- [ ] **Step 2: Full frontend gates** — `tsc -b --noEmit` clean; `pnpm -C frontend test` green; `pnpm -C frontend run lint` clean on touched files.
- [ ] **Step 3: Reviewer agents** — `alembic-migration-reviewer` (migration 0053); `i18n-rtl-reviewer` (SendToGroupPage + locales). Address findings.
- [ ] **Step 4: Whole-branch review** — `superpowers:requesting-code-review` on the full branch diff (opus); address blocking findings.
- [ ] **Step 5: Merge + push** — merge to `main`, regenerate `api.types.ts` if `main` advanced (never `checkout --ours`), run the full suite on `main`, push to `origin/main`. Ships dormant (needs `openwa_enabled` + a connected gateway).

---

## Self-Review (against the revised §2c intent)

- **Pick which existing groups to send to** → Task 2 `list_groups` + Task 6 `GET /groups` + Task 7 live checkbox list. **Type a message** → Task 7 textarea → Task 6 `text` → Task 5 `send_to_chat`. **Send my books / files** → Task 4 (book PDF resolver) + Task 5/6 attachment path + `send_file` (Task 2); "Both" sources (book id OR upload) handled in Task 6. **Admin-gated** → Task 1 capability + route/nav gating (Task 7). **Log per group** → Task 3 tables + Task 5 children.
- **Dropped from the original spec §2c (intentional):** audience selectors (unit/dept/role/status/manual), throttled pacing worker + per-broadcast/day cap, per-person fan-out, SMS fallback, test-send-to-self, per-person delivery dashboard, `messages.broadcast` on `outbound_messages`/`broadcasts` per-recipient rows. Group announcements need none of these (3 sends, WhatsApp-only, negligible ban risk).
- **Type consistency:** `openwa_client.Group{id,name}` (Task 2) → `groups_available` (Task 5) → `GroupOut` (Task 6) → `listGroups` (Task 7). `Attachment{filename,data}` + `send_announcement(...)` signature (Task 5) consumed by Task 6. `AnnouncementResult` (Task 5) → `AnnouncementOut` (Task 6) → page result (Task 7).
- **Known dependency:** live behavior is only verifiable once OpenWA is connected (Phase 1 Task 1). `list_groups`/`send-file` endpoint shapes are expected/README-documented and must be confirmed against the live gateway Swagger at activation; the transport degrades safely (empty group list, failed sends logged) if they differ.
