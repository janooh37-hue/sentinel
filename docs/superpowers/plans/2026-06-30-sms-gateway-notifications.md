# SMS Notification Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-triggered SMS notification channel that sends leave/duty/violation messages as plain-text SMS through an on-site Android phone's SIM (SMS Gate, local mode), auditing every attempt — mirroring the existing WhatsApp UX.

**Architecture:** A self-contained SMS channel parallel to the dormant WhatsApp pipeline (Approach A — full isolation). New `sms_client`/`sms_templates`/`sms_service`/`sms` API + `SmsMessage` table + `SendSmsButton`. Shared formatting helpers are extracted into `notify_format.py`, imported by both the WhatsApp and SMS renderers. `core/phone.py` and the `employees.notify` capability are reused as-is.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0 (`mapped_column`), pydantic-settings, Alembic, httpx; React + react-i18next, Vitest + Testing Library.

## Global Constraints

- Env vars are prefixed `GSSG_` (pydantic-settings `env_prefix="GSSG_"`). New vars: `GSSG_SMS_ENABLED`, `GSSG_SMS_GATEWAY_URL`, `GSSG_SMS_USERNAME`, `GSSG_SMS_PASSWORD`, `GSSG_SMS_COUNTRY_CODE`.
- Default message language is `ar` when `employee.msg_language` is null/`"ar"`, else `en`.
- Date format is `dd/mm/yyyy`; weekday tables are Monday-first to match `datetime.weekday()` and `app.core.constants.ARABIC_WEEKDAYS`.
- Signature lines, exact: EN `Al Wathba Rehabilitation Centre`; AR `إدارة مركز الإصلاح والتأهيل بالوثبة`.
- SMS message bodies must match the six WhatsApp template bodies verbatim (`deploy/WHATSAPP-SETUP.md`).
- SMS gateway base URL defaults to scheme `http://` when none given (SMS Gate local server is plain HTTP), unlike the WhatsApp client which defaults to `https://`.
- Send authorization requires the `employees.notify` capability.
- The existing WhatsApp test suites must stay green after the `notify_format` extraction.
- Do NOT store the rendered SMS body in `sms_messages` (status/phone/id/error only).
- Backend tests run from the `backend/` directory with the project venv active: `python -m pytest tests/<file> -v`. Frontend tests: from `frontend/`, `npx vitest run <path>`.

---

### Task 1: Shared formatting helpers (`notify_format.py`)

Extract the pure formatting helpers + event constants out of `whatsapp_templates.py` into a new shared module, then make `whatsapp_templates.py` import them. No behavior change — the existing WhatsApp template tests are the regression guard.

**Files:**
- Create: `backend/app/services/notify_format.py`
- Create: `backend/tests/test_notify_format.py`
- Modify: `backend/app/services/whatsapp_templates.py` (replace local helper defs with imports)

**Interfaces:**
- Produces:
  - `EVENT_LEAVE_APPROVED = "leave_approved"`, `EVENT_DUTY_RESUMPTION = "duty_resumption"`, `EVENT_VIOLATION = "violation"`
  - `ENGLISH_WEEKDAYS: tuple[str, ...]` (Monday-first)
  - `english_part(value: str) -> str`, `arabic_part(value: str) -> str`
  - `type_label(value: str, lang: str) -> str`
  - `employee_name(emp, lang: str) -> str`
  - `fmt_date(d: date) -> str`  (→ `dd/mm/yyyy`)
  - `weekday(d: date, lang: str) -> str`
  - `action_text(action_taken: str | None, deduction_days: int, lang: str) -> str`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_notify_format.py`:

```python
from datetime import date

from app.db.models import Employee
from app.services import notify_format as nf


def _emp(**kw):
    base = dict(id="G1", name_en="John Smith", name_ar="جون سميث", msg_language="ar")
    base.update(kw)
    return Employee(**base)


def test_event_constants():
    assert nf.EVENT_LEAVE_APPROVED == "leave_approved"
    assert nf.EVENT_DUTY_RESUMPTION == "duty_resumption"
    assert nf.EVENT_VIOLATION == "violation"


def test_fmt_date_is_day_month_year():
    assert nf.fmt_date(date(2026, 7, 5)) == "05/07/2026"


def test_weekday_localized_monday_first():
    # 2026-07-05 is a Sunday
    assert nf.weekday(date(2026, 7, 5), "en") == "Sunday"
    assert nf.weekday(date(2026, 7, 5), "ar") == "الأحد"


def test_type_label_splits_on_dash():
    assert nf.type_label("Annual Leave - إجازة سنوية", "en") == "Annual Leave"
    assert nf.type_label("Annual Leave - إجازة سنوية", "ar") == "إجازة سنوية"


def test_employee_name_prefers_language():
    assert nf.employee_name(_emp(), "ar") == "جون سميث"
    assert nf.employee_name(_emp(msg_language="en"), "en") == "John Smith"


def test_action_text_fallback_to_deduction():
    assert nf.action_text(None, 2, "en") == "2 day(s) deduction"
    assert nf.action_text(None, 2, "ar") == "خصم 2 يوم"
    assert nf.action_text("Warning", 0, "en") == "Warning"
    assert nf.action_text(None, 0, "en") == "—"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_notify_format.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.notify_format'`

- [ ] **Step 3: Create the shared module**

Create `backend/app/services/notify_format.py`:

```python
"""Shared formatting helpers for employee notification channels.

Both the WhatsApp template renderer and the SMS text renderer use these to
turn an Employee + HR record into display-ready strings (localized name,
date, weekday, type label, disciplinary action text). Keeping them here means
the two channels can never drift in how they format the same data.
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


def english_part(value: str) -> str:
    return value.partition(" - ")[0].strip() or value.strip()


def arabic_part(value: str) -> str:
    return value.partition(" - ")[2].strip() or value.strip()


def type_label(value: str, lang: str) -> str:
    return arabic_part(value) if lang == "ar" else english_part(value)


def employee_name(emp: Employee, lang: str) -> str:
    if lang == "ar":
        return emp.name_ar or emp.name_en
    return emp.name_en or emp.name_ar or ""


def fmt_date(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def weekday(d: date, lang: str) -> str:
    table = ARABIC_WEEKDAYS if lang == "ar" else ENGLISH_WEEKDAYS
    return table[d.weekday()]


def action_text(action_taken: str | None, deduction_days: int, lang: str) -> str:
    if action_taken and action_taken.strip():
        return action_taken.strip()
    if deduction_days:
        return (
            f"خصم {deduction_days} يوم" if lang == "ar"
            else f"{deduction_days} day(s) deduction"
        )
    return "—"
```

- [ ] **Step 4: Refactor `whatsapp_templates.py` to import the shared helpers**

Replace the top of `backend/app/services/whatsapp_templates.py` (the constants + the `_english_part`/`_arabic_part`/`_type_label`/`_name`/`_fmt_date`/`_weekday`/`_action_text` definitions, lines ~12–62) with imports. The builder functions (`_build_leave_approved`, etc.) and `render` stay unchanged because the private names are preserved via aliasing:

