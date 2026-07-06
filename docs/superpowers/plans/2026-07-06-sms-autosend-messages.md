# SMS Auto-Send + Employee Messages Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-send the 7 HR service-form SMS on real generation (behind a master switch), drop the per-document button, and surface each employee's SMS history (with message text + sent/failed) in a new Messages tab.

**Architecture:** The generate background task calls a new best-effort `auto_send_for_book`, which reuses the existing `send_for_event` render→send→log path. `sms_messages` gains a `body` column so the actual sent text is auditable. A new app setting gates auto-send. The employee-detail payload gains `recent_sms`, rendered by a new Messages tab.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.x, Alembic, pytest (backend); React + TS, react-i18next, vitest (frontend).

## Global Constraints

- **Auto-send trigger:** only `generate_document(commit=True, revise_of_book_id=None)` with a mapped template + a bound employee. Never on preview (`commit=False`) or revision. Best-effort: a send failure must NEVER raise out of generation.
- **Gating order:** `cfg.sms_enabled` AND `settings.sms_autosend_enabled` (default True) AND template_id in the 7-map AND `book.employee_id` present.
- **The 7 template_id → event pairs (exact):** `"Salary Transfer Request"→salary_transfer`, `"Salary Deduction Form"→salary_deduction`, `"Employee Clearance Form"→employee_clearance`, `"HR Request Form"→hr_request`, `"Passport Release Form"→passport_release`, `"Warning Form"→warning`, `"Resignation Letter"→resignation`.
- **`sent_by = None`** for auto-sends (marks them system, distinct from manual button sends).
- **Body storage:** store the rendered text on success AND the intended text on failure (so failed sends are auditable). Existing rows: `body = NULL`.
- **Bilingual:** any new UI string (Messages tab label, status chips, settings toggle) needs `en.json` + `ar.json` keys — no English-only leaks.
- **Migration head is `0046_employee_passport_no_source`** — new revision `0047_sms_message_body` chains from it (verify with `alembic heads`).

---

### Task 1: Add `body` column to SmsMessage + migration

**Files:**
- Modify: `backend/app/db/models.py:427` (after `created_at` in `SmsMessage`)
- Create: `backend/app/db/migrations/versions/0047_sms_message_body.py`
- Test: `backend/tests/test_sms_model.py`

**Interfaces:**
- Produces: `SmsMessage.body: Mapped[str | None]` (nullable Text).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_sms_model.py`:

```python
def test_sms_message_has_body_column(db_session):
    from app.db.models import SmsMessage
    row = SmsMessage(employee_id="E1", event_type="warning", event_ref="warning:1",
                     language="ar", phone="+971500000000", status="sent",
                     body="عزيزي محمد أحمد،\n...")
    db_session.add(row); db_session.commit(); db_session.refresh(row)
    assert row.body.startswith("عزيزي")
```
(If `test_sms_model.py` lacks a `db_session` fixture/employee, mirror the row-construction style already in that file; `employee_id` need not FK-resolve for a column-presence test if the file's other tests don't enforce it — otherwise add an `Employee(id="E1", ...)` first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_sms_model.py::test_sms_message_has_body_column -v`
Expected: FAIL — `TypeError: 'body' is an invalid keyword argument for SmsMessage`.

- [ ] **Step 3: Add the column + migration**

In `backend/app/db/models.py`, in `SmsMessage` right after the `created_at` line:

```python
    # Full rendered SMS text (added 0047). Nullable: historical rows predate it.
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
```

Create `backend/app/db/migrations/versions/0047_sms_message_body.py`:

```python
"""add body column to sms_messages

Revision ID: 0047_sms_message_body
Revises: 0046_employee_passport_no_source
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0047_sms_message_body"
down_revision: str | Sequence[str] | None = "0046_employee_passport_no_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("sms_messages") as batch:
        batch.add_column(sa.Column("body", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sms_messages") as batch:
        batch.drop_column("body")
```

(First confirm the head: `cd backend && python -m alembic heads` — if it is not `0046_employee_passport_no_source`, set `down_revision` to the reported head.)

