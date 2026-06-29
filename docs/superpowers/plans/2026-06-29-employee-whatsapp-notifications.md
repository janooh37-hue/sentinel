# Employee WhatsApp Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin push a bilingual (Arabic-default / English) WhatsApp confirmation to an employee's phone when a leave is approved, a duty resumption is filed, or a violation/warning is issued — triggered by a manual "Send to employee" button on each record.

**Architecture:** A WhatsApp notification subsystem isolated behind a thin transport client. A per-event template registry turns a record into ordered template parameters; a send service resolves the employee's phone (from the existing `contact` field, normalized to E.164) and language preference, calls the WhatsApp Cloud API, and logs every attempt to a `whatsapp_messages` table that powers the per-record "Sent ✓ / Failed" badge. No auto-triggers; every send is an explicit, capability-gated admin action.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0 (mapped_column), Alembic, httpx (already a dependency: `httpx>=0.27,<1.0`), pytest. Frontend: React + TypeScript, Zod, vitest, i18n via `locales/{ar,en}.json`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-29-employee-whatsapp-notifications-design.md` is the source of truth. The six message templates in §5 of the spec are authoritative copy.
- **Live server:** this checkout is the production server. Implement on a feature branch (`feature/employee-whatsapp-notifications`), not on `main`. Every merged change must be committed AND pushed to `origin/main` or a pull overwrites it.
- **Channel:** WhatsApp Business Cloud API (Meta Graph API), text-only template messages. Provider details live ONLY in `whatsapp_client.py`.
- **Phone:** reuse `Employee.contact`; normalize to E.164 at send time; default country code `971`. No migration/backfill of phone data.
- **Language:** per-employee `Employee.msg_language` (`'ar'` | `'en'`), default `'ar'`.
- **Bilingual labels:** leave/violation type strings are stored as `"English - عربي"`. Extract the English half with `partition(" - ")[0]`, the Arabic half with `partition(" - ")[2]` (fall back to the whole string).
- **Weekdays:** reuse `app.core.constants.ARABIC_WEEKDAYS` (Monday-first, matches `datetime.weekday()`). Define an English Monday-first list to match.
- **Signature line:** AR `إدارة مركز الإصلاح والتأهيل بالوثبة`, EN `Al Wathba Rehabilitation Centre`. These live in the WhatsApp templates registered in Meta, NOT appended in code (template messages are server-rendered by WhatsApp). Code supplies only the `{{n}}` body parameters.
- **Capability:** sending is gated behind `employees.notify`.
- **Event types (exact strings):** `"leave_approved"`, `"duty_resumption"`, `"violation"`.
- **Backend tests:** service-level tests use the `db_session` fixture (`backend/tests/conftest.py`); endpoint tests use the `api_db` + `_client` pattern from `backend/tests/test_permissions_api.py`. No real network calls — mock the client/httpx.

---

### Task 1: WhatsApp runtime config

**Files:**
- Modify: `backend/app/config.py` (add fields to the `Settings` class, after `secure_cookies` at line 64)
- Test: `backend/tests/test_whatsapp_config.py`

**Interfaces:**
- Produces: `Settings.whatsapp_enabled: bool`, `Settings.whatsapp_token: str`, `Settings.whatsapp_phone_number_id: str`, `Settings.whatsapp_api_base: str`, `Settings.whatsapp_country_code: str`. Read via `app.config.get_settings()`. Env vars are `GSSG_WHATSAPP_*` (the `env_prefix="GSSG_"` is already set).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_whatsapp_config.py
from app.config import Settings


def test_whatsapp_defaults_are_disabled_and_safe():
    s = Settings()
    assert s.whatsapp_enabled is False
    assert s.whatsapp_token == ""
    assert s.whatsapp_phone_number_id == ""
    assert s.whatsapp_api_base == "https://graph.facebook.com/v21.0"
    assert s.whatsapp_country_code == "971"


def test_whatsapp_env_override(monkeypatch):
    monkeypatch.setenv("GSSG_WHATSAPP_ENABLED", "1")
    monkeypatch.setenv("GSSG_WHATSAPP_TOKEN", "tok123")
    monkeypatch.setenv("GSSG_WHATSAPP_PHONE_NUMBER_ID", "55500011122")
    s = Settings()
    assert s.whatsapp_enabled is True
    assert s.whatsapp_token == "tok123"
    assert s.whatsapp_phone_number_id == "55500011122"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_whatsapp_config.py -v`
Expected: FAIL with `AttributeError` / missing fields.

- [ ] **Step 3: Add the config fields**

In `backend/app/config.py`, inside `class Settings`, immediately after the `secure_cookies: bool = False` line:

```python
    # --- WhatsApp Business Cloud API (employee notifications) ----------------
    # All GSSG_WHATSAPP_* env vars. Disabled by default so the "Send" button is
    # hidden until an operator provisions a token + phone-number-id.
    whatsapp_enabled: bool = False
    whatsapp_token: str = ""              # Meta permanent access token (secret)
    whatsapp_phone_number_id: str = ""    # the WhatsApp Business phone-number id
    whatsapp_api_base: str = "https://graph.facebook.com/v21.0"
    whatsapp_country_code: str = "971"    # default CC for normalizing contact
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_whatsapp_config.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/tests/test_whatsapp_config.py
git commit -m "feat(whatsapp): runtime config for WhatsApp Cloud API"
```

---

### Task 2: Phone normalization to E.164

**Files:**
- Create: `backend/app/core/phone.py`
- Test: `backend/tests/test_phone.py`

**Interfaces:**
- Produces: `normalize_phone(raw: str | None, default_cc: str = "971") -> str | None` — returns an E.164 string like `"+9715XXXXXXXX"`, or `None` when the input has no usable digits / is too short.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_phone.py
import pytest

from app.core.phone import normalize_phone


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("0501234567", "+971501234567"),       # local mobile, leading 0
        ("971501234567", "+971501234567"),     # bare with CC
        ("+971 50 123 4567", "+971501234567"), # already E.164, spaces
        ("00971501234567", "+971501234567"),   # international 00 prefix
        ("050-123-4567", "+971501234567"),     # dashes
        ("501234567", "+971501234567"),        # local without leading 0
    ],
)
def test_normalizes_uae_numbers(raw, expected):
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "   ", "abc", "12", "n/a"])
def test_rejects_unusable(raw):
    assert normalize_phone(raw) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_phone.py -v`
Expected: FAIL with `ModuleNotFoundError: app.core.phone`.

- [ ] **Step 3: Implement the normalizer**