```python
from __future__ import annotations

from app.db.models import Employee
from app.services.notify_format import (
    EVENT_DUTY_RESUMPTION,
    EVENT_LEAVE_APPROVED,
    EVENT_VIOLATION,
    action_text as _action_text,
    employee_name as _name,
    fmt_date as _fmt_date,
    type_label as _type_label,
    weekday as _weekday,
)

# (keep _build_leave_approved, _build_duty_resumption, _build_violation,
#  _BUILDERS, and render exactly as they are)
```

Remove the now-unused imports/definitions: `from datetime import date`, `from app.core.constants import ARABIC_WEEKDAYS`, the duplicated `ENGLISH_WEEKDAYS` literal, and the local helper defs. Do NOT import `ENGLISH_WEEKDAYS` into `whatsapp_templates.py` — after the refactor only `notify_format._weekday` uses it, so an import here would be unused. The `EVENT_*` constants stay importable from `whatsapp_templates` (so `whatsapp_service`'s `wt.EVENT_*` references keep working) because they are re-exported via this import.

- [ ] **Step 5: Run the new test and the existing WhatsApp template suite**

Run: `python -m pytest tests/test_notify_format.py tests/test_whatsapp_templates.py -v`
Expected: PASS (all). The WhatsApp suite passing confirms the extraction changed no behavior.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/notify_format.py backend/app/services/whatsapp_templates.py backend/tests/test_notify_format.py
git commit -m "refactor(notify): extract shared formatting helpers into notify_format"
```

---

### Task 2: SMS configuration settings

Add the `GSSG_SMS_*` settings to `Settings`.

**Files:**
- Modify: `backend/app/config.py` (add fields after the WhatsApp block, ~line 75)
- Create: `backend/tests/test_sms_config.py`

**Interfaces:**
- Produces on `Settings`: `sms_enabled: bool`, `sms_gateway_url: str`, `sms_username: str`, `sms_password: str`, `sms_country_code: str`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_sms_config.py`:

```python
def test_sms_settings_load_from_env(monkeypatch):
    monkeypatch.setenv("GSSG_SMS_ENABLED", "1")
    monkeypatch.setenv("GSSG_SMS_GATEWAY_URL", "http://192.168.1.50:8080")
    monkeypatch.setenv("GSSG_SMS_USERNAME", "user")
    monkeypatch.setenv("GSSG_SMS_PASSWORD", "pass")
    monkeypatch.setenv("GSSG_SMS_COUNTRY_CODE", "971")
    from app.config import get_settings
    get_settings.cache_clear()
    cfg = get_settings()
    assert cfg.sms_enabled is True
    assert cfg.sms_gateway_url == "http://192.168.1.50:8080"
    assert cfg.sms_username == "user"
    assert cfg.sms_password == "pass"
    assert cfg.sms_country_code == "971"
    get_settings.cache_clear()


def test_sms_disabled_by_default(monkeypatch):
    for k in ("GSSG_SMS_ENABLED", "GSSG_SMS_GATEWAY_URL",
              "GSSG_SMS_USERNAME", "GSSG_SMS_PASSWORD"):
        monkeypatch.delenv(k, raising=False)
    from app.config import get_settings
    get_settings.cache_clear()
    cfg = get_settings()
    assert cfg.sms_enabled is False
    assert cfg.sms_country_code == "971"
    get_settings.cache_clear()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_sms_config.py -v`
Expected: FAIL (`AttributeError: 'Settings' object has no attribute 'sms_enabled'`)

- [ ] **Step 3: Add the settings fields**

In `backend/app/config.py`, after the WhatsApp block (after the `whatsapp_phone_number_id` line, ~line 75), add:

```python
    # --- SMS via on-site Android SIM gateway (SMS Gate, local mode) -----------
    # All GSSG_SMS_* env vars. Disabled by default so the "Send SMS" button is
    # hidden until an operator provisions the gateway URL + credentials.
    sms_enabled: bool = False
    sms_gateway_url: str = ""        # e.g. http://192.168.1.50:8080 (scheme optional)
    sms_username: str = ""           # SMS Gate local-server Basic auth user
    sms_password: str = ""           # SMS Gate local-server Basic auth password
    sms_country_code: str = "971"    # default CC for normalizing contact
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_sms_config.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/tests/test_sms_config.py
git commit -m "feat(sms): add GSSG_SMS_* configuration settings"
```

---

### Task 3: SMS text renderer (`sms_templates.py`)

Render the full SMS body (text + signature) per event × language, reusing the shared helpers.

**Files:**
- Create: `backend/app/services/sms_templates.py`
- Create: `backend/tests/test_sms_templates.py`

**Interfaces:**
- Consumes: `app.services.notify_format` (`EVENT_*`, `employee_name`, `type_label`, `fmt_date`, `weekday`, `action_text`)
- Produces: `render_text(event_type: str, language: str, record, employee: Employee) -> str` (raises `KeyError` on unknown event)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_sms_templates.py`:

```python
from datetime import date

import pytest

from app.db.models import Employee, Leave, Violation
from app.services import sms_templates as st


def _emp(**kw):
    base = dict(id="G1", name_en="John Smith", name_ar="جون سميث", msg_language="ar")
    base.update(kw)
    return Employee(**base)


def test_leave_approved_english_full_text():
    emp = _emp(msg_language="en")
    leave = Leave(id=7, employee_id="G1", leave_type="Annual Leave - إجازة سنوية",
                  start_date=date(2026, 7, 5), end_date=date(2026, 7, 9), days=5)
    text = st.render_text("leave_approved", "en", leave, emp)
    assert text == (
        "Dear John Smith,\n"
        "Your Annual Leave leave has been approved.\n"
        "Start: 05/07/2026 (Sunday)\n"
        "End: 09/07/2026 (Thursday)\n"
        "Duration: 5 day(s).\n"
        "Al Wathba Rehabilitation Centre"
    )


def test_leave_approved_arabic_has_signature_and_weekday():
    emp = _emp()
    leave = Leave(id=7, employee_id="G1", leave_type="Annual Leave - إجازة سنوية",
                  start_date=date(2026, 7, 5), end_date=date(2026, 7, 9), days=5)
    text = st.render_text("leave_approved", "ar", leave, emp)
    assert text.startswith("عزيزي جون سميث،")
    assert "(الأحد)" in text
    assert "إجازة سنوية" in text
    assert text.endswith("إدارة مركز الإصلاح والتأهيل بالوثبة")


def test_duty_resumption_uses_return_date():
    emp = _emp(msg_language="en")
    leave = Leave(id=7, employee_id="G1", leave_type="Annual - سنوية",
                  start_date=date(2026, 7, 5), end_date=date(2026, 7, 9),
                  return_date=date(2026, 7, 10))
    text = st.render_text("duty_resumption", "en", leave, emp)
    assert text == (
        "Dear John Smith,\n"
        "Your return to duty on 10/07/2026 (Friday) has been recorded.\n"
        "Welcome back.\n"
        "Al Wathba Rehabilitation Centre"
    )


def test_violation_falls_back_to_deduction():
    emp = _emp(msg_language="en")
    v = Violation(id=3, employee_id="G1",
                  violation_type="Sleeping on Duty - النوم أثناء الخدمة",
                  date=date(2026, 7, 1), action_taken=None, deduction_days=2)
    text = st.render_text("violation", "en", v, emp)
    assert text == (
        "Dear John Smith,\n"
        "A Sleeping on Duty has been recorded on 01/07/2026 (Wednesday).\n"
        "Action: 2 day(s) deduction.\n"
        "Please contact HR for any clarification.\n"
        "Al Wathba Rehabilitation Centre"
    )


def test_unknown_event_raises():
    with pytest.raises(KeyError):
        st.render_text("nope", "ar", None, _emp())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_sms_templates.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'app.services.sms_templates'`)

- [ ] **Step 3: Create the renderer**

Create `backend/app/services/sms_templates.py`:

```python
"""Render the full SMS body for an HR event.

Unlike WhatsApp (which uses Meta-registered templates with positional
placeholders), SMS has no pre-registration: we send the complete message text
ourselves, including the signature line. The wording mirrors the six WhatsApp
template bodies so both channels read identically.
"""

from __future__ import annotations

from app.db.models import Employee
from app.services import notify_format as nf

_SIGNATURE_EN = "Al Wathba Rehabilitation Centre"
_SIGNATURE_AR = "إدارة مركز الإصلاح والتأهيل بالوثبة"


def _leave_approved(leave, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    typ = nf.type_label(leave.leave_type, lang)
    s, sw = nf.fmt_date(leave.start_date), nf.weekday(leave.start_date, lang)
    e, ew = nf.fmt_date(leave.end_date), nf.weekday(leave.end_date, lang)
    days = str(leave.days)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تمت الموافقة على إجازتك ({typ}).\n"
            f"تاريخ البداية: {s} ({sw})\n"
            f"تاريخ النهاية: {e} ({ew})\n"
            f"المدة: {days} يوم.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your {typ} leave has been approved.\n"
        f"Start: {s} ({sw})\n"
        f"End: {e} ({ew})\n"
        f"Duration: {days} day(s).\n"
        f"{_SIGNATURE_EN}"
    )


def _duty_resumption(leave, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    d = leave.return_date or leave.end_date
    ds, wd = nf.fmt_date(d), nf.weekday(d, lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم تسجيل مباشرتك للعمل بتاريخ {ds} ({wd}).\n"
            f"أهلاً بعودتك.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your return to duty on {ds} ({wd}) has been recorded.\n"
        f"Welcome back.\n"
        f"{_SIGNATURE_EN}"
    )


def _violation(v, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    typ = nf.type_label(v.violation_type, lang)
    ds, wd = nf.fmt_date(v.date), nf.weekday(v.date, lang)
    action = nf.action_text(v.action_taken, v.deduction_days, lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم تسجيل {typ} بتاريخ {ds} ({wd}).\n"
            f"الإجراء: {action}.\n"
            f"يرجى مراجعة الموارد البشرية لأي استفسار.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"A {typ} has been recorded on {ds} ({wd}).\n"
        f"Action: {action}.\n"
        f"Please contact HR for any clarification.\n"
        f"{_SIGNATURE_EN}"
    )


_BUILDERS = {
    nf.EVENT_LEAVE_APPROVED: _leave_approved,
    nf.EVENT_DUTY_RESUMPTION: _duty_resumption,
    nf.EVENT_VIOLATION: _violation,
}


def render_text(event_type: str, language: str, record, employee: Employee) -> str:
    """Return the full SMS body for an event. KeyError on unknown event."""
    builder = _BUILDERS[event_type]
    lang = "ar" if language == "ar" else "en"
    return builder(record, employee, lang)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_sms_templates.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/sms_templates.py backend/tests/test_sms_templates.py
git commit -m "feat(sms): render full SMS body per event and language"
```

---

### Task 4: SMS gateway client (`sms_client.py`)

The only gateway-specific module: POST plain text to SMS Gate's local API.

**Files:**
- Create: `backend/app/services/sms_client.py`
- Create: `backend/tests/test_sms_client.py`

**Interfaces:**
- Consumes: `app.config.get_settings` (`sms_gateway_url`, `sms_username`, `sms_password`)
- Produces:
  - `SendResult` dataclass: `ok: bool`, `message_id: str | None = None`, `error: str | None = None`
  - `send(phone: str, text: str) -> SendResult`
  - module-level `_transport: httpx.BaseTransport | None` (overridable in tests)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_sms_client.py`:

```python
import base64
import json

import httpx

from app.services import sms_client as sc


def _settings(monkeypatch, base="http://192.168.1.50:8080"):
    monkeypatch.setenv("GSSG_SMS_GATEWAY_URL", base)
    monkeypatch.setenv("GSSG_SMS_USERNAME", "user")
    monkeypatch.setenv("GSSG_SMS_PASSWORD", "pass")
    from app.config import get_settings
    get_settings.cache_clear()
    return get_settings()


def test_send_success_builds_payload_and_basic_auth(monkeypatch):
    _settings(monkeypatch)
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "sms-1", "state": "Pending"})

    monkeypatch.setattr(sc, "_transport", httpx.MockTransport(handler))
    res = sc.send("+971501234567", "Hello world")
    assert res.ok is True
    assert res.message_id == "sms-1"
    assert captured["url"] == "http://192.168.1.50:8080/message"
    expected = "Basic " + base64.b64encode(b"user:pass").decode()
    assert captured["auth"] == expected
    assert captured["body"] == {
        "textMessage": {"text": "Hello world"},
        "phoneNumbers": ["+971501234567"],
    }


def test_send_tolerates_schemeless_base_defaults_http(monkeypatch):
    _settings(monkeypatch, base="192.168.1.50:8080/")
    captured = {}

    def handler(request):
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"id": "sms-2"})

    monkeypatch.setattr(sc, "_transport", httpx.MockTransport(handler))
    res = sc.send("+971501234567", "hi")
    assert res.ok is True
    assert captured["url"] == "http://192.168.1.50:8080/message"


def test_send_http_error_maps_message(monkeypatch):
    _settings(monkeypatch)

    def handler(request):
        return httpx.Response(401, text="Unauthorized")

    monkeypatch.setattr(sc, "_transport", httpx.MockTransport(handler))
    res = sc.send("+971501234567", "hi")
    assert res.ok is False
    assert "401" in res.error
    assert "Unauthorized" in res.error


def test_send_retries_once_then_fails(monkeypatch):
    _settings(monkeypatch)
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(sc, "_transport", httpx.MockTransport(handler))
    res = sc.send("+971501234567", "hi")
    assert res.ok is False
    assert calls["n"] == 2  # initial + one retry
    assert "boom" in res.error or "connect" in res.error.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_sms_client.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'app.services.sms_client'`)

- [ ] **Step 3: Create the client**

Create `backend/app/services/sms_client.py`:

```python
"""Thin transport to the on-site SMS Gateway (SMS Gate, local mode).

The ONLY module that knows the gateway's HTTP shape. Sends a plain-text SMS to
one recipient via the Android phone's local HTTP API. One retry on
network/timeout; HTTP errors are mapped to a ``SendResult`` so callers never
see a raw exception.

SMS Gate local API:
  POST {gateway_url}/message            (HTTP Basic auth)
  body: {"textMessage": {"text": ...}, "phoneNumbers": ["+9715..."]}
  → 2xx: {"id": "...", "state": "Pending", ...}
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


def _post(url: str, auth: tuple[str, str], headers: dict, payload: dict) -> httpx.Response:
    with httpx.Client(transport=_transport, timeout=_TIMEOUT) as client:
        return client.post(url, auth=auth, headers=headers, json=payload)


def send(phone: str, text: str) -> SendResult:
    cfg = get_settings()
    # SMS Gate local server is plain HTTP; tolerate a base saved without a
    # scheme or with a trailing slash.
    base = cfg.sms_gateway_url.strip().rstrip("/")
    if base and "://" not in base:
        base = "http://" + base
    url = f"{base}/message"
    auth = (cfg.sms_username, cfg.sms_password)
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    payload = {"textMessage": {"text": text}, "phoneNumbers": [phone]}

    last_err: str | None = None
    for attempt in range(2):  # initial + one retry on transport error
        try:
            resp = _post(url, auth, headers, payload)
        except httpx.HTTPError as e:
            last_err = str(e) or e.__class__.__name__
            log.warning("sms: transport error (attempt %d): %s", attempt + 1, last_err)
            continue
        if resp.status_code // 100 == 2:
            try:
                data = resp.json()
            except ValueError:
                data = {}
            return SendResult(ok=True, message_id=data.get("id"))
        return SendResult(ok=False, error=f"HTTP {resp.status_code}: {resp.text}")
    return SendResult(ok=False, error=last_err or "network error")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_sms_client.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/sms_client.py backend/tests/test_sms_client.py
git commit -m "feat(sms): gateway client posting to SMS Gate local API"
```

---

### Task 5: `SmsMessage` model + migration `0044`

**Files:**
- Modify: `backend/app/db/models.py` (add `SmsMessage` after `WhatsAppMessage`, ~line 393)
- Create: `backend/app/db/migrations/versions/0044_sms_messages.py`
- Create: `backend/tests/test_sms_model.py`

**Interfaces:**
- Produces: `app.db.models.SmsMessage` with columns `id, employee_id, event_type, event_ref, language, phone, status, provider_msg_id, error, sent_by, created_at`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_sms_model.py`:

```python
from app.db.models import Employee, SmsMessage


def test_sms_message_row_roundtrip(db_session):
    db_session.add(Employee(id="G1", name_en="John", name_ar="جون", contact="0501234567"))
    db_session.add(SmsMessage(
        employee_id="G1", event_type="leave_approved",
        event_ref="leave_approved:7", language="ar",
        phone="+971501234567", status="sent", provider_msg_id="sms-1",
    ))
    db_session.commit()
    row = db_session.query(SmsMessage).one()
    assert row.id is not None
    assert row.status == "sent"
    assert row.provider_msg_id == "sms-1"
    assert row.created_at is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_sms_model.py -v`
Expected: FAIL (`ImportError: cannot import name 'SmsMessage'`)

- [ ] **Step 3: Add the model**

In `backend/app/db/models.py`, immediately after the `WhatsAppMessage` class, add:

```python
class SmsMessage(Base):
    """One SMS send attempt (success or failure) for an employee.

    Mirrors WhatsAppMessage but for the on-site SIM gateway channel: no
    ``template`` column (SMS sends full text), and ``provider_msg_id`` holds
    the gateway's message id. Re-sends are first-class: each attempt is its
    own row. ``event_ref`` (``"<event_type>:<id>"``) keys a record's history.
    """

    __tablename__ = "sms_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"))
    event_type: Mapped[str] = mapped_column(String(32))
    event_ref: Mapped[str] = mapped_column(String(64))
    language: Mapped[str] = mapped_column(String(2))
    phone: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16))  # 'sent' | 'failed'
    provider_msg_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    __table_args__ = (
        Index("ix_sms_messages_event", "event_type", "event_ref"),
    )