- [ ] **Step 4: Run test + apply migration**

Run: `cd backend && python -m pytest tests/test_sms_model.py::test_sms_message_has_body_column -v` → PASS
Run: `cd backend && python -m alembic upgrade head` → completes without error.

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/models.py backend/app/db/migrations/versions/0047_sms_message_body.py backend/tests/test_sms_model.py
git commit -m "feat(sms): add body column to sms_messages"
```

---

### Task 2: Persist the sent body on send

**Files:**
- Modify: `backend/app/services/sms_service.py` (`_log_row`, `send_for_event`)
- Test: `backend/tests/test_sms_service.py`

**Interfaces:**
- Consumes: `SmsMessage.body` (Task 1).
- Produces: `_log_row(..., body: str | None = None)`; `send_for_event` writes `body=text` on both the sent and failed paths.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_sms_service.py`:

```python
def test_send_persists_body(db_session, monkeypatch):
    _leave(db_session)  # existing helper: creates employee G1 + leave id 7
    monkeypatch.setattr(sms_client, "send",
                        lambda *a, **k: sms_client.SendResult(ok=True, message_id="m1"))
    row = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert row.body and row.body.startswith("عزيزي")  # ar default employee

def test_failed_send_still_persists_body(db_session, monkeypatch):
    _leave(db_session, contact="n/a")  # unparseable phone -> failed, client not called
    row = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert row.status == "failed"
    assert row.body and row.body.startswith("عزيزي")
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && python -m pytest tests/test_sms_service.py -k "persists_body" -v`
Expected: FAIL — `row.body` is `None`.

- [ ] **Step 3: Implement**

In `sms_service.py`, add `body` to `_log_row`:

```python
def _log_row(db, *, employee_id, event_type, record_id, language, phone,
             status, provider_msg_id=None, error=None, sent_by=None, body=None):
    row = SmsMessage(
        employee_id=employee_id,
        event_type=event_type,
        event_ref=f"{event_type}:{record_id}",
        language=language,
        phone=phone or "",
        status=status,
        provider_msg_id=provider_msg_id,
        error=error,
        sent_by=sent_by,
        body=body,
    )
    db.add(row); db.commit(); db.refresh(row)
    return row
```

In `send_for_event`, `text` is already rendered before the phone check. Pass `body=text` in BOTH `_log_row` calls (the no-phone `failed` path and the post-send path). Example for the send path:

```python
    return _log_row(
        db, employee_id=employee.id, event_type=event_type, record_id=record_id,
        language=lang, phone=phone,
        status="sent" if result.ok else "failed",
        provider_msg_id=result.message_id, error=result.error, sent_by=sent_by,
        body=text,
    )
```
and add `body=text` to the no-phone `_log_row(... status="failed" ...)` call above it.

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && python -m pytest tests/test_sms_service.py -k "persists_body" -v` → PASS
Run: `cd backend && python -m pytest tests/test_sms_service.py -q` → all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/sms_service.py backend/tests/test_sms_service.py
git commit -m "feat(sms): persist rendered body on every send attempt"
```

---

### Task 3: Backend template_id → event map

**Files:**
- Modify: `backend/app/services/notify_format.py`
- Test: `backend/tests/test_notify_format.py`

**Interfaces:**
- Produces: `TEMPLATE_EVENTS: dict[str, str]` mapping the 7 template_ids to their event constants.

- [ ] **Step 1: Write the failing test**

```python
def test_template_events_map():
    assert nf.TEMPLATE_EVENTS == {
        "Salary Transfer Request": nf.EVENT_SALARY_TRANSFER,
        "Salary Deduction Form": nf.EVENT_SALARY_DEDUCTION,
        "Employee Clearance Form": nf.EVENT_EMPLOYEE_CLEARANCE,
        "HR Request Form": nf.EVENT_HR_REQUEST,
        "Passport Release Form": nf.EVENT_PASSPORT_RELEASE,
        "Warning Form": nf.EVENT_WARNING,
        "Resignation Letter": nf.EVENT_RESIGNATION,
    }
    assert set(nf.TEMPLATE_EVENTS.values()) == nf.BOOK_EVENTS
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && python -m pytest tests/test_notify_format.py -k template_events_map -v` → FAIL (AttributeError).