```python
# backend/app/core/phone.py
"""Normalize free-text phone numbers (Employee.contact) to E.164 for WhatsApp.

The contact field is operator-entered and inconsistent (``05x``, ``+971…``,
spaces, dashes). WhatsApp requires E.164. We assume a default country code
(UAE ``971``) when none is present. Returns ``None`` when there are no usable
digits or the result is implausibly short, so callers fail loud rather than
sending to a garbage number.
"""

from __future__ import annotations

import re

_MIN_DIGITS = 8  # below this it cannot be a real international number


def normalize_phone(raw: str | None, default_cc: str = "971") -> str | None:
    if not raw:
        return None
    s = re.sub(r"[^\d+]", "", raw)
    if not s:
        return None
    if s.startswith("00"):          # 00971… → +971…
        s = "+" + s[2:]
    if s.startswith("+"):
        digits = s[1:]
        return "+" + digits if digits.isdigit() and len(digits) >= _MIN_DIGITS else None
    # No '+': bare digits. Decide whether the CC is already present.
    if s.startswith(default_cc):
        return "+" + s if len(s) >= _MIN_DIGITS else None
    if s.startswith("0"):           # local with trunk 0 → drop it, prepend CC
        s = s[1:]
    if len(s) < 6:                  # local part too short to be real
        return None
    return "+" + default_cc + s
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_phone.py -v`
Expected: PASS (all parametrized cases).

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/phone.py backend/tests/test_phone.py
git commit -m "feat(whatsapp): E.164 phone normalization helper"
```

---

### Task 3: Data model — `msg_language` + `whatsapp_messages`

**Files:**
- Modify: `backend/app/db/models.py` (add `msg_language` to `Employee` ~line 81; add `WhatsAppMessage` class after `Violation`, ~line 358)
- Create: `backend/app/db/migrations/versions/0042_whatsapp_notifications.py`
- Modify: `backend/app/schemas/employee.py` (add `msg_language` to `EmployeeCreate`, `EmployeeUpdate`, `EmployeeRead`)
- Test: `backend/tests/test_whatsapp_model.py`

**Interfaces:**
- Produces: `Employee.msg_language: str` (default `"ar"`). `WhatsAppMessage` ORM model with columns: `id, employee_id, event_type, event_ref, language, phone, template, status, provider_msg_id, error, sent_by, created_at`. Migration revision id `0042_whatsapp_notifications`, down_revision `0041_push_notify_state`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_whatsapp_model.py
from app.db.models import Employee, WhatsAppMessage


def test_employee_msg_language_defaults_to_ar(db_session):
    emp = Employee(id="G9001", name_en="Test", contact="0501234567")
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)
    assert emp.msg_language == "ar"


def test_whatsapp_message_row_roundtrips(db_session):
    db_session.add(Employee(id="G9002", name_en="Test2"))
    db_session.commit()
    msg = WhatsAppMessage(
        employee_id="G9002",
        event_type="leave_approved",
        event_ref="leave_approved:7",
        language="ar",
        phone="+971501234567",
        template="leave_approved_ar",
        status="sent",
        provider_msg_id="wamid.X",
        sent_by=1,
    )
    db_session.add(msg)
    db_session.commit()
    db_session.refresh(msg)
    assert msg.id is not None
    assert msg.error is None
    assert msg.created_at is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_whatsapp_model.py -v`
Expected: FAIL with `ImportError: cannot import name 'WhatsAppMessage'`.

- [ ] **Step 3a: Add the `msg_language` column to `Employee`**

In `backend/app/db/models.py`, inside `class Employee`, immediately after the `contact: Mapped[str | None] = mapped_column(String(64), nullable=True)` line (line 81):

```python
    # Preferred WhatsApp-notification language ('ar' | 'en'). Default Arabic;
    # operators flip the few non-Arabic speakers to 'en' in the employee form.
    msg_language: Mapped[str] = mapped_column(
        String(2), default="ar", server_default="ar"
    )
```

- [ ] **Step 3b: Add the `WhatsAppMessage` model**

In `backend/app/db/models.py`, after the `Violation` class (after line 358, before `class Manager`):

```python
class WhatsAppMessage(Base):
    """One WhatsApp send attempt (success or failure) for an employee.

    Powers the per-record "Sent ✓ / Failed" badge and is the audit trail.
    ``event_ref`` is a stable per-record key (``"<event_type>:<id>"``) so a
    record's send history is queryable without touching the source row.
    Re-sends are first-class: each attempt is its own row.
    """

    __tablename__ = "whatsapp_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"))
    event_type: Mapped[str] = mapped_column(String(32))
    event_ref: Mapped[str] = mapped_column(String(64))
    language: Mapped[str] = mapped_column(String(2))
    phone: Mapped[str] = mapped_column(String(32))
    template: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))  # 'sent' | 'failed'
    provider_msg_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    __table_args__ = (
        Index("ix_whatsapp_messages_event", "event_type", "event_ref"),
    )
```

- [ ] **Step 3c: Add `msg_language` to the employee schemas**

In `backend/app/schemas/employee.py`:

Add a shared literal near the status constants (after `EMPLOYEE_STATUSES` definition):
```python
MsgLanguage = Literal["ar", "en"]
```

In `EmployeeCreate`, add after the `contact` field:
```python
    msg_language: MsgLanguage = "ar"
```

In `EmployeeUpdate`, add (it uses all-optional fields):
```python
    msg_language: MsgLanguage | None = None
```

In `EmployeeRead` (the ORM-backed read model further down the file), add:
```python
    msg_language: str = "ar"
```

- [ ] **Step 3d: Write the migration**

```python
# backend/app/db/migrations/versions/0042_whatsapp_notifications.py
"""WhatsApp notifications — employee language pref + send log.

Revision ID: 0042_whatsapp_notifications
Revises: 0041_push_notify_state
Create Date: 2026-06-29

Adds:
- ``employees.msg_language`` — preferred WhatsApp message language ('ar'|'en'),
  default 'ar'.
- ``whatsapp_messages`` — one row per send attempt (audit + "Sent" badge).

Additive only; downgrade reverses both.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0042_whatsapp_notifications"
down_revision: str | Sequence[str] | None = "0041_push_notify_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.add_column(
            sa.Column(
                "msg_language",
                sa.String(length=2),
                nullable=False,
                server_default="ar",
            )
        )
    op.create_table(
        "whatsapp_messages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "employee_id",
            sa.String(length=16),
            sa.ForeignKey("employees.id"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("event_ref", sa.String(length=64), nullable=False),
        sa.Column("language", sa.String(length=2), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("template", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("provider_msg_id", sa.String(length=128), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("sent_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
    )
    op.create_index(
        "ix_whatsapp_messages_event",
        "whatsapp_messages",
        ["event_type", "event_ref"],
    )


def downgrade() -> None:
    op.drop_index("ix_whatsapp_messages_event", table_name="whatsapp_messages")
    op.drop_table("whatsapp_messages")
    with op.batch_alter_table("employees") as batch:
        batch.drop_column("msg_language")
```

- [ ] **Step 4: Run tests + migration check**

Run: `cd backend && python -m pytest tests/test_whatsapp_model.py -v`
Expected: PASS (2 passed).