```

(`Mapped`, `mapped_column`, `Integer`, `String`, `Text`, `DateTime`, `ForeignKey`, `Index`, `datetime`, and `_utcnow` are already imported/defined in this module for `WhatsAppMessage`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_sms_model.py -v`
Expected: PASS (the `db_session` fixture builds tables from metadata)

- [ ] **Step 5: Write the migration**

Create `backend/app/db/migrations/versions/0044_sms_messages.py`:

```python
"""SMS notifications — per-attempt send log for the SIM gateway channel.

Revision ID: 0044_sms_messages
Revises: 0043_whatsapp_notifications
Create Date: 2026-06-30

Adds ``sms_messages`` (one row per SMS send attempt; audit + "Sent" badge).
Additive only; downgrade drops the table.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0044_sms_messages"
down_revision: str | Sequence[str] | None = "0043_whatsapp_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sms_messages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("event_ref", sa.String(length=64), nullable=False),
        sa.Column("language", sa.String(length=2), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("provider_msg_id", sa.String(length=128), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("sent_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )
    op.create_index("ix_sms_messages_event", "sms_messages", ["event_type", "event_ref"])


def downgrade() -> None:
    op.drop_index("ix_sms_messages_event", table_name="sms_messages")
    op.drop_table("sms_messages")
```