- [ ] **Step 3: Implement**

In `notify_format.py`, after `BOOK_EVENTS`:

```python
# Book template_id -> SMS event. Keys match core.constants.TEMPLATE_FILES.
TEMPLATE_EVENTS: dict[str, str] = {
    "Salary Transfer Request": EVENT_SALARY_TRANSFER,
    "Salary Deduction Form": EVENT_SALARY_DEDUCTION,
    "Employee Clearance Form": EVENT_EMPLOYEE_CLEARANCE,
    "HR Request Form": EVENT_HR_REQUEST,
    "Passport Release Form": EVENT_PASSPORT_RELEASE,
    "Warning Form": EVENT_WARNING,
    "Resignation Letter": EVENT_RESIGNATION,
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && python -m pytest tests/test_notify_format.py -k template_events_map -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/notify_format.py backend/tests/test_notify_format.py
git commit -m "feat(sms): backend template_id -> event map"
```

---

### Task 4: `sms_autosend_enabled` app setting

**Files:**
- Modify: `backend/app/services/settings_service.py` (`_DEFAULTS`, `get_settings` raw dict, `update_settings` mapping)
- Modify: `backend/app/schemas/settings.py` (`AppSettingsRead`, `AppSettingsUpdate`)
- Test: `backend/tests/` (add `test_settings_sms_autosend.py`)

**Interfaces:**
- Produces: `AppSettingsRead.sms_autosend_enabled: bool` (default True); `AppSettingsUpdate.sms_autosend_enabled: bool | None`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_settings_sms_autosend.py`:

```python
from app.schemas.settings import AppSettingsUpdate
from app.services import settings_service as ss


def test_autosend_defaults_true(db_session):
    assert ss.get_settings(db_session).sms_autosend_enabled is True


def test_autosend_toggle_roundtrip(db_session):
    ss.update_settings(db_session, AppSettingsUpdate(sms_autosend_enabled=False))
    assert ss.get_settings(db_session).sms_autosend_enabled is False
    ss.update_settings(db_session, AppSettingsUpdate(sms_autosend_enabled=True))
    assert ss.get_settings(db_session).sms_autosend_enabled is True
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && python -m pytest tests/test_settings_sms_autosend.py -v` → FAIL (validation error: unknown field / missing attr).

- [ ] **Step 3: Implement (mirror the `sentry_opt_in` bool pattern exactly)**

- `settings_service.py` `_DEFAULTS`: add `"settings.sms_autosend_enabled": True,`
- `settings_service.py` `get_settings` raw dict (where `sentry_opt_in` is read): add
  `"sms_autosend_enabled": bool(_get(db, "settings.sms_autosend_enabled", True)),`
- `settings_service.py` `update_settings` `mapping`: add `"sms_autosend_enabled": "settings.sms_autosend_enabled",`
- `schemas/settings.py` `AppSettingsRead`: add `sms_autosend_enabled: bool`
- `schemas/settings.py` `AppSettingsUpdate`: add `sms_autosend_enabled: bool | None = None`

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && python -m pytest tests/test_settings_sms_autosend.py -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/settings_service.py backend/app/schemas/settings.py backend/tests/test_settings_sms_autosend.py
git commit -m "feat(sms): sms_autosend_enabled app setting (default on)"
```

---

### Task 5: `auto_send_for_book` (gated best-effort send)

**Files:**
- Modify: `backend/app/services/sms_service.py`
- Test: `backend/tests/test_sms_service.py`