Run: `cd backend && python -m alembic upgrade head`
Expected: applies `0042_whatsapp_notifications` with no error (or "already up to date" if the live DB already has it — on a fresh test DB it should run clean).

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/models.py backend/app/schemas/employee.py backend/app/db/migrations/versions/0042_whatsapp_notifications.py backend/tests/test_whatsapp_model.py
git commit -m "feat(whatsapp): msg_language column + whatsapp_messages table"
```

---

### Task 4: Template registry — copy → ordered params

**Files:**
- Create: `backend/app/services/whatsapp_templates.py`
- Test: `backend/tests/test_whatsapp_templates.py`

**Interfaces:**
- Consumes: `Employee`, `Leave`, `Violation` ORM models; `app.core.constants.ARABIC_WEEKDAYS`.
- Produces:
  - `EVENT_LEAVE_APPROVED = "leave_approved"`, `EVENT_DUTY_RESUMPTION = "duty_resumption"`, `EVENT_VIOLATION = "violation"`.
  - `render(event_type: str, language: str, record, employee) -> tuple[str, list[str]]` — returns `(template_name, params)`. `template_name` is `f"{event_type}_{language}"`. Raises `KeyError` for an unknown `event_type`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_whatsapp_templates.py
from datetime import date

from app.db.models import Employee, Leave, Violation
from app.services import whatsapp_templates as wt


def _emp(**kw):
    base = dict(id="G1", name_en="John Smith", name_ar="جون سميث", msg_language="ar")
    base.update(kw)
    return Employee(**base)


def test_leave_approved_arabic_params():
    emp = _emp()
    leave = Leave(
        id=7, employee_id="G1", leave_type="Annual Leave - إجازة سنوية",
        start_date=date(2026, 7, 5), end_date=date(2026, 7, 9), days=5,
        status="Approved",
    )
    name, params = wt.render("leave_approved", "ar", leave, emp)
    assert name == "leave_approved_ar"
    # name(ar), type(ar), start, start-weekday, end, end-weekday, days
    assert params == [
        "جون سميث", "إجازة سنوية",
        "05/07/2026", "الأحد",
        "09/07/2026", "الخميس",
        "5",
    ]


def test_leave_approved_english_uses_english_half_and_name():
    emp = _emp(msg_language="en")
    leave = Leave(
        id=7, employee_id="G1", leave_type="Annual Leave - إجازة سنوية",
        start_date=date(2026, 7, 5), end_date=date(2026, 7, 9), days=5,
    )
    name, params = wt.render("leave_approved", "en", leave, emp)
    assert name == "leave_approved_en"
    assert params[0] == "John Smith"
    assert params[1] == "Annual Leave"
    assert params[3] == "Sunday"


def test_duty_resumption_params():
    emp = _emp()
    leave = Leave(id=7, employee_id="G1", leave_type="Annual - سنوية",
                  start_date=date(2026, 7, 5), end_date=date(2026, 7, 9),
                  return_date=date(2026, 7, 10))
    name, params = wt.render("duty_resumption", "ar", leave, emp)
    assert name == "duty_resumption_ar"
    assert params == ["جون سميث", "10/07/2026", "الجمعة"]


def test_violation_params_falls_back_to_deduction_when_no_action():
    emp = _emp(msg_language="en")
    v = Violation(id=3, employee_id="G1",
                  violation_type="Sleeping on Duty - النوم أثناء الخدمة",
                  date=date(2026, 7, 1), action_taken=None, deduction_days=2)
    name, params = wt.render("violation", "en", v, emp)
    assert name == "violation_en"
    assert params[0] == "John Smith"
    assert params[1] == "Sleeping on Duty"
    assert params[2] == "01/07/2026"
    assert params[4] == "2 day(s) deduction"


def test_unknown_event_raises():
    import pytest
    with pytest.raises(KeyError):
        wt.render("nope", "ar", None, _emp())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_whatsapp_templates.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement the registry**

```python
# backend/app/services/whatsapp_templates.py
"""Map an HR event + record to a WhatsApp template name and ordered params.

WhatsApp business-initiated messages use templates pre-registered in Meta with
positional ``{{1}}`` variables. This module is the single source of truth for
which template fires per (event, language) and the EXACT order of body params.
The order here MUST match the registered template. The signature line is part
of the registered template body, so it is not produced here.
"""

from __future__ import annotations

from datetime import date

from app.core.constants import ARABIC_WEEKDAYS
from app.db.models import Employee

EVENT_LEAVE_APPROVED = "leave_approved"
EVENT_DUTY_RESUMPTION = "duty_resumption"
EVENT_VIOLATION = "violation"

# Monday-first to match datetime.weekday() and ARABIC_WEEKDAYS' ordering.
ENGLISH_WEEKDAYS: tuple[str, ...] = (
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
)


def _english_part(value: str) -> str:
    return value.partition(" - ")[0].strip() or value.strip()


def _arabic_part(value: str) -> str:
    return value.partition(" - ")[2].strip() or value.strip()


def _type_label(value: str, lang: str) -> str:
    return _arabic_part(value) if lang == "ar" else _english_part(value)


def _name(emp: Employee, lang: str) -> str:
    if lang == "ar":
        return emp.name_ar or emp.name_en
    return emp.name_en or emp.name_ar or ""