- [ ] **Step 6: Verify the migration chain is linear**

Run: `python -m alembic heads`
Expected: a single head, `0044_sms_messages`. (Run from the directory where alembic is configured — same place the WhatsApp migration was applied; if `alembic` isn't on PATH, use the project's documented migration command.)

- [ ] **Step 7: Commit**

```bash
git add backend/app/db/models.py backend/app/db/migrations/versions/0044_sms_messages.py backend/tests/test_sms_model.py
git commit -m "feat(sms): SmsMessage model and 0044 migration"
```

---

### Task 6: SMS service (`sms_service.py`)

Resolve record → normalize phone → render text → send → log.

**Files:**
- Create: `backend/app/services/sms_service.py`
- Create: `backend/tests/test_sms_service.py`

**Interfaces:**
- Consumes: `notify_format` (`EVENT_*`), `sms_templates.render_text`, `sms_client.send`/`SendResult`, `core.phone.normalize_phone`, `app.db.models` (`Employee`, `Leave`, `Violation`, `SmsMessage`)
- Produces:
  - `SmsDisabledError(RuntimeError)`, `RecordNotFoundError(LookupError)`
  - `send_for_event(db: Session, event_type: str, record_id: int, sent_by: int | None) -> SmsMessage`
  - `last_status(db: Session, event_type: str, record_id: int) -> SmsMessage | None`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_sms_service.py`:

```python
from datetime import date