**Interfaces:**
- Consumes: `nf.TEMPLATE_EVENTS` (Task 3), `settings_service.get_settings` (Task 4), the existing `send_for_event`.
- Produces: `auto_send_for_book(db, book_id: int, *, sent_by: int | None = None) -> SmsMessage | None` — returns None when gated off/unmapped/no-employee, else the logged `SmsMessage`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_sms_service.py` (reuse the Task-7-era Book/BookVersion/BookCategory construction from `test_load_book_event`):

```python
def _book(db, template_id, *, employee_id="E1"):
    from app.db.models import Book, BookVersion, BookCategory, Employee
    if db.get(Employee, employee_id) is None:
        db.add(Employee(id=employee_id, name_en="Mohammed Ahmed", name_ar="محمد أحمد",
                        contact="0501234567", msg_language="ar"))
    if db.get(BookCategory, "HR") is None:
        db.add(BookCategory(id="HR", prefix="HR"))
    db.flush()
    b = Book(category_id="HR", ref_number="HR-0001", employee_id=employee_id)
    db.add(b); db.flush()
    db.add(BookVersion(book_id=b.id, version_no=1, template_id=template_id,
                       fields={"bank_name": "بنك أبوظبي الأول"}))
    db.commit()
    return b


def test_auto_send_fires_for_mapped_template(db_session, monkeypatch):
    b = _book(db_session, "Salary Transfer Request")
    monkeypatch.setattr(sms_client, "send",
                        lambda *a, **k: sms_client.SendResult(ok=True, message_id="m1"))
    row = ss.auto_send_for_book(db_session, b.id)
    assert row is not None and row.status == "sent" and row.sent_by is None

def test_auto_send_skips_unmapped_template(db_session):
    b = _book(db_session, "General Book")
    assert ss.auto_send_for_book(db_session, b.id) is None

def test_auto_send_skips_when_setting_off(db_session, monkeypatch):
    from app.schemas.settings import AppSettingsUpdate
    from app.services import settings_service
    settings_service.update_settings(db_session, AppSettingsUpdate(sms_autosend_enabled=False))
    b = _book(db_session, "Salary Transfer Request")
    assert ss.auto_send_for_book(db_session, b.id) is None

def test_auto_send_skips_book_without_employee(db_session, monkeypatch):
    from app.db.models import Book, BookVersion, BookCategory
    if db_session.get(BookCategory, "HR") is None:
        db_session.add(BookCategory(id="HR", prefix="HR")); db_session.flush()
    b = Book(category_id="HR", ref_number="HR-0002", employee_id=None)
    db_session.add(b); db_session.flush()
    db_session.add(BookVersion(book_id=b.id, version_no=1, template_id="Warning Form", fields={}))
    db_session.commit()
    assert ss.auto_send_for_book(db_session, b.id) is None
```
(The autouse `_enable` fixture already sets `GSSG_SMS_ENABLED`. If a Book/BookCategory column is non-null and unset here, mirror whatever `test_load_book_event` already sets.)

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && python -m pytest tests/test_sms_service.py -k auto_send -v` → FAIL (`auto_send_for_book` undefined).

- [ ] **Step 3: Implement**

Add to `sms_service.py` (import `settings_service` and `get_settings` from config are already available; add `from app.services import settings_service` if not present):

```python
def auto_send_for_book(db: Session, book_id: int, *, sent_by: int | None = None) -> SmsMessage | None:
    """Best-effort automatic SMS for a freshly-generated service form.

    No-ops (returns None) unless SMS is enabled, auto-send is enabled, the
    book's latest version maps to an SMS event, and the book has an employee.
    """
    from app.services import settings_service

    cfg = get_settings()
    if not cfg.sms_enabled:
        return None
    if not settings_service.get_settings(db).sms_autosend_enabled:
        return None
    book = db.get(Book, book_id)
    if book is None or not book.versions or book.employee_id is None:
        return None
    event = nf.TEMPLATE_EVENTS.get(book.versions[-1].template_id or "")
    if event is None:
        return None
    return send_for_event(db, event, book_id, sent_by=sent_by)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && python -m pytest tests/test_sms_service.py -k auto_send -v` → PASS