def _fmt_date(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def _weekday(d: date, lang: str) -> str:
    table = ARABIC_WEEKDAYS if lang == "ar" else ENGLISH_WEEKDAYS
    return table[d.weekday()]


def _action_text(action_taken: str | None, deduction_days: int, lang: str) -> str:
    if action_taken and action_taken.strip():
        return action_taken.strip()
    if deduction_days:
        return (
            f"خصم {deduction_days} يوم" if lang == "ar"
            else f"{deduction_days} day(s) deduction"
        )
    return "—"


def _build_leave_approved(leave, emp: Employee, lang: str) -> list[str]:
    return [
        _name(emp, lang),
        _type_label(leave.leave_type, lang),
        _fmt_date(leave.start_date), _weekday(leave.start_date, lang),
        _fmt_date(leave.end_date), _weekday(leave.end_date, lang),
        str(leave.days),
    ]


def _build_duty_resumption(leave, emp: Employee, lang: str) -> list[str]:
    d = leave.return_date or leave.end_date
    return [_name(emp, lang), _fmt_date(d), _weekday(d, lang)]


def _build_violation(v, emp: Employee, lang: str) -> list[str]:
    return [
        _name(emp, lang),
        _type_label(v.violation_type, lang),
        _fmt_date(v.date), _weekday(v.date, lang),
        _action_text(v.action_taken, v.deduction_days, lang),
    ]


_BUILDERS = {
    EVENT_LEAVE_APPROVED: _build_leave_approved,
    EVENT_DUTY_RESUMPTION: _build_duty_resumption,
    EVENT_VIOLATION: _build_violation,
}


def render(event_type: str, language: str, record, employee: Employee) -> tuple[str, list[str]]:
    """Return ``(template_name, params)`` for an event. KeyError on unknown event."""
    builder = _BUILDERS[event_type]
    lang = "ar" if language == "ar" else "en"
    params = builder(record, employee, lang)
    return f"{event_type}_{lang}", params
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_whatsapp_templates.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/whatsapp_templates.py backend/tests/test_whatsapp_templates.py
git commit -m "feat(whatsapp): per-event template param registry"
```

---

### Task 5: WhatsApp transport client

**Files:**
- Create: `backend/app/services/whatsapp_client.py`
- Test: `backend/tests/test_whatsapp_client.py`

**Interfaces:**
- Consumes: `app.config.get_settings()`, `httpx`.
- Produces:
  - `@dataclass(frozen=True) class SendResult: ok: bool; message_id: str | None = None; error: str | None = None`.
  - `send_text(phone: str, template_name: str, lang: str, params: list[str]) -> SendResult` — POSTs a template message to the Cloud API, retries once on network/timeout, maps API errors to `SendResult(ok=False, error=...)`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_whatsapp_client.py
import httpx
import pytest

from app.services import whatsapp_client as wc


def _settings(monkeypatch):
    monkeypatch.setenv("GSSG_WHATSAPP_TOKEN", "tok")
    monkeypatch.setenv("GSSG_WHATSAPP_PHONE_NUMBER_ID", "PNID")
    from app.config import get_settings
    get_settings.cache_clear()
    return get_settings()


def test_send_text_success_builds_template_payload(monkeypatch):
    _settings(monkeypatch)
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        import json
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"messages": [{"id": "wamid.ABC"}]})

    monkeypatch.setattr(wc, "_transport", httpx.MockTransport(handler))
    res = wc.send_text("+971501234567", "leave_approved_ar", "ar", ["A", "B"])
    assert res.ok is True
    assert res.message_id == "wamid.ABC"
    assert captured["url"].endswith("/PNID/messages")
    assert captured["auth"] == "Bearer tok"
    body = captured["body"]
    assert body["to"] == "971501234567"            # no leading +
    assert body["type"] == "template"
    assert body["template"]["name"] == "leave_approved_ar"
    assert body["template"]["language"]["code"] == "ar"
    texts = [p["text"] for p in body["template"]["components"][0]["parameters"]]
    assert texts == ["A", "B"]


def test_send_text_api_error_maps_message(monkeypatch):
    _settings(monkeypatch)

    def handler(request):
        return httpx.Response(400, json={"error": {"message": "Invalid number"}})

    monkeypatch.setattr(wc, "_transport", httpx.MockTransport(handler))
    res = wc.send_text("+9710000", "leave_approved_en", "en", ["X"])
    assert res.ok is False
    assert "Invalid number" in res.error


def test_send_text_retries_once_then_fails(monkeypatch):
    _settings(monkeypatch)
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(wc, "_transport", httpx.MockTransport(handler))
    res = wc.send_text("+971501234567", "violation_en", "en", ["X"])
    assert res.ok is False
    assert calls["n"] == 2  # initial + one retry
    assert "boom" in res.error or "connect" in res.error.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_whatsapp_client.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement the client**

```python
# backend/app/services/whatsapp_client.py
"""Thin transport to the WhatsApp Business Cloud API (Meta Graph).

The ONLY module that knows the provider's HTTP shape — swap this out to move to
a BSP. Sends a pre-registered *template* message (business-initiated messages
must use templates). One retry on network/timeout; API errors are mapped to a
``SendResult`` so callers never see a raw exception.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(10.0)
# Overridable in tests via monkeypatch (httpx.MockTransport).
_transport: httpx.BaseTransport | None = None


@dataclass(frozen=True)
class SendResult:
    ok: bool
    message_id: str | None = None
    error: str | None = None


def _post(url: str, headers: dict, payload: dict) -> httpx.Response:
    with httpx.Client(transport=_transport, timeout=_TIMEOUT) as client:
        return client.post(url, headers=headers, json=payload)


def send_text(phone: str, template_name: str, lang: str, params: list[str]) -> SendResult:
    cfg = get_settings()
    url = f"{cfg.whatsapp_api_base}/{cfg.whatsapp_phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {cfg.whatsapp_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": phone.lstrip("+"),
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": "ar" if lang == "ar" else "en"},
            "components": [
                {
                    "type": "body",
                    "parameters": [{"type": "text", "text": p} for p in params],
                }
            ],
        },
    }

    last_err: str | None = None
    for attempt in range(2):  # initial + one retry on transport error
        try:
            resp = _post(url, headers, payload)
        except httpx.HTTPError as e:
            last_err = str(e) or e.__class__.__name__
            log.warning("whatsapp: transport error (attempt %d): %s", attempt + 1, last_err)
            continue
        if resp.status_code // 100 == 2:
            data = resp.json()
            msg_id = (data.get("messages") or [{}])[0].get("id")
            return SendResult(ok=True, message_id=msg_id)
        # Non-2xx: extract Meta's error message, do not retry (it's a real reject).
        try:
            err = resp.json().get("error", {}).get("message") or resp.text
        except ValueError:
            err = resp.text
        return SendResult(ok=False, error=f"HTTP {resp.status_code}: {err}")
    return SendResult(ok=False, error=last_err or "network error")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_whatsapp_client.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/whatsapp_client.py backend/tests/test_whatsapp_client.py
git commit -m "feat(whatsapp): Cloud API transport client with retry"
```

---

### Task 6: Send service — resolve, send, log

**Files:**
- Create: `backend/app/services/whatsapp_service.py`
- Test: `backend/tests/test_whatsapp_service.py`

**Interfaces:**
- Consumes: `whatsapp_templates.render`, `whatsapp_client.send_text` + `SendResult`, `app.core.phone.normalize_phone`, `app.config.get_settings`, models `Leave`, `Violation`, `Employee`, `WhatsAppMessage`.
- Produces:
  - `class WhatsAppDisabledError(RuntimeError)`, `class RecordNotFoundError(LookupError)`.
  - `send_for_event(db, event_type: str, record_id: int, sent_by: int | None) -> WhatsAppMessage` — loads record+employee, normalizes phone, resolves language, renders params, calls the client, writes a `whatsapp_messages` row (status `sent`/`failed`), returns the row. A missing phone logs `failed` WITHOUT calling the client. Raises `WhatsAppDisabledError` when `whatsapp_enabled` is False, `RecordNotFoundError` for an unknown/foreign record.
  - `last_status(db, event_type: str, record_id: int) -> WhatsAppMessage | None` — most recent attempt for that record.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_whatsapp_service.py
from datetime import date

import pytest

from app.db.models import Employee, Leave, Violation
from app.services import whatsapp_client, whatsapp_service as ws


@pytest.fixture(autouse=True)
def _enable(monkeypatch):
    monkeypatch.setenv("GSSG_WHATSAPP_ENABLED", "1")
    monkeypatch.setenv("GSSG_WHATSAPP_TOKEN", "tok")
    monkeypatch.setenv("GSSG_WHATSAPP_PHONE_NUMBER_ID", "PNID")
    from app.config import get_settings
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _leave(db, **kw):
    db.add(Employee(id="G1", name_en="John", name_ar="جون",
                    contact=kw.pop("contact", "0501234567"),
                    msg_language=kw.pop("lang", "ar")))
    row = Leave(id=7, employee_id="G1", leave_type="Annual - سنوية",
                start_date=date(2026, 7, 5), end_date=date(2026, 7, 9), days=5,
                status="Approved")
    db.add(row)
    db.commit()
    return row


def test_send_success_logs_sent(db_session, monkeypatch):
    _leave(db_session)
    monkeypatch.setattr(
        whatsapp_client, "send_text",
        lambda *a, **k: whatsapp_client.SendResult(ok=True, message_id="wamid.1"),
    )
    row = ws.send_for_event(db_session, "leave_approved", 7, sent_by=99)
    assert row.status == "sent"
    assert row.provider_msg_id == "wamid.1"
    assert row.phone == "+971501234567"
    assert row.template == "leave_approved_ar"
    assert row.sent_by == 99
    assert ws.last_status(db_session, "leave_approved", 7).id == row.id


def test_missing_phone_logs_failed_without_calling_client(db_session, monkeypatch):
    _leave(db_session, contact="n/a")
    called = {"n": 0}
    def boom(*a, **k):
        called["n"] += 1
        raise AssertionError("client must not be called")
    monkeypatch.setattr(whatsapp_client, "send_text", boom)
    row = ws.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert row.status == "failed"
    assert "phone" in row.error.lower()
    assert called["n"] == 0


def test_api_failure_logs_failed_with_error(db_session, monkeypatch):
    _leave(db_session)
    monkeypatch.setattr(
        whatsapp_client, "send_text",
        lambda *a, **k: whatsapp_client.SendResult(ok=False, error="Invalid number"),
    )
    row = ws.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert row.status == "failed"
    assert row.error == "Invalid number"


def test_disabled_raises(db_session, monkeypatch):
    monkeypatch.setenv("GSSG_WHATSAPP_ENABLED", "0")
    from app.config import get_settings
    get_settings.cache_clear()
    _leave(db_session)
    with pytest.raises(ws.WhatsAppDisabledError):
        ws.send_for_event(db_session, "leave_approved", 7, sent_by=1)


def test_unknown_record_raises(db_session):
    with pytest.raises(ws.RecordNotFoundError):
        ws.send_for_event(db_session, "leave_approved", 9999, sent_by=1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_whatsapp_service.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement the service**

```python
# backend/app/services/whatsapp_service.py
"""Resolve → send → log a WhatsApp notification for an HR event.

Loads the source record + employee, normalizes the phone (from ``contact``),
resolves the language preference, renders template params, calls the transport
client, and persists every attempt to ``whatsapp_messages``. Re-sends are
first-class — each call writes a new row. ``last_status`` powers the badge.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.phone import normalize_phone
from app.db.models import Employee, Leave, Violation, WhatsAppMessage
from app.services import whatsapp_client, whatsapp_templates as wt

log = logging.getLogger(__name__)


class WhatsAppDisabledError(RuntimeError):
    """Raised when an admin tries to send while WhatsApp is not configured."""


class RecordNotFoundError(LookupError):
    """Raised when the event's source record does not exist."""


# event_type → (model, loader). Leave-based events share the Leave row.
def _load_leave(db: Session, rid: int) -> Leave | None:
    return db.get(Leave, rid)


def _load_violation(db: Session, rid: int) -> Violation | None:
    return db.get(Violation, rid)


_LOADERS = {
    wt.EVENT_LEAVE_APPROVED: _load_leave,
    wt.EVENT_DUTY_RESUMPTION: _load_leave,
    wt.EVENT_VIOLATION: _load_violation,
}


def _log_row(db, *, employee_id, event_type, record_id, language, phone,
             template, status, provider_msg_id=None, error=None, sent_by=None):
    row = WhatsAppMessage(
        employee_id=employee_id,
        event_type=event_type,
        event_ref=f"{event_type}:{record_id}",
        language=language,
        phone=phone or "",
        template=template or "",
        status=status,
        provider_msg_id=provider_msg_id,
        error=error,
        sent_by=sent_by,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def send_for_event(
    db: Session, event_type: str, record_id: int, sent_by: int | None
) -> WhatsAppMessage:
    cfg = get_settings()
    if not cfg.whatsapp_enabled:
        raise WhatsAppDisabledError("WhatsApp notifications are not enabled")

    loader = _LOADERS.get(event_type)
    if loader is None:
        raise RecordNotFoundError(f"unknown event_type {event_type!r}")
    record = loader(db, record_id)
    if record is None:
        raise RecordNotFoundError(f"{event_type} record {record_id} not found")

    employee: Employee | None = record.employee
    if employee is None:
        raise RecordNotFoundError(f"{event_type} {record_id} has no employee")

    lang = "ar" if (employee.msg_language or "ar") == "ar" else "en"
    phone = normalize_phone(employee.contact, default_cc=cfg.whatsapp_country_code)
    template_name, params = wt.render(event_type, lang, record, employee)

    if phone is None:
        log.info("whatsapp: no valid phone for employee %s", employee.id)
        return _log_row(
            db, employee_id=employee.id, event_type=event_type, record_id=record_id,
            language=lang, phone=None, template=template_name, status="failed",
            error="No valid phone number for this employee", sent_by=sent_by,
        )

    result = whatsapp_client.send_text(phone, template_name, lang, params)
    return _log_row(
        db, employee_id=employee.id, event_type=event_type, record_id=record_id,
        language=lang, phone=phone, template=template_name,
        status="sent" if result.ok else "failed",
        provider_msg_id=result.message_id, error=result.error, sent_by=sent_by,
    )


def last_status(db: Session, event_type: str, record_id: int) -> WhatsAppMessage | None:
    return db.scalar(
        select(WhatsAppMessage)
        .where(WhatsAppMessage.event_ref == f"{event_type}:{record_id}")
        .order_by(WhatsAppMessage.id.desc())
        .limit(1)
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_whatsapp_service.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/whatsapp_service.py backend/tests/test_whatsapp_service.py
git commit -m "feat(whatsapp): send service — resolve, send, log attempts"
```

---

### Task 7: Capability `employees.notify`

**Files:**
- Modify: `backend/app/core/permissions.py` (add to `CAPABILITIES` tuple ~line 36, and to `_MANAGER_CAPS` ~line 86)
- Test: `backend/tests/test_whatsapp_capability.py`

**Interfaces:**
- Produces: capability id `"employees.notify"` in `CAPABILITY_IDS`; granted by default to the manager + admin presets, not to operator.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_whatsapp_capability.py
from app.core.permissions import (
    CAPABILITY_IDS, ROLE_DEFAULTS, default_caps_for_role,
)
from app.core.roles import ADMIN_ROLE, MANAGER_ROLE, OPERATOR_ROLE


def test_notify_capability_exists():
    assert "employees.notify" in CAPABILITY_IDS


def test_notify_default_role_assignment():
    assert "employees.notify" in default_caps_for_role(MANAGER_ROLE)
    assert "employees.notify" in default_caps_for_role(ADMIN_ROLE)
    assert "employees.notify" not in default_caps_for_role(OPERATOR_ROLE)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_whatsapp_capability.py -v`
Expected: FAIL (capability not present).

- [ ] **Step 3: Add the capability**

In `backend/app/core/permissions.py`, add a row to the `CAPABILITIES` tuple, right after the `employees.edit` line:

```python
    Capability("employees.notify", "employees", "Notify employees via WhatsApp", "Send WhatsApp confirmations to employees for leaves, duty resumptions, and violations."),
```

In `_MANAGER_CAPS`, add `"employees.notify",` to the frozenset (alongside `employees.edit`):

```python
        "employees.notify",
```

(Admin already resolves to `ALL_CAPABILITIES`, so it is covered automatically.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_whatsapp_capability.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/permissions.py backend/tests/test_whatsapp_capability.py
git commit -m "feat(whatsapp): employees.notify capability (manager+admin)"
```

---

### Task 8: API router + schemas

**Files:**
- Create: `backend/app/schemas/whatsapp.py`
- Create: `backend/app/api/v1/whatsapp.py`
- Modify: `backend/app/main.py` (import + `include_router`, alongside the other v1 routers ~line 200)
- Test: `backend/tests/test_whatsapp_api.py`

**Interfaces:**
- Consumes: `whatsapp_service.send_for_event`, `last_status`, `WhatsAppDisabledError`, `RecordNotFoundError`; `require_capability`, `get_current_user`, `get_db`.
- Produces routes (mounted at `/api/v1`):
  - `POST /whatsapp/send` body `{ event_type, record_id }` → `WhatsAppSendResponse { status, message_id?, error? }` (requires `employees.notify`).
  - `GET /whatsapp/status?event_type=&record_id=` → `WhatsAppStatusResponse { last: WhatsAppStatusItem | null }` (requires `employees.notify`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_whatsapp_api.py
"""API tests — mount prefix /api/v1; auth + db overridden like test_permissions_api."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, Employee, Leave, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service, whatsapp_client


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    monkeypatch.setenv("GSSG_WHATSAPP_ENABLED", "1")
    monkeypatch.setenv("GSSG_WHATSAPP_TOKEN", "tok")
    monkeypatch.setenv("GSSG_WHATSAPP_PHONE_NUMBER_ID", "PNID")
    from app.config import get_settings
    get_settings.cache_clear()
    db_file = tmp_path / "wa.db"
    eng = create_engine(f"sqlite:///{db_file}", future=True,
                        connect_args={"check_same_thread": False})
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False,
                              expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    try:
        yield db
    finally:
        db.close()
        get_settings.cache_clear()


def _user(db, role="manager", email="m@x.ae"):
    u = User(email=email, password_hash="x", role=role, status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def _client(db, user):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _leave(db):
    db.add(Employee(id="G1", name_en="John", name_ar="جون",
                    contact="0501234567", msg_language="ar"))
    db.add(Leave(id=7, employee_id="G1", leave_type="Annual - سنوية",
                 start_date=date(2026, 7, 5), end_date=date(2026, 7, 9),
                 days=5, status="Approved"))
    db.commit()


def test_send_returns_sent(api_db, monkeypatch):
    _leave(api_db)
    monkeypatch.setattr(whatsapp_client, "send_text",
                        lambda *a, **k: whatsapp_client.SendResult(ok=True, message_id="wamid.1"))
    c = _client(api_db, _user(api_db))
    r = c.post("/api/v1/whatsapp/send",
               json={"event_type": "leave_approved", "record_id": 7})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "sent"
    # status endpoint now reflects it
    s = c.get("/api/v1/whatsapp/status",
              params={"event_type": "leave_approved", "record_id": 7})
    assert s.json()["last"]["status"] == "sent"


def test_send_requires_capability(api_db, monkeypatch):
    _leave(api_db)
    c = _client(api_db, _user(api_db, role="operator", email="op@x.ae"))
    r = c.post("/api/v1/whatsapp/send",
               json={"event_type": "leave_approved", "record_id": 7})
    assert r.status_code == 403


def test_send_unknown_record_404(api_db):
    c = _client(api_db, _user(api_db))
    r = c.post("/api/v1/whatsapp/send",
               json={"event_type": "leave_approved", "record_id": 9999})
    assert r.status_code == 404


def test_status_null_when_never_sent(api_db):
    _leave(api_db)
    c = _client(api_db, _user(api_db))
    s = c.get("/api/v1/whatsapp/status",
              params={"event_type": "leave_approved", "record_id": 7})
    assert s.status_code == 200
    assert s.json()["last"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_whatsapp_api.py -v`
Expected: FAIL (router not mounted / module missing).

- [ ] **Step 3a: Schemas**

```python
# backend/app/schemas/whatsapp.py
"""WhatsApp notification API schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas._base import ORMBase

EventType = Literal["leave_approved", "duty_resumption", "violation"]


class WhatsAppSendRequest(BaseModel):
    event_type: EventType
    record_id: int


class WhatsAppSendResponse(BaseModel):
    status: Literal["sent", "failed"]
    message_id: str | None = None
    error: str | None = None


class WhatsAppStatusItem(ORMBase):
    event_type: str
    event_ref: str
    language: str
    status: str
    error: str | None
    created_at: datetime


class WhatsAppStatusResponse(BaseModel):
    last: WhatsAppStatusItem | None = None
```

- [ ] **Step 3b: Router**

```python
# backend/app/api/v1/whatsapp.py
"""Employee WhatsApp notification routes.

  POST /whatsapp/send             — manually send a notification for a record
  GET  /whatsapp/status           — most recent send attempt for a record

Both require the ``employees.notify`` capability.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.whatsapp import (
    WhatsAppSendRequest,
    WhatsAppSendResponse,
    WhatsAppStatusItem,
    WhatsAppStatusResponse,
)
from app.services import whatsapp_service

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])


@router.post("/send", response_model=WhatsAppSendResponse)
def send(
    payload: WhatsAppSendRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("employees.notify"))],
) -> WhatsAppSendResponse:
    try:
        row = whatsapp_service.send_for_event(
            db, payload.event_type, payload.record_id, sent_by=user.id
        )
    except whatsapp_service.WhatsAppDisabledError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except whatsapp_service.RecordNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return WhatsAppSendResponse(status=row.status, message_id=row.provider_msg_id, error=row.error)


@router.get("/status", response_model=WhatsAppStatusResponse)
def get_status(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.notify"))],
    event_type: str = Query(...),
    record_id: int = Query(...),
) -> WhatsAppStatusResponse:
    row = whatsapp_service.last_status(db, event_type, record_id)
    return WhatsAppStatusResponse(
        last=WhatsAppStatusItem.model_validate(row) if row else None
    )


__all__ = ["router"]
```

- [ ] **Step 3c: Mount the router**

In `backend/app/main.py`, add the import next to the other `from app.api.v1 import ... as ..._v1` lines:

```python
from app.api.v1 import whatsapp as whatsapp_v1
```

And register it alongside the other auth-gated routers (after the `notifications_v1` include at line 200):

```python
    app.include_router(whatsapp_v1.router, prefix="/api/v1", dependencies=auth_gate)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_whatsapp_api.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Run the full backend suite + commit**

Run: `cd backend && python -m pytest -q`
Expected: all green (existing + new tests).

```bash
git add backend/app/schemas/whatsapp.py backend/app/api/v1/whatsapp.py backend/app/main.py backend/tests/test_whatsapp_api.py
git commit -m "feat(whatsapp): send + status API endpoints"
```

---

### Task 9: Frontend — API client + types

**Files:**
- Modify: `frontend/src/lib/api.ts` (add types + two functions near the other domain helpers)
- Test: `frontend/src/lib/whatsapp.test.ts`

**Interfaces:**
- Produces (exported from `api.ts`):
  - `type WhatsAppEventType = 'leave_approved' | 'duty_resumption' | 'violation'`
  - `interface WhatsAppSendResponse { status: 'sent' | 'failed'; message_id: string | null; error: string | null }`
  - `interface WhatsAppStatus { event_type: string; event_ref: string; language: string; status: string; error: string | null; created_at: string }`
  - `sendWhatsApp(eventType, recordId): Promise<WhatsAppSendResponse>`
  - `getWhatsAppStatus(eventType, recordId): Promise<WhatsAppStatus | null>`

- [ ] **Step 1: Write the failing test**

Inspect `frontend/src/lib/api.ts` to confirm the existing low-level request helper's name (e.g. `request`/`http`/`apiFetch`) and how other POST/GET helpers call it; reuse that exact helper. The test below mocks global `fetch`.

```ts
// frontend/src/lib/whatsapp.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendWhatsApp, getWhatsAppStatus } from './api'

describe('whatsapp api', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('POSTs send with event_type + record_id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'sent', message_id: 'wamid.1', error: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const res = await sendWhatsApp('leave_approved', 7)
    expect(res.status).toBe('sent')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/whatsapp/send')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      event_type: 'leave_approved', record_id: 7,
    })
  })

  it('returns null status when last is null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ last: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    expect(await getWhatsAppStatus('leave_approved', 7)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/whatsapp.test.ts`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Implement the client functions**

In `frontend/src/lib/api.ts`, add (adapt `request(...)` to the file's actual low-level helper name/signature observed in Step 1):

```ts
// --- Employee WhatsApp notifications --------------------------------------
export type WhatsAppEventType = 'leave_approved' | 'duty_resumption' | 'violation'

export interface WhatsAppSendResponse {
  status: 'sent' | 'failed'
  message_id: string | null
  error: string | null
}

export interface WhatsAppStatus {
  event_type: string
  event_ref: string
  language: string
  status: string
  error: string | null
  created_at: string
}

export function sendWhatsApp(
  eventType: WhatsAppEventType,
  recordId: number,
): Promise<WhatsAppSendResponse> {
  return request('/whatsapp/send', {
    method: 'POST',
    body: JSON.stringify({ event_type: eventType, record_id: recordId }),
  })
}

export async function getWhatsAppStatus(
  eventType: WhatsAppEventType,
  recordId: number,
): Promise<WhatsAppStatus | null> {
  const res = await request<{ last: WhatsAppStatus | null }>(
    `/whatsapp/status?event_type=${eventType}&record_id=${recordId}`,
  )
  return res.last
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/whatsapp.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/whatsapp.test.ts
git commit -m "feat(whatsapp): frontend api client for send + status"
```

---

### Task 10: Frontend — employee language preference field

**Files:**
- Modify: `frontend/src/components/employees/schema.ts` (add `msg_language` to the Zod schema)
- Modify: `frontend/src/components/employees/EmployeeForm.tsx` (render an Arabic/English select bound to `msg_language`)
- Modify: `frontend/src/locales/en.json` and `frontend/src/locales/ar.json` (labels)

**Interfaces:**
- Consumes: backend `EmployeeRead.msg_language` / `EmployeeUpdate.msg_language` (Task 3).
- Produces: the employee form reads and writes `msg_language`.

- [ ] **Step 1: Add to the Zod schema**

In `frontend/src/components/employees/schema.ts`, inside `employeeFormSchema.object({...})`, add after the `contact` field:

```ts
    msg_language: z.enum(['ar', 'en']).default('ar'),
```

- [ ] **Step 2: Render the field in `EmployeeForm.tsx`**

Open `frontend/src/components/employees/EmployeeForm.tsx`. Find an existing simple `<select>`/labelled input (e.g. the `status` or `nationality` field) and add an adjacent control bound to `msg_language`, following that file's exact form-control pattern (react-hook-form `register`/`Controller`, label component, and class names already in use). The control must offer two options:

```tsx
{/* Preferred WhatsApp message language */}
<label className="<same classes as siblings>">
  {t('employee.msgLanguage')}
  <select {...register('msg_language')}>
    <option value="ar">{t('employee.msgLanguageAr')}</option>
    <option value="en">{t('employee.msgLanguageEn')}</option>
  </select>
</label>
```

Ensure the form's default values include `msg_language: employee?.msg_language ?? 'ar'` wherever defaults are assembled (mirror how `contact`/`status` defaults are set in this file).

- [ ] **Step 3: Add i18n strings**

In `frontend/src/locales/en.json`, under the `employee` object:
```json
"msgLanguage": "Notification language",
"msgLanguageAr": "Arabic",
"msgLanguageEn": "English",
```
In `frontend/src/locales/ar.json`, under the `employee` object:
```json
"msgLanguage": "لغة الإشعارات",
"msgLanguageAr": "العربية",
"msgLanguageEn": "الإنجليزية",
```
(Match the existing nesting; if the namespace key differs, place these beside the other employee-form labels in the same object.)

- [ ] **Step 4: Verify build + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/components/employees/schema.ts src/components/employees/EmployeeForm.tsx`
Expected: no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/employees/schema.ts frontend/src/components/employees/EmployeeForm.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(whatsapp): employee notification-language preference field"
```

---

### Task 11: Frontend — "Send to employee" button + status badge

**Files:**
- Create: `frontend/src/components/whatsapp/SendWhatsAppButton.tsx`
- Create: `frontend/src/components/whatsapp/SendWhatsAppButton.test.tsx`
- Modify: `frontend/src/pages/leaves/TabRecords.tsx` (button on each leave row — `leave_approved`; and on rows with a filed return — `duty_resumption`)
- Modify: `frontend/src/components/employees/ViolationsTable.tsx` (button on each violation row — `violation`)
- Modify: `frontend/src/locales/en.json` and `frontend/src/locales/ar.json` (button + status strings)

**Interfaces:**
- Consumes: `sendWhatsApp`, `getWhatsAppStatus`, `WhatsAppEventType`, `WhatsAppStatus` from `lib/api.ts`; `useCapabilities` from `lib/useCapabilities.ts`.
- Produces: a self-contained `<SendWhatsAppButton eventType recordId />` that fetches current status on mount, shows Send / Sent ✓ / Failed, confirms before re-sending, and is hidden when the user lacks `employees.notify`.

- [ ] **Step 1: Write the failing test**

Confirm the hook name/shape in `frontend/src/lib/useCapabilities.ts` first (e.g. `useCapabilities()` returning `{ has(cap) }` or a `Set`). Adapt the mock accordingly.

```tsx
// frontend/src/components/whatsapp/SendWhatsAppButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SendWhatsAppButton } from './SendWhatsAppButton'
import * as api from '../../lib/api'

vi.mock('../../lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (c: string) => c === 'employees.notify' }),
}))

describe('SendWhatsAppButton', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('shows Send when never sent, then Sent after click', async () => {
    vi.spyOn(api, 'getWhatsAppStatus').mockResolvedValue(null)
    const send = vi.spyOn(api, 'sendWhatsApp').mockResolvedValue({
      status: 'sent', message_id: 'wamid.1', error: null,
    })
    render(<SendWhatsAppButton eventType="leave_approved" recordId={7} />)
    const btn = await screen.findByRole('button')
    fireEvent.click(btn)
    await waitFor(() => expect(send).toHaveBeenCalledWith('leave_approved', 7))
  })

  it('renders nothing without the capability', async () => {
    vi.doMock('../../lib/useCapabilities', () => ({
      useCapabilities: () => ({ has: () => false }),
    }))
    // re-import to apply the new mock
    const { SendWhatsAppButton: Btn } = await import('./SendWhatsAppButton')
    const { container } = render(<Btn eventType="violation" recordId={1} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/whatsapp/SendWhatsAppButton.test.tsx`
Expected: FAIL (component missing).

- [ ] **Step 3: Implement the button**

```tsx
// frontend/src/components/whatsapp/SendWhatsAppButton.tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  sendWhatsApp, getWhatsAppStatus,
  type WhatsAppEventType, type WhatsAppStatus,
} from '../../lib/api'
import { useCapabilities } from '../../lib/useCapabilities'

interface Props {
  eventType: WhatsAppEventType
  recordId: number
}

export function SendWhatsAppButton({ eventType, recordId }: Props) {
  const { t } = useTranslation()
  const caps = useCapabilities()
  const [last, setLast] = useState<WhatsAppStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getWhatsAppStatus(eventType, recordId)
      .then((s) => { if (alive) setLast(s) })
      .catch(() => {})
    return () => { alive = false }
  }, [eventType, recordId])

  if (!caps.has('employees.notify')) return null

  const alreadySent = last?.status === 'sent'

  async function onClick() {
    if (alreadySent && !window.confirm(t('whatsapp.confirmResend'))) return
    setBusy(true); setError(null)
    try {
      const res = await sendWhatsApp(eventType, recordId)
      if (res.status === 'sent') {
        setLast({ ...(last as WhatsAppStatus), status: 'sent', error: null,
          created_at: new Date().toISOString(),
          event_type: eventType, event_ref: `${eventType}:${recordId}`,
          language: last?.language ?? 'ar' })
      } else {
        setError(res.error || t('whatsapp.failed'))
      }
    } catch {
      setError(t('whatsapp.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={onClick} disabled={busy}
              title={t('whatsapp.sendTitle')}>
        {busy ? t('whatsapp.sending')
          : alreadySent ? t('whatsapp.resend')
          : t('whatsapp.send')}
      </button>
      {alreadySent && !error && <span aria-label="sent">✓</span>}
      {error && <span role="alert" title={error}>⚠ {t('whatsapp.failed')}</span>}
    </span>
  )
}
```

- [ ] **Step 4: Wire the button into the record views**

In `frontend/src/pages/leaves/TabRecords.tsx`: in the per-row actions cell, render `<SendWhatsAppButton eventType="leave_approved" recordId={row.id} />` for rows whose status is `Approved`; and, for rows that have a filed return (`row.return_date`/`return_doc_path` present), additionally render `<SendWhatsAppButton eventType="duty_resumption" recordId={row.id} />`. Import the component at the top.

In `frontend/src/components/employees/ViolationsTable.tsx`: in the per-row actions cell, render `<SendWhatsAppButton eventType="violation" recordId={row.id} />`. Import the component at the top.

- [ ] **Step 5: Add i18n strings**

`frontend/src/locales/en.json` — add a `whatsapp` object:
```json
"whatsapp": {
  "send": "Notify on WhatsApp",
  "resend": "Resend WhatsApp",
  "sending": "Sending…",
  "sendTitle": "Send a WhatsApp message to this employee",
  "confirmResend": "Already sent. Send again?",
  "failed": "Send failed"
}
```
`frontend/src/locales/ar.json` — add:
```json
"whatsapp": {
  "send": "إشعار عبر واتساب",
  "resend": "إعادة الإرسال",
  "sending": "جارٍ الإرسال…",
  "sendTitle": "إرسال رسالة واتساب إلى الموظف",
  "confirmResend": "تم الإرسال مسبقًا. إعادة الإرسال؟",
  "failed": "فشل الإرسال"
}
```

- [ ] **Step 6: Run tests + build**

Run: `cd frontend && npx vitest run src/components/whatsapp/SendWhatsAppButton.test.tsx && npx tsc --noEmit`
Expected: PASS + no type errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/whatsapp/ frontend/src/pages/leaves/TabRecords.tsx frontend/src/components/employees/ViolationsTable.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(whatsapp): Send-to-employee button + status badge on records"
```

---

### Task 12: Wire-up verification + docs

**Files:**
- Modify: `README.md` or `deploy/` notes (document the `GSSG_WHATSAPP_*` env vars + the one-time Meta setup from spec §9)
- No new code.

- [ ] **Step 1: Full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: all green.

- [ ] **Step 2: Full frontend suite + typecheck + build**

Run: `cd frontend && npx vitest run && npx tsc --noEmit && npm run build`
Expected: tests pass, no type errors, build succeeds.

- [ ] **Step 3: Document operational setup**

Add a short "WhatsApp notifications" section (env vars `GSSG_WHATSAPP_ENABLED/TOKEN/PHONE_NUMBER_ID/API_BASE/COUNTRY_CODE`, and the one-time Meta steps: business verification, dedicated number, register the six templates from spec §5, provision token) to the deploy docs.

- [ ] **Step 4: Commit**

```bash
git add README.md deploy/
git commit -m "docs(whatsapp): operational setup + env vars"
```

- [ ] **Step 5: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to merge `feature/employee-whatsapp-notifications` into `main`, then push to `origin/main`.

---

## Notes for the implementer

- **Template registration is out-of-band.** The six WhatsApp templates (spec §5) must be registered + approved in Meta's WhatsApp Manager with body variables in the SAME order this code supplies them (Task 4). Until approved, live sends return an API error — which the service logs as `failed` and the UI surfaces. Tests never hit the network.
- **`event_ref` format** is `"<event_type>:<record_id>"` everywhere (model default value in the service, status query, and badge). Keep it consistent.
- **Leave-based events share the `Leave` row**; `duty_resumption` uses `return_date` (falls back to `end_date` if absent).
- **Re-sends are intentional.** There is no hard server block on duplicate sends; the UI's confirm dialog is the guard. Each attempt is its own `whatsapp_messages` row.