import pytest

from app.db.models import Employee, Leave
from app.services import sms_client, sms_service as ss


@pytest.fixture(autouse=True)
def _enable(monkeypatch):
    monkeypatch.setenv("GSSG_SMS_ENABLED", "1")
    monkeypatch.setenv("GSSG_SMS_GATEWAY_URL", "http://192.168.1.50:8080")
    monkeypatch.setenv("GSSG_SMS_USERNAME", "user")
    monkeypatch.setenv("GSSG_SMS_PASSWORD", "pass")
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
        sms_client, "send",
        lambda *a, **k: sms_client.SendResult(ok=True, message_id="sms-1"),
    )
    row = ss.send_for_event(db_session, "leave_approved", 7, sent_by=99)
    assert row.status == "sent"
    assert row.provider_msg_id == "sms-1"
    assert row.phone == "+971501234567"
    assert row.sent_by == 99
    assert ss.last_status(db_session, "leave_approved", 7).id == row.id


def test_send_passes_rendered_text_to_client(db_session, monkeypatch):
    _leave(db_session, lang="en")
    captured = {}

    def fake_send(phone, text):
        captured["phone"] = phone
        captured["text"] = text
        return sms_client.SendResult(ok=True, message_id="sms-2")

    monkeypatch.setattr(sms_client, "send", fake_send)
    ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert captured["phone"] == "+971501234567"
    assert captured["text"].startswith("Dear John,")
    assert captured["text"].endswith("Al Wathba Rehabilitation Centre")


def test_missing_phone_logs_failed_without_calling_client(db_session, monkeypatch):
    _leave(db_session, contact="n/a")
    called = {"n": 0}

    def boom(*a, **k):
        called["n"] += 1
        raise AssertionError("client must not be called")

    monkeypatch.setattr(sms_client, "send", boom)
    row = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert row.status == "failed"
    assert "phone" in row.error.lower()
    assert called["n"] == 0


def test_api_failure_logs_failed_with_error(db_session, monkeypatch):
    _leave(db_session)
    monkeypatch.setattr(
        sms_client, "send",
        lambda *a, **k: sms_client.SendResult(ok=False, error="HTTP 401: Unauthorized"),
    )
    row = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert row.status == "failed"
    assert row.error == "HTTP 401: Unauthorized"


def test_resend_writes_new_row(db_session, monkeypatch):
    _leave(db_session)
    monkeypatch.setattr(
        sms_client, "send",
        lambda *a, **k: sms_client.SendResult(ok=True, message_id="sms-x"),
    )
    r1 = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    r2 = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert r1.id != r2.id
    assert ss.last_status(db_session, "leave_approved", 7).id == r2.id


def test_disabled_raises(db_session, monkeypatch):
    monkeypatch.setenv("GSSG_SMS_ENABLED", "0")
    from app.config import get_settings
    get_settings.cache_clear()
    _leave(db_session)
    with pytest.raises(ss.SmsDisabledError):
        ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)