Run: `cd backend && python -m pytest tests/test_sms_service.py -q` → all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/sms_service.py backend/tests/test_sms_service.py
git commit -m "feat(sms): auto_send_for_book gated best-effort helper"
```

---

### Task 6: Hook auto-send into the generate background task

**Files:**
- Modify: `backend/app/api/v1/documents.py` (`_run_generation`, after a successful `generate_document`)
- Test: `backend/tests/test_documents_autosend.py` (new)

**Interfaces:**
- Consumes: `sms_service.auto_send_for_book` (Task 5), `result.book_id`, `request.commit`, `request.revise_of_book_id`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_documents_autosend.py`. Rather than drive the full background pipeline, test the small guard helper you will extract. First define the intended helper name in the test:

```python
from app.api.v1 import documents as docs_api


def test_should_autosend_true_for_committed_initial():
    assert docs_api._should_autosend(commit=True, revise_of_book_id=None, book_id=5) is True

def test_should_autosend_false_for_preview():
    assert docs_api._should_autosend(commit=False, revise_of_book_id=None, book_id=5) is False

def test_should_autosend_false_for_revision():
    assert docs_api._should_autosend(commit=True, revise_of_book_id=9, book_id=5) is False

def test_should_autosend_false_without_book():
    assert docs_api._should_autosend(commit=True, revise_of_book_id=None, book_id=None) is False
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && python -m pytest tests/test_documents_autosend.py -v` → FAIL (`_should_autosend` undefined).

- [ ] **Step 3: Implement**

In `documents.py`, add the guard + the call inside `_run_generation` after `result = document_service.generate_document(...)`:

```python
def _should_autosend(*, commit: bool, revise_of_book_id: int | None, book_id: int | None) -> bool:
    return bool(commit) and revise_of_book_id is None and book_id is not None
```

Then, right after `result` is obtained (and before/independent of building `registry_docs`), add:

```python
        # Best-effort automatic employee SMS for generated service forms.
        # Must never break generation — the document is already committed.
        if _should_autosend(commit=request.commit,
                            revise_of_book_id=request.revise_of_book_id,
                            book_id=result.book_id):
            try:
                sms_service.auto_send_for_book(db, result.book_id, sent_by=None)
            except Exception:  # noqa: BLE001 - best-effort; log and continue
                log.exception("auto SMS failed for book %s", result.book_id)
```

Add the imports at the top of `documents.py` if missing: `from app.services import sms_service` and a module `log = logging.getLogger(__name__)` (reuse the file's existing logger if it has one).

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && python -m pytest tests/test_documents_autosend.py -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/documents.py backend/tests/test_documents_autosend.py
git commit -m "feat(sms): auto-send on committed initial generation"
```

---

### Task 7: `recent_sms` in employee detail

**Files:**
- Modify: `backend/app/schemas/employee_detail.py` (new `SmsMessageRead`, add field to `EmployeeDetailRead`)
- Modify: `backend/app/services/employee_detail_service.py` (query + pass `recent_sms`)
- Test: `backend/tests/test_employee_detail_sms.py` (new)

**Interfaces:**
- Produces: `EmployeeDetailRead.recent_sms: list[SmsMessageRead]`; `SmsMessageRead` fields: `id:int, event_type:str, body:str|None, phone:str, status:str, error:str|None, language:str, created_at:datetime`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_employee_detail_sms.py`:

```python
from app.db.models import SmsMessage
from app.services import employee_detail_service as eds


def test_detail_includes_recent_sms(db_session, make_employee):
    emp = make_employee(id="E9")  # use the suite's employee factory/fixture; else insert inline
    db_session.add(SmsMessage(employee_id="E9", event_type="warning", event_ref="warning:1",
                              language="ar", phone="+971500000000", status="sent",
                              body="عزيزي..."))
    db_session.commit()
    detail = eds.get_employee_detail(db_session, "E9")
    assert detail is not None
    assert len(detail.recent_sms) == 1
    assert detail.recent_sms[0].status == "sent"
    assert detail.recent_sms[0].body.startswith("عزيزي")
```
(If there is no `make_employee` fixture, insert an `Employee(id="E9", name_en=..., name_ar=...)` inline as other detail tests do.)

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && python -m pytest tests/test_employee_detail_sms.py -v` → FAIL (`recent_sms` missing).

- [ ] **Step 3: Implement**

In `schemas/employee_detail.py` add (near `ActivityItemRead`):

```python
class SmsMessageRead(BaseModel):
    id: int
    event_type: str
    body: str | None
    phone: str
    status: str
    error: str | None
    language: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
```
(Match the file's existing import style for `BaseModel`/`ConfigDict`/`datetime`.) Add to `EmployeeDetailRead`: `recent_sms: list[SmsMessageRead]`.

In `employee_detail_service.py`, before the `return sx.EmployeeDetailRead(...)`, query:

```python
    recent_sms = [
        sx.SmsMessageRead.model_validate(m)
        for m in db.scalars(
            select(SmsMessage)
            .where(SmsMessage.employee_id == emp.id)
            .order_by(SmsMessage.id.desc())
            .limit(50)
        )
    ]
```
Add `SmsMessage` to the models import and `select` if not already imported. Pass `recent_sms=recent_sms` into the `EmployeeDetailRead(...)` constructor.

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && python -m pytest tests/test_employee_detail_sms.py -v` → PASS
Run: `cd backend && python -m pytest tests/test_employee_detail*.py -q` → all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/employee_detail.py backend/app/services/employee_detail_service.py backend/tests/test_employee_detail_sms.py
git commit -m "feat(sms): expose recent employee SMS in employee detail"
```

---

### Task 8: Remove the SMS button from the document record

**Files:**
- Modify: `frontend/src/pages/books/BookRecordPage.tsx`
- Test: n/a (removal; covered by existing page tests staying green)

- [ ] **Step 1: Remove the block**

Delete the `SendSmsButton` render block (the `{book?.employee_id && current?.template_id && TEMPLATE_SMS_EVENTS[current.template_id] && (...)}` JSX in the header actions), the `TEMPLATE_SMS_EVENTS` const, and the now-unused `SendSmsButton` / `SmsEventType` imports in this file. Do NOT touch `SendSmsButton.tsx` itself or the leave/violation usages.

- [ ] **Step 2: Typecheck + tests**

Run: `cd frontend && npx tsc -b` → clean (no unused-import or missing-symbol errors).
Run: `cd frontend && npm test -- BookRecordPage` (if such a test exists; otherwise run the books test group) → green.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/books/BookRecordPage.tsx
git commit -m "feat(sms): drop per-document notify button (auto-send replaces it)"
```

---

### Task 9: Employee Messages tab

**Files:**
- Modify: `frontend/src/lib/api.ts` (add `SmsMessageRead`; add `recent_sms` to the employee-detail read type)
- Modify: `frontend/src/pages/employees/EmployeeDetailTabs.tsx` (`Tab` type + `ORDER` + counts)
- Create: `frontend/src/pages/employees/tabs/MessagesTab.tsx`
- Modify: `frontend/src/pages/employees/EmployeeDetailPage.tsx` (render the tab + count)
- Modify: `frontend/src/pages/employees/EmployeeQuickStats.tsx` (`StatTabTarget` add `'messages'`) — only if the union is shared; otherwise skip
- Modify: `frontend/src/locales/en.json` + `ar.json` (tab label + status chips + empty state)
- Test: `frontend/src/pages/employees/tabs/MessagesTab.test.tsx` (new)

**Interfaces:**
- Consumes: `EmployeeDetailRead.recent_sms: SmsMessageRead[]` (Task 7).
- Produces: `MessagesTab({ messages }: { messages: SmsMessageRead[] })`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/employees/tabs/MessagesTab.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }) }))
import { MessagesTab } from './MessagesTab'

const base = { id: 1, event_type: 'warning', phone: '+971500000000', language: 'ar', created_at: '2026-07-06T10:00:00Z' }