def test_unknown_record_raises(db_session):
    with pytest.raises(ss.RecordNotFoundError):
        ss.send_for_event(db_session, "leave_approved", 9999, sent_by=1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_sms_service.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'app.services.sms_service'`)

- [ ] **Step 3: Create the service**

Create `backend/app/services/sms_service.py`:

```python
"""Resolve → send → log an SMS notification for an HR event.

Loads the source record + employee, normalizes the phone (from ``contact``),
resolves the language preference, renders the full SMS text, calls the gateway
client, and persists every attempt to ``sms_messages``. Re-sends are
first-class — each call writes a new row. ``last_status`` powers the badge.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.phone import normalize_phone
from app.db.models import Employee, Leave, SmsMessage, Violation
from app.services import notify_format as nf, sms_client, sms_templates

log = logging.getLogger(__name__)


class SmsDisabledError(RuntimeError):
    """Raised when an admin tries to send while SMS is not configured."""


class RecordNotFoundError(LookupError):
    """Raised when the event's source record does not exist."""


def _load_leave(db: Session, rid: int) -> Leave | None:
    return db.get(Leave, rid)


def _load_violation(db: Session, rid: int) -> Violation | None:
    return db.get(Violation, rid)


_LOADERS = {
    nf.EVENT_LEAVE_APPROVED: _load_leave,
    nf.EVENT_DUTY_RESUMPTION: _load_leave,
    nf.EVENT_VIOLATION: _load_violation,
}


def _log_row(db, *, employee_id, event_type, record_id, language, phone,
             status, provider_msg_id=None, error=None, sent_by=None):
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
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def send_for_event(
    db: Session, event_type: str, record_id: int, sent_by: int | None
) -> SmsMessage:
    cfg = get_settings()
    if not cfg.sms_enabled:
        raise SmsDisabledError("SMS notifications are not enabled")

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
    phone = normalize_phone(employee.contact, default_cc=cfg.sms_country_code)
    text = sms_templates.render_text(event_type, lang, record, employee)

    if phone is None:
        log.info("sms: no valid phone for employee %s", employee.id)
        return _log_row(
            db, employee_id=employee.id, event_type=event_type, record_id=record_id,
            language=lang, phone=None, status="failed",
            error="No valid phone number for this employee", sent_by=sent_by,
        )

    result = sms_client.send(phone, text)
    return _log_row(
        db, employee_id=employee.id, event_type=event_type, record_id=record_id,
        language=lang, phone=phone,
        status="sent" if result.ok else "failed",
        provider_msg_id=result.message_id, error=result.error, sent_by=sent_by,
    )


def last_status(db: Session, event_type: str, record_id: int) -> SmsMessage | None:
    return db.scalar(
        select(SmsMessage)
        .where(SmsMessage.event_ref == f"{event_type}:{record_id}")
        .order_by(SmsMessage.id.desc())
        .limit(1)
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_sms_service.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/sms_service.py backend/tests/test_sms_service.py
git commit -m "feat(sms): resolve/send/log service for SMS notifications"
```

---

### Task 7: SMS API (`schemas/sms.py`, `api/v1/sms.py`, router registration)

**Files:**
- Create: `backend/app/schemas/sms.py`
- Create: `backend/app/api/v1/sms.py`
- Modify: `backend/app/main.py` (import + include_router, ~lines 35 and 202)
- Create: `backend/tests/test_sms_api.py`

**Interfaces:**
- Consumes: `sms_service`, `app.api.deps.require_capability`, `app.db.session.get_db`
- Produces routes: `POST /api/v1/sms/send`, `GET /api/v1/sms/status` (both require `employees.notify`)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_sms_api.py`. Mirror the structure of `tests/test_whatsapp_api.py` (read it first for the auth-client fixture names). Use the same fixtures that file uses; the SMS-specific assertions are:

```python
from datetime import date

import pytest

from app.db.models import Employee, Leave
from app.services import sms_client


@pytest.fixture(autouse=True)
def _enable(monkeypatch):
    monkeypatch.setenv("GSSG_SMS_ENABLED", "1")
    monkeypatch.setenv("GSSG_SMS_GATEWAY_URL", "http://192.168.1.50:8080")
    monkeypatch.setenv("GSSG_SMS_USERNAME", "user")
    monkeypatch.setenv("GSSG_SMS_PASSWORD", "pass")
    from app.config import get_settings
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _seed_leave(db):
    db.add(Employee(id="G1", name_en="John", name_ar="جون",
                    contact="0501234567", msg_language="en"))
    db.add(Leave(id=7, employee_id="G1", leave_type="Annual - سنوية",
                 start_date=date(2026, 7, 5), end_date=date(2026, 7, 9), days=5,
                 status="Approved"))
    db.commit()


def test_send_requires_capability(client_without_notify, db_session):
    _seed_leave(db_session)
    resp = client_without_notify.post(
        "/api/v1/sms/send", json={"event_type": "leave_approved", "record_id": 7})
    assert resp.status_code == 403


def test_send_happy_path(client_with_notify, db_session, monkeypatch):
    _seed_leave(db_session)
    monkeypatch.setattr(
        sms_client, "send",
        lambda *a, **k: sms_client.SendResult(ok=True, message_id="sms-1"))
    resp = client_with_notify.post(
        "/api/v1/sms/send", json={"event_type": "leave_approved", "record_id": 7})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "sent"
    assert body["message_id"] == "sms-1"


def test_status_reports_enabled_and_last(client_with_notify, db_session, monkeypatch):
    _seed_leave(db_session)
    monkeypatch.setattr(
        sms_client, "send",
        lambda *a, **k: sms_client.SendResult(ok=True, message_id="sms-1"))
    client_with_notify.post(
        "/api/v1/sms/send", json={"event_type": "leave_approved", "record_id": 7})
    resp = client_with_notify.get(
        "/api/v1/sms/status", params={"event_type": "leave_approved", "record_id": 7})
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is True
    assert body["last"]["status"] == "sent"


def test_send_disabled_returns_409(client_with_notify, db_session, monkeypatch):
    monkeypatch.setenv("GSSG_SMS_ENABLED", "0")
    from app.config import get_settings
    get_settings.cache_clear()
    _seed_leave(db_session)
    resp = client_with_notify.post(
        "/api/v1/sms/send", json={"event_type": "leave_approved", "record_id": 7})
    assert resp.status_code == 409


def test_send_missing_record_returns_404(client_with_notify, db_session):
    resp = client_with_notify.post(
        "/api/v1/sms/send", json={"event_type": "leave_approved", "record_id": 9999})
    assert resp.status_code == 404
```

> NOTE: `client_with_notify` / `client_without_notify` are the authenticated test clients used by `tests/test_whatsapp_api.py`. Use the exact fixture names from that file; if they differ, reuse whatever it uses to build a client with/without the `employees.notify` capability.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_sms_api.py -v`
Expected: FAIL (404 on `/api/v1/sms/send` — route not registered)

- [ ] **Step 3: Create the schemas**

Create `backend/app/schemas/sms.py`:

```python
"""SMS notification API schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas._base import ORMBase

EventType = Literal["leave_approved", "duty_resumption", "violation"]


class SmsSendRequest(BaseModel):
    event_type: EventType
    record_id: int


class SmsSendResponse(BaseModel):
    status: Literal["sent", "failed"]
    message_id: str | None = None
    error: str | None = None


class SmsStatusItem(ORMBase):
    event_type: str
    event_ref: str
    language: str
    status: str
    error: str | None
    created_at: datetime


class SmsStatusResponse(BaseModel):
    enabled: bool = False
    last: SmsStatusItem | None = None
```

- [ ] **Step 4: Create the route module**

Create `backend/app/api/v1/sms.py`:

```python
# backend/app/api/v1/sms.py
"""Employee SMS notification routes (on-site SIM gateway channel).

  POST /sms/send             — manually send a notification for a record
  GET  /sms/status           — most recent send attempt for a record

Both require the ``employees.notify`` capability.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.config import get_settings
from app.db.models import User
from app.db.session import get_db
from app.schemas.sms import (
    SmsSendRequest,
    SmsSendResponse,
    SmsStatusItem,
    SmsStatusResponse,
)
from app.services import sms_service

router = APIRouter(prefix="/sms", tags=["sms"])


@router.post("/send", response_model=SmsSendResponse)
def send(
    payload: SmsSendRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("employees.notify"))],
) -> SmsSendResponse:
    try:
        row = sms_service.send_for_event(
            db, payload.event_type, payload.record_id, sent_by=user.id
        )
    except sms_service.SmsDisabledError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except sms_service.RecordNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return SmsSendResponse(status=row.status, message_id=row.provider_msg_id, error=row.error)


@router.get("/status", response_model=SmsStatusResponse)
def get_status(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.notify"))],
    event_type: str = Query(...),
    record_id: int = Query(...),
) -> SmsStatusResponse:
    row = sms_service.last_status(db, event_type, record_id)
    return SmsStatusResponse(
        enabled=get_settings().sms_enabled,
        last=SmsStatusItem.model_validate(row) if row else None,
    )


__all__ = ["router"]
```

- [ ] **Step 5: Register the router in `main.py`**

In `backend/app/main.py`, beside the WhatsApp import (line ~35):

```python
from app.api.v1 import sms as sms_v1
```

And beside the WhatsApp `include_router` (line ~202):

```python
    app.include_router(sms_v1.router, prefix="/api/v1", dependencies=auth_gate)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `python -m pytest tests/test_sms_api.py -v`
Expected: PASS

- [ ] **Step 7: Run the full backend suite (regression gate)**

Run: `python -m pytest -q`
Expected: PASS (all SMS + WhatsApp + existing suites green)

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas/sms.py backend/app/api/v1/sms.py backend/app/main.py backend/tests/test_sms_api.py
git commit -m "feat(sms): /sms/send and /sms/status API routes"
```

---

### Task 8: Frontend — API client, `SendSmsButton`, wiring, i18n

**Files:**
- Modify: `frontend/src/lib/api.ts` (add SMS types + `sendSms`/`getSmsStatus`, after the WhatsApp block ~line 1540)
- Create: `frontend/src/components/sms/SendSmsButton.tsx`
- Create: `frontend/src/components/sms/SendSmsButton.test.tsx`
- Modify: `frontend/src/pages/leaves/TabRecords.tsx` (add SMS button beside the WhatsApp buttons, ~lines 498/501)
- Modify: `frontend/src/components/employees/ViolationsTable.tsx` (add SMS button beside WhatsApp, ~line 138)
- Modify: `frontend/src/locales/en.json` and `frontend/src/locales/ar.json` (add `"sms"` block)

**Interfaces:**
- Consumes: `request` helper in `api.ts`; `useCapabilities`; `react-i18next`
- Produces:
  - `SmsEventType = 'leave_approved' | 'duty_resumption' | 'violation'`
  - `SmsSendResponse { status: 'sent' | 'failed'; message_id: string | null; error: string | null }`
  - `SmsStatus { event_type; event_ref; language; status; error; created_at }`
  - `sendSms(eventType, recordId)`, `getSmsStatus(eventType, recordId)`
  - `<SendSmsButton eventType recordId />`

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/components/sms/SendSmsButton.test.tsx`:

```tsx
// frontend/src/components/sms/SendSmsButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SendSmsButton } from './SendSmsButton'
import * as api from '../../lib/api'

let mockHas = (_cap: string) => true
vi.mock('../../lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (c: string) => mockHas(c) }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe('SendSmsButton', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockHas = () => true
  })

  it('sends an SMS when clicked', async () => {
    vi.spyOn(api, 'getSmsStatus').mockResolvedValue({ enabled: true, last: null })
    vi.spyOn(api, 'sendSms').mockResolvedValue({ status: 'sent', message_id: 'sms-1', error: null })
    render(<SendSmsButton eventType="leave_approved" recordId={7} />)
    const btn = await screen.findByRole('button')
    fireEvent.click(btn)
    await waitFor(() => expect(api.sendSms).toHaveBeenCalledWith('leave_approved', 7))
  })

  it('renders nothing without the notify capability', async () => {
    mockHas = () => false
    vi.spyOn(api, 'getSmsStatus').mockResolvedValue({ enabled: true, last: null })
    const { container } = render(<SendSmsButton eventType="violation" recordId={1} />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('renders nothing when the channel is disabled', async () => {
    vi.spyOn(api, 'getSmsStatus').mockResolvedValue({ enabled: false, last: null })
    const { container } = render(<SendSmsButton eventType="violation" recordId={1} />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/components/sms/SendSmsButton.test.tsx`
Expected: FAIL (cannot resolve `./SendSmsButton` and `api.sendSms`/`getSmsStatus`)

- [ ] **Step 3: Add the API client types + methods**

In `frontend/src/lib/api.ts`, after the WhatsApp section (after the `getWhatsAppStatus` standalone function, ~line 1540), add:

```ts
// --- Employee SMS notifications (on-site SIM gateway) ----------------------
export type SmsEventType = 'leave_approved' | 'duty_resumption' | 'violation'

export interface SmsSendResponse {
  status: 'sent' | 'failed'
  message_id: string | null
  error: string | null
}

export interface SmsStatus {
  event_type: string
  event_ref: string
  language: string
  status: string
  error: string | null
  created_at: string
}

export function sendSms(
  eventType: SmsEventType,
  recordId: number,
): Promise<SmsSendResponse> {
  return request<SmsSendResponse>('POST', '/sms/send', { event_type: eventType, record_id: recordId })
}

export async function getSmsStatus(
  eventType: SmsEventType,
  recordId: number,
): Promise<{ enabled: boolean; last: SmsStatus | null }> {
  return request<{ enabled: boolean; last: SmsStatus | null }>(
    'GET',
    `/sms/status?event_type=${eventType}&record_id=${recordId}`,
  )
}
```

> If the `api` object (the one exposing `sendWhatsApp:`/`getWhatsAppStatus:` as methods, ~line 1485) is the surface the app actually imports, also add `sendSms`/`getSmsStatus` methods there mirroring those two entries. The component below imports the standalone `sendSms`/`getSmsStatus` functions, which the test mocks via `vi.spyOn(api, ...)`.

- [ ] **Step 4: Create the component**

Create `frontend/src/components/sms/SendSmsButton.tsx` (mirrors `SendWhatsAppButton`, swapping API + i18n namespace):

```tsx
// frontend/src/components/sms/SendSmsButton.tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  sendSms, getSmsStatus,
  type SmsEventType, type SmsStatus,
} from '../../lib/api'
import { useCapabilities } from '../../lib/useCapabilities'

interface Props {
  eventType: SmsEventType
  recordId: number
}

export function SendSmsButton({ eventType, recordId }: Props) {
  const { t } = useTranslation()
  const caps = useCapabilities()
  const [enabled, setEnabled] = useState(false)
  const [last, setLast] = useState<SmsStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getSmsStatus(eventType, recordId)
      .then((res) => { if (alive) { setEnabled(res.enabled); setLast(res.last) } })
      .catch(() => {})
    return () => { alive = false }
  }, [eventType, recordId])

  if (!caps.has('employees.notify') || !enabled) return null

  const alreadySent = last?.status === 'sent'

  async function onClick() {
    if (alreadySent && !window.confirm(t('sms.confirmResend'))) return
    setBusy(true); setError(null)
    try {
      const res = await sendSms(eventType, recordId)
      if (res.status === 'sent') {
        setLast({
          ...(last as SmsStatus),
          status: 'sent',
          error: null,
          created_at: new Date().toISOString(),
          event_type: eventType,
          event_ref: `${eventType}:${recordId}`,
          language: last?.language ?? 'ar',
        })
      } else {
        setError(res.error ?? t('sms.failed'))
      }
    } catch {
      setError(t('sms.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={onClick} disabled={busy}
              title={t('sms.sendTitle')}>
        {busy ? t('sms.sending')
          : alreadySent ? t('sms.resend')
          : t('sms.send')}
      </button>
      {alreadySent && !error && <span aria-label="sent">&#10003;</span>}
      {error && <span role="alert" title={error}>&#9888; {t('sms.failed')}</span>}
    </span>
  )
}
```

- [ ] **Step 5: Run the component test to verify it passes**

Run (from `frontend/`): `npx vitest run src/components/sms/SendSmsButton.test.tsx`
Expected: PASS

- [ ] **Step 6: Add i18n keys**

In `frontend/src/locales/en.json`, add a sibling to the `"whatsapp"` block:

```json
  "sms": {
    "send": "Notify by SMS",
    "resend": "Resend SMS",
    "sending": "Sending…",
    "sendTitle": "Send an SMS to this employee",
    "confirmResend": "Already sent. Send again?",
    "failed": "Send failed"
  },
```

In `frontend/src/locales/ar.json`, add the Arabic equivalent sibling to its `"whatsapp"` block:

```json
  "sms": {
    "send": "إشعار عبر الرسائل القصيرة",
    "resend": "إعادة إرسال الرسالة",
    "sending": "جارٍ الإرسال…",
    "sendTitle": "إرسال رسالة قصيرة إلى هذا الموظف",
    "confirmResend": "تم الإرسال بالفعل. إرسال مرة أخرى؟",
    "failed": "فشل الإرسال"
  },
```

- [ ] **Step 7: Wire the button into the leave records page**

In `frontend/src/pages/leaves/TabRecords.tsx`, add the import beside the WhatsApp one (~line 38):

```tsx
import { SendSmsButton } from '@/components/sms/SendSmsButton'
```

And beside each `SendWhatsAppButton` (~lines 498 and 501), add the SMS sibling:

```tsx
            {leave.status === 'Approved' && (
              <SendSmsButton eventType="leave_approved" recordId={leave.id} />
            )}
            {(!!leave.return_date || !!leave.return_doc_path) && (
              <SendSmsButton eventType="duty_resumption" recordId={leave.id} />
            )}
```

(Place each `SendSmsButton` adjacent to its matching `SendWhatsAppButton` within the same container.)

- [ ] **Step 8: Wire the button into the violations table**

In `frontend/src/components/employees/ViolationsTable.tsx`, add the import beside the WhatsApp one (~line 35):

```tsx
import { SendSmsButton } from '@/components/sms/SendSmsButton'
```

And beside the violation `SendWhatsAppButton` (~line 138):

```tsx
                        <SendWhatsAppButton eventType="violation" recordId={row.id} />
                        <SendSmsButton eventType="violation" recordId={row.id} />
```

- [ ] **Step 9: Typecheck + run the frontend test suite**

Run (from `frontend/`): `npx tsc --noEmit && npx vitest run`
Expected: PASS (typecheck clean; SMS + existing tests green)

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/sms/ frontend/src/pages/leaves/TabRecords.tsx frontend/src/components/employees/ViolationsTable.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(sms): SendSmsButton, API client, wiring, and i18n"
```

---

### Task 9: Deploy docs + `configure-sms.ps1`

**Files:**
- Create: `deploy/SMS-SETUP.md`
- Create: `deploy/configure-sms.ps1`

**Interfaces:** none (operator-facing).

- [ ] **Step 1: Write the setup guide**

Create `deploy/SMS-SETUP.md`:

```markdown
# SMS Notifications Setup (on-site Android SIM gateway)

Employee SMS notifications for leave approvals, duty resumptions, and
violations. Messages are text-only, bilingual (Arabic default, English per
employee), sent manually by an admin via the "Notify by SMS" button on each
record. Delivery goes through an **Android phone on the LAN running SMS Gate**
(local mode), which sends the SMS from its own SIM — no carrier sender
registration and no trade license required.

## 1. Prepare the Android phone

1. Install **SMS Gate** (sms-gate.app) on the company Android phone.
2. Enable the **Local Server** and set a **username + password**.
3. Note the phone's **LAN IP** and give it a **static IP** (or a DHCP
   reservation on the router) so the address never changes.
4. Grant the app the **send SMS** permission and **disable battery
   optimization** for it so it keeps running.
5. Ensure the SIM has SMS balance/allowance.
6. Keep the phone **on the office Wi-Fi and charging**.

Quick check from the server (replace IP/creds):

    curl -X POST -u USER:PASS -H "Content-Type: application/json" \
      -d '{"textMessage":{"text":"test"},"phoneNumbers":["+9715XXXXXXXX"]}' \
      http://192.168.1.50:8080/message

## 2. Configure the app (env vars)

Set these in `C:\Users\Admin\sentinel\.env`:

| Variable | Purpose | Example |
|---|---|---|
| `GSSG_SMS_ENABLED` | Master on/off; button hidden until `true` | `true` |
| `GSSG_SMS_GATEWAY_URL` | SMS Gate local-server base URL | `http://192.168.1.50:8080` |
| `GSSG_SMS_USERNAME` | Local-server Basic auth user | `gssg` |
| `GSSG_SMS_PASSWORD` | Local-server Basic auth password | `secret` |
| `GSSG_SMS_COUNTRY_CODE` | Default CC for normalizing employee phones | `971` |

Or run `deploy\configure-sms.ps1` (below) to validate + write these.
After editing `.env`, run `mng restart`.

## 3. Test end-to-end

1. Put a test employee's mobile in their **contact** field.
2. With `.env` set + `mng restart` done, approve that employee's leave and
   click **Notify by SMS** → the phone sends the SMS and the badge shows
   `Sent ✓`.

## Notes

- The sender appears as the **SIM's phone number** (no branded sender).
- Consumer-SIM **fair-use** applies — low-volume manual notifications only.
- Each Arabic message is ~3–4 SMS segments (UCS-2 encoding).
- All gateway-specific HTTP lives in `backend/app/services/sms_client.py`.

## Troubleshooting

- **Button not showing:** `GSSG_SMS_ENABLED=true` and service restarted; the
  user has the `employees.notify` capability.
- **"No valid phone number":** the employee's contact field is empty/unparseable.
- **Connection errors:** the phone is off Wi-Fi / asleep / IP changed, or
  battery optimization killed SMS Gate. Verify with the curl check above.
- **401:** username/password mismatch with the SMS Gate local server.
```

- [ ] **Step 2: Write the configure helper**

Read `deploy/configure-whatsapp.ps1` first and mirror its structure (param block, `.env` upsert helper, validation, `-Enable` switch). Create `deploy/configure-sms.ps1` with parameters `-GatewayUrl`, `-Username`, `-Password`, `-CountryCode` (default `971`), and `-Enable`. It must:
  1. Validate reachability by POSTing a no-op/`GET` to the gateway base with Basic auth (a 401 means bad creds; a connection failure means the phone is unreachable) — surface the result clearly.
  2. Upsert these keys into `C:\Users\Admin\sentinel\.env`: `GSSG_SMS_GATEWAY_URL`, `GSSG_SMS_USERNAME`, `GSSG_SMS_PASSWORD`, `GSSG_SMS_COUNTRY_CODE`, and (when `-Enable`) `GSSG_SMS_ENABLED=true`.
  3. Print the next step (`mng restart`).

Keep the `.env` upsert logic identical to `configure-whatsapp.ps1` (same read-modify-write approach) so behavior is consistent.

- [ ] **Step 3: Syntax-check the script**

Run: `powershell -NoProfile -Command "$null = [System.Management.Automation.Language.Parser]::ParseFile('deploy/configure-sms.ps1', [ref]$null, [ref]$null); 'OK'"`
Expected: prints `OK` with no parser errors.

- [ ] **Step 4: Commit**

```bash
git add deploy/SMS-SETUP.md deploy/configure-sms.ps1
git commit -m "docs(sms): SMS Gate setup guide and configure-sms.ps1 helper"
```

---

## Final verification (after all tasks)

- [ ] Backend: from `backend/`, `python -m pytest -q` → all green (SMS, WhatsApp, existing).
- [ ] Frontend: from `frontend/`, `npx tsc --noEmit && npx vitest run` → clean + green.
- [ ] `python -m alembic heads` → single head `0044_sms_messages`.
- [ ] Manual smoke (optional, needs the phone): set `.env`, `mng restart`, approve a test leave, click **Notify by SMS**, confirm receipt + `Sent ✓` badge.

## Notes for the implementer

- WhatsApp code is intentionally left in place and dormant. Do not delete or
  rename it. The only WhatsApp file touched is `whatsapp_templates.py`
  (Task 1), and only to import the extracted helpers — its tests guard it.
- Follow existing patterns; the SMS modules are deliberate mirrors of their
  WhatsApp counterparts so a reviewer can diff them side by side.
```