describe('MessagesTab', () => {
  it('renders a sent message with its body', () => {
    render(<MessagesTab messages={[{ ...base, body: 'عزيزي محمد', status: 'sent', error: null }]} />)
    expect(screen.getByText('عزيزي محمد')).toBeInTheDocument()
  })
  it('renders a failed message with its error', () => {
    render(<MessagesTab messages={[{ ...base, body: 'x', status: 'failed', error: 'No valid phone number' }]} />)
    expect(screen.getByText(/No valid phone number/)).toBeInTheDocument()
  })
  it('shows empty state', () => {
    render(<MessagesTab messages={[]} />)
    expect(screen.getByText('employee.messages.empty')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npm test -- MessagesTab` → FAIL (module not found).

- [ ] **Step 3: Implement**

Add to `api.ts`:

```typescript
export interface SmsMessageRead {
  id: number
  event_type: string
  body: string | null
  phone: string
  status: 'sent' | 'failed'
  error: string | null
  language: string
  created_at: string
}
```
Add `recent_sms: SmsMessageRead[]` to the employee-detail read interface (the type backing `get_employee_detail`; find it near `RecentDocumentRead`/`ActivityItemRead` in `api.ts`).

Create `MessagesTab.tsx` (mirror `ActivityTab.tsx` styling — timeline list, empty-state card):

```tsx
/** Messages tab — SMS notifications sent to this employee (sent / failed). */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, AlertTriangle } from 'lucide-react'
import type { SmsMessageRead } from '@/lib/api'

export function MessagesTab({ messages }: { messages: SmsMessageRead[] }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const fmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )
  if (messages.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-12 text-center text-muted-foreground">
        {t('employee.messages.empty')}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) => {
        const ok = m.status === 'sent'
        return (
          <div key={m.id} className="rounded-xl border border-hairline bg-surface p-4">
            <div className="mb-1.5 flex items-center gap-2 text-[0.78em]">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${ok ? 'bg-success-soft text-success' : 'bg-destructive/10 text-destructive'}`}>
                {ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {ok ? t('employee.messages.sent') : t('employee.messages.failed')}
              </span>
              <span className="font-mono text-muted-foreground">{m.phone}</span>
              <span className="ms-auto font-mono text-muted-foreground">{fmt.format(new Date(m.created_at))}</span>
            </div>
            {m.body && <div className="whitespace-pre-wrap text-[0.9em] text-foreground" dir="auto">{m.body}</div>}
            {!ok && m.error && <div className="mt-1 text-[0.8em] text-destructive">{m.error}</div>}
          </div>
        )
      })}
    </div>
  )
}
```

`EmployeeDetailTabs.tsx`: add `'messages'` to `Tab`, to `ORDER` (after `'activity'`), and to `Counts` (`messages: number`); the label uses `t('employee.tab.messages')`; count = `counts.messages`.

`EmployeeDetailPage.tsx`: import `MessagesTab`; add `messages: data.recent_sms.length` to the `counts` object; add `{tab === 'messages' && <MessagesTab messages={data.recent_sms} />}`.

`en.json` / `ar.json`: add
- `employee.tab.messages` = `"Messages"` / `"الرسائل"`
- `employee.messages.empty` = `"No messages sent yet."` / `"لا توجد رسائل مُرسَلة بعد."`
- `employee.messages.sent` = `"Sent"` / `"تم الإرسال"`
- `employee.messages.failed` = `"Failed"` / `"فشل"`

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npm test -- MessagesTab` → PASS
Run: `cd frontend && npx tsc -b` → clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/employees/EmployeeDetailTabs.tsx frontend/src/pages/employees/tabs/MessagesTab.tsx frontend/src/pages/employees/EmployeeDetailPage.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(sms): employee Messages tab (sent/failed history)"
```

---

### Task 10: Settings auto-send toggle (UI)

**Files:**
- Modify: the Settings page component (locate it: `frontend/src/pages/settings/…` — the one that renders the `sentry_opt_in` toggle and calls the settings update API)
- Modify: `frontend/src/lib/api.ts` (add `sms_autosend_enabled` to the settings read/update types)
- Modify: `frontend/src/locales/en.json` + `ar.json` (toggle label + hint)
- Test: extend the settings page test if one exists

- [ ] **Step 1: Add the type fields**

In `api.ts`, add `sms_autosend_enabled: boolean` to the settings read type and `sms_autosend_enabled?: boolean` to the update payload type (find them next to `sentry_opt_in`).

- [ ] **Step 2: Add the toggle**

In the Settings page, locate the `sentry_opt_in` toggle control and add a sibling toggle bound to `sms_autosend_enabled`, calling the same settings-update mutation with `{ sms_autosend_enabled: next }`. Label `t('settings.smsAutosend.label')`, hint `t('settings.smsAutosend.hint')`.

`en.json` / `ar.json`:
- `settings.smsAutosend.label` = `"Auto-send SMS on form generation"` / `"إرسال الرسائل تلقائياً عند إنشاء النموذج"`
- `settings.smsAutosend.hint` = `"When on, generating a service form texts the employee automatically."` / `"عند التفعيل، يؤدي إنشاء نموذج خدمة إلى إرسال رسالة نصية للموظف تلقائياً."`

- [ ] **Step 3: Typecheck + tests**

Run: `cd frontend && npx tsc -b` → clean.
Run: `cd frontend && npm test -- settings` (if a settings test exists) → green.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/settings frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(sms): settings toggle for SMS auto-send"
```

---

### Task 11: Make config-default tests robust to the live `.env`

**Files:**
- Modify: `backend/tests/test_sms_config.py`, `backend/tests/test_whatsapp_config.py`

- [ ] **Step 1: Reproduce the failure**

Run: `cd backend && python -m pytest tests/test_sms_config.py::test_sms_disabled_by_default tests/test_whatsapp_config.py -q`
Expected (on this live checkout): FAIL — defaults read `True` because pydantic loads the real `.env`.

- [ ] **Step 2: Fix — construct Settings without the dotenv file**

In `test_sms_disabled_by_default`, replace the `get_settings()`-based body with a direct construction that disables `.env` loading:

```python
def test_sms_disabled_by_default(monkeypatch):
    for k in ("GSSG_SMS_ENABLED", "GSSG_SMS_GATEWAY_URL", "GSSG_SMS_USERNAME", "GSSG_SMS_PASSWORD"):
        monkeypatch.delenv(k, raising=False)
    from app.config import Settings
    cfg = Settings(_env_file=None)  # ignore the live .env; assert true defaults
    assert cfg.sms_enabled is False
    assert cfg.sms_country_code == "971"
```
Apply the identical `Settings(_env_file=None)` change to `test_whatsapp_defaults_are_disabled_and_safe` in `test_whatsapp_config.py` (delenv the `GSSG_WHATSAPP_*` vars, then `Settings(_env_file=None)`, assert whatsapp defaults). Confirm `Settings` is importable from `app.config` (it is the `BaseSettings` subclass `get_settings()` returns).

- [ ] **Step 3: Verify pass (even with the live .env present)**

Run: `cd backend && python -m pytest tests/test_sms_config.py tests/test_whatsapp_config.py -q` → all pass.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_sms_config.py backend/tests/test_whatsapp_config.py
git commit -m "test(config): make disabled-by-default tests ignore the live .env"
```

---

### Task 12: Verification + i18n + docs

- [ ] **Step 1: Full backend suite** — `cd backend && python -m pytest tests/ -q` → all pass.
- [ ] **Step 2: Frontend** — `cd frontend && npx tsc -b && npm test` → typecheck clean, tests green.
- [ ] **Step 3: i18n review** — dispatch the i18n-rtl reviewer over the new/changed `en.json`+`ar.json` keys and `MessagesTab.tsx` for AR/EN parity and RTL (`dir="auto"` on the body). Fix findings inline.
- [ ] **Step 4: Docs** — in `deploy/SMS-SETUP.md`, replace the "manual button" description of the 7 service events with: they now **auto-send on form generation**, gated by the Settings "Auto-send SMS" toggle, and history shows on the employee's **Messages** tab. Commit.

```bash
git add deploy/SMS-SETUP.md
git commit -m "docs(sms): document auto-send + Messages tab"
```
