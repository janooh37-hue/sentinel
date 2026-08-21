# Leaves SMS updates + Direct-to-Employee send — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five reviewed features: (1) automatic annual-leave ending reminder, (2) sick-leave registered message, (3) cancellation reason inside the cancellation message, (4) post-approval amend of an annual leave with notification, (5) direct-to-employee send on the Send-to-Group page.

**Architecture:** All messages flow through the existing WhatsApp-first/SMS-fallback router (`notify_dispatch`) and are logged in `outbound_messages`. New events get builders in `sms_templates.py`; the reminder is an APScheduler cron job (pattern: monthly digest); amend is a new `POST /leaves/{id}/amend` endpoint + dialog on both leave-detail surfaces; direct send extends `POST /announcements/send` with `employee_ids`.

**Tech Stack:** FastAPI + SQLAlchemy (SQLite) + APScheduler; React 19 + React Query + i18next; pytest / vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-leaves-sms-direct-send-design.md` (wording is LOCKED — copy message strings exactly as written there and here).

## Global Constraints

- Work on a feature branch (e.g. `leaves-sms-updates`) in a worktree — never switch the main checkout's branch. Merge to `main` when done (this checkout is live production; `mng update` pulls `origin/main`).
- Backend commands run through the venv: `venv\Scripts\python.exe -m pytest`, `venv\Scripts\ruff.exe`, `venv\Scripts\mypy.exe`. Frontend: `pnpm -C frontend ...`.
- mypy is strict; pytest runs with `filterwarnings=error`.
- Bilingual rule: every user-visible string exists in BOTH `frontend/src/locales/en.json` and `ar.json`; logical CSS only (`ms-`/`me-`, `text-start`); `dir="auto"` on free-text inputs.
- Both-surfaces rule: any per-record leave action must be wired into BOTH the desktop `report/RecordExpansion.tsx` AND the mobile `TabRecords.tsx` drawer.
- After backend schema/route changes: run the `/sync-api-types` skill; commit `frontend/src/lib/api.types.ts` (note: `backend/openapi.json` is **gitignored in this repo** — do not try to commit it).
- Do NOT commit `backend/templates/*.docx` churn (the live service re-saves them).
- Message wording is locked — do not "improve" the Arabic or English copy.
- Arabic unit for day counts follows the existing codebase convention `يوم` (as in `_leave_approved`'s `المدة: {days} يوم.`), not the mockup's `أيام`.

---

### Task 1: Lifecycle — `can_amend`

**Files:**
- Modify: `backend/app/core/leave_lifecycle.py` (after `can_edit_dates`, ~line 107)
- Test: `backend/tests/test_leave_lifecycle.py` (append)

**Interfaces:**
- Produces: `leave_lifecycle.can_amend(leave_type: str, current_status: str) -> bool` — True only for Annual Leave (`is_annual`) with canonical status `Approved`. Consumed by Task 6 (amend service).

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_leave_lifecycle.py`; match the module's existing import style — it imports `from app.core import leave_lifecycle` or names directly; follow whichever the file uses):

```python
def test_can_amend_annual_approved_only():
    assert leave_lifecycle.can_amend("Annual Leave", "Approved") is True
    # bilingual label + legacy 'Generated' alias both amendable
    assert leave_lifecycle.can_amend("Annual Leave - إجازة سنوية", "Generated") is True
    assert leave_lifecycle.can_amend("Annual Leave", "Pending") is False
    assert leave_lifecycle.can_amend("Annual Leave", "Cancelled") is False
    assert leave_lifecycle.can_amend("Sick Leave", "Approved") is False
    assert leave_lifecycle.can_amend("National Service", "Approved") is False
    assert leave_lifecycle.can_amend("Emergency Leave", "Approved") is False
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_leave_lifecycle.py -k can_amend -v`
Expected: FAIL — `AttributeError: ... has no attribute 'can_amend'`

- [ ] **Step 3: Implement** (in `leave_lifecycle.py`, after `can_edit_dates`):

```python
def can_amend(leave_type: str, current_status: str) -> bool:
    """Post-approval amendment (end date / days only): Annual Leave + Approved.

    Distinct from ``can_edit_dates`` (NS-while-Pending, start+end): an amend
    keeps the start date fixed and is allowed only after approval.
    """
    return is_annual(leave_type) and canonical_status(current_status) == "Approved"
```

Add `"can_amend",` to `__all__` (keep it sorted).

- [ ] **Step 4: Run tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_leave_lifecycle.py -v`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/leave_lifecycle.py backend/tests/test_leave_lifecycle.py
git commit -m "feat(leaves): lifecycle can_amend — annual+approved end-date amendment"
```

---

### Task 2: Cancellation reason line in the cancelled message

**Files:**
- Modify: `backend/app/services/sms_templates.py:100-117` (`_leave_cancelled`)
- Test: `backend/tests/test_sms_templates.py` (append)

**Interfaces:**
- Consumes: `Leave.notes` (already persisted by `leave_service.update_leave` **before** `auto_send_leave_status` fires — no plumbing change).
- Produces: cancelled message with an optional `Reason:` / `سبب الإلغاء:` line.

- [ ] **Step 1: Write the failing tests** (append; reuse the file's `_emp` helper):

```python
def test_leave_cancelled_includes_reason_from_notes():
    emp = _emp(msg_language="en")
    leave = Leave(
        id=21, employee_id="G1", leave_type="Annual Leave",
        start_date=date(2026, 7, 20), end_date=date(2026, 8, 3), days=15,
        notes="Operational requirement — coverage shortage.",
    )
    en = st.render_text("leave_cancelled", "en", leave, emp)
    assert "Reason: Operational requirement — coverage shortage.\n" in en
    ar = st.render_text("leave_cancelled", "ar", leave, emp)
    assert "سبب الإلغاء: Operational requirement — coverage shortage.\n" in ar


def test_leave_cancelled_without_notes_has_no_reason_line():
    emp = _emp(msg_language="en")
    leave = Leave(
        id=22, employee_id="G1", leave_type="Annual Leave",
        start_date=date(2026, 7, 20), end_date=date(2026, 8, 3), days=15,
        notes="   ",
    )
    en = st.render_text("leave_cancelled", "en", leave, emp)
    assert "Reason:" not in en
    ar = st.render_text("leave_cancelled", "ar", leave, emp)
    assert "سبب الإلغاء" not in ar
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_templates.py -k cancelled -v`
Expected: the two new tests FAIL (no reason line rendered)

- [ ] **Step 3: Implement** — replace `_leave_cancelled` with:

```python
def _leave_cancelled(leave, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    typ = nf.type_label(leave.leave_type, lang)
    s = nf.fmt_date(leave.start_date)
    e = nf.fmt_date(leave.end_date)
    # The decision panel's notes become the cancellation reason (spec 2026-07-15).
    reason = (getattr(leave, "notes", None) or "").strip()
    if lang == "ar":
        reason_line = f"سبب الإلغاء: {reason}\n" if reason else ""
        return (
            f"عزيزي {name}،\n"
            f"تم إلغاء إجازتك ({typ}) من {s} إلى {e}.\n"
            f"{reason_line}"
            f"لأي استفسار يرجى مراجعة {nf.ADMIN_OFFICE_AR}.\n"
            f"{_SIGNATURE_AR}"
        )
    reason_line = f"Reason: {reason}\n" if reason else ""
    return (
        f"Dear {name},\n"
        f"Your {typ} from {s} to {e} has been cancelled.\n"
        f"{reason_line}"
        f"For any clarification, please contact the administration office.\n"
        f"{_SIGNATURE_EN}"
    )
```

- [ ] **Step 4: Run tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_templates.py -v`
Expected: PASS (all — existing cancelled tests must still pass; if one asserts the exact full text, it passes because a leave without notes renders no extra line)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/sms_templates.py backend/tests/test_sms_templates.py
git commit -m "feat(notify): cancellation message carries the decision-notes reason"
```

---

### Task 3: Sick-leave registered event

**Files:**
- Modify: `backend/app/services/notify_format.py` (event constants block, lines 16-28)
- Modify: `backend/app/services/sms_templates.py` (new builder + `_BUILDERS`)
- Modify: `backend/app/services/notify_dispatch.py` (`_LOADERS` + `_send_leave_status`)
- Test: `backend/tests/test_sms_templates.py`, `backend/tests/test_notify_dispatch.py` (append)

**Interfaces:**
- Produces: `nf.EVENT_SICK_LEAVE_REGISTERED = "sick_leave_registered"`; builder renders the locked sick wording; `_send_leave_status` swaps `leave_approved → sick_leave_registered` for sick-group leaves (replaces, never both).

- [ ] **Step 1: Write the failing template tests** (append to `test_sms_templates.py`):

```python
def test_sick_leave_registered_full_text_en():
    emp = _emp(msg_language="en")
    leave = Leave(
        id=31, employee_id="G1", leave_type="Sick Leave - الإجازة المرضية",
        start_date=date(2026, 7, 13), end_date=date(2026, 7, 15), days=3,
    )
    text = st.render_text("sick_leave_registered", "en", leave, emp)
    assert text == (
        "Dear John Smith,\n"
        "Your Sick Leave has been registered.\n"
        "Duration: 3 day(s), from 13/07/2026 (Monday) to 15/07/2026 (Wednesday).\n"
        "We wish you a speedy recovery.\n"
        "Al Wathba Rehabilitation Centre"
    )


def test_sick_leave_registered_arabic_wording():
    emp = _emp()
    leave = Leave(
        id=32, employee_id="G1", leave_type="Sick Leave",
        start_date=date(2026, 7, 13), end_date=date(2026, 7, 15), days=3,
    )
    ar = st.render_text("sick_leave_registered", "ar", leave, emp)
    assert "تم تسجيل إجازتك المرضية." in ar
    assert "المدة: 3 يوم، من 13/07/2026 (الاثنين) إلى 15/07/2026 (الأربعاء)." in ar
    assert "نتمنى لك الشفاء العاجل." in ar
    assert ar.endswith("إدارة مركز الإصلاح والتأهيل بالوثبة")
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_templates.py -k sick_leave_registered -v`
Expected: FAIL — `KeyError: 'sick_leave_registered'`

- [ ] **Step 3: Implement the event + builder**

In `notify_format.py`, after `EVENT_LEAVE_CANCELLED` (line 19):

```python
EVENT_SICK_LEAVE_REGISTERED = "sick_leave_registered"
EVENT_LEAVE_ENDING = "leave_ending"
```

(Adding `EVENT_LEAVE_ENDING` now too — Task 4 uses it; harmless here.)

In `sms_templates.py`, after `_leave_cancelled`:

```python
def _sick_leave_registered(leave, emp: Employee, lang: str) -> str:
    """Sick leave is recorded by HR (born Approved) — this replaces the generic
    approval wording for the sick type (spec decision 3)."""
    name = nf.employee_name(emp, lang)
    s, sw = nf.fmt_date(leave.start_date), nf.weekday(leave.start_date, lang)
    e, ew = nf.fmt_date(leave.end_date), nf.weekday(leave.end_date, lang)
    days = str(leave.days)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم تسجيل إجازتك المرضية.\n"
            f"المدة: {days} يوم، من {s} ({sw}) إلى {e} ({ew}).\n"
            f"نتمنى لك الشفاء العاجل.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your Sick Leave has been registered.\n"
        f"Duration: {days} day(s), from {s} ({sw}) to {e} ({ew}).\n"
        f"We wish you a speedy recovery.\n"
        f"{_SIGNATURE_EN}"
    )
```

Register in `_BUILDERS` (after the `EVENT_LEAVE_CANCELLED` entry):

```python
    nf.EVENT_SICK_LEAVE_REGISTERED: _sick_leave_registered,
```

In `notify_dispatch.py` `_LOADERS` (after the `EVENT_DUTY_RESUMPTION` entry):

```python
    nf.EVENT_SICK_LEAVE_REGISTERED: _load_leave,
```

- [ ] **Step 4: Run template tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_templates.py -v`
Expected: PASS

- [ ] **Step 5: Write the failing dispatch-swap test** (append to `backend/tests/test_notify_dispatch.py`; mirror that file's existing fixture/monkeypatch style — it tests `_send_leave_status`/`auto_send_leave_status` with a db session; if it uses the `db_session` fixture, follow suit):

```python
def test_send_leave_status_swaps_sick_to_registered(db_session, monkeypatch):
    from datetime import date as _date

    from app.db.models import Employee, Leave
    from app.services import notify_dispatch as nd

    emp = Employee(id="G9", name_en="Sick Tester", name_ar="مريض", msg_language="en",
                   contact="0501234567")
    db_session.add(emp)
    db_session.commit()
    leave = Leave(employee_id="G9", leave_type="Sick Leave - الإجازة المرضية",
                  start_date=_date(2026, 7, 13), end_date=_date(2026, 7, 15),
                  days=3, status="Approved")
    db_session.add(leave)
    db_session.commit()

    captured: list[str] = []
    monkeypatch.setattr(
        nd, "send_for_event",
        lambda db, event, rid, *, sent_by: captured.append(event),
    )
    nd._send_leave_status(db_session, leave.id, sent_by=None)
    assert captured == ["sick_leave_registered"]


def test_send_leave_status_annual_stays_leave_approved(db_session, monkeypatch):
    from datetime import date as _date

    from app.db.models import Employee, Leave
    from app.services import notify_dispatch as nd

    emp = Employee(id="G10", name_en="Annual Tester", name_ar="سنوي", msg_language="en",
                   contact="0501234568")
    db_session.add(emp)
    db_session.commit()
    leave = Leave(employee_id="G10", leave_type="Annual Leave",
                  start_date=_date(2026, 8, 1), end_date=_date(2026, 8, 25),
                  days=25, status="Approved")
    db_session.add(leave)
    db_session.commit()

    captured: list[str] = []
    monkeypatch.setattr(
        nd, "send_for_event",
        lambda db, event, rid, *, sent_by: captured.append(event),
    )
    nd._send_leave_status(db_session, leave.id, sent_by=None)
    assert captured == ["leave_approved"]
```

- [ ] **Step 6: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_notify_dispatch.py -k swaps_sick -v`
Expected: first test FAILS (`["leave_approved"]` captured instead)

- [ ] **Step 7: Implement the swap** — in `notify_dispatch._send_leave_status`, replace the event lookup block:

```python
    event = _LEAVE_STATUS_EVENTS.get(leave_lifecycle.canonical_status(leave.status))
    if event is None:
        return None
    # Sick leave is recorded, not requested — the dedicated wording replaces
    # the generic approval message (spec 2026-07-15, decision 3).
    if (
        event == nf.EVENT_LEAVE_APPROVED
        and leave_lifecycle.classify_group(leave.leave_type) == "sick"
    ):
        event = nf.EVENT_SICK_LEAVE_REGISTERED
    return send_for_event(db, event, leave_id, sent_by=sent_by)
```

- [ ] **Step 8: Run tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_notify_dispatch.py backend/tests/test_sms_templates.py backend/tests/test_sms_leave_lifecycle.py -v`
Expected: PASS (all)

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/notify_format.py backend/app/services/sms_templates.py backend/app/services/notify_dispatch.py backend/tests/test_sms_templates.py backend/tests/test_notify_dispatch.py
git commit -m "feat(notify): dedicated sick-leave-registered message replaces generic approval"
```

---

### Task 4: Leave-ending reminder template

**Files:**
- Modify: `backend/app/services/sms_templates.py` (imports + builder + `_BUILDERS`)
- Modify: `backend/app/services/notify_dispatch.py` (`_LOADERS`)
- Test: `backend/tests/test_sms_templates.py` (append)

**Interfaces:**
- Consumes: `nf.EVENT_LEAVE_ENDING` (added in Task 3).
- Produces: `render_text("leave_ending", ...)` — locked reminder wording; resume date = `end_date + 1`.

- [ ] **Step 1: Write the failing tests:**

```python
def test_leave_ending_reminder_full_text_en():
    emp = _emp(msg_language="en")
    leave = Leave(
        id=41, employee_id="G1", leave_type="Annual Leave",
        start_date=date(2026, 6, 1), end_date=date(2026, 6, 30), days=30,
    )
    text = st.render_text("leave_ending", "en", leave, emp)
    assert text == (
        "Dear John Smith,\n"
        "Please be informed that your Annual Leave ends on 30/06/2026 (Tuesday), "
        "and duty resumption is due on the following day, 01/07/2026 (Wednesday).\n"
        "Please visit the administration office to register your duty resumption.\n"
        "On official holidays, duty resumption is registered with the on-duty company supervisor.\n"
        "Al Wathba Rehabilitation Centre"
    )


def test_leave_ending_reminder_arabic_locked_wording():
    emp = _emp()
    leave = Leave(
        id=42, employee_id="G1", leave_type="Annual Leave - إجازة سنوية",
        start_date=date(2026, 6, 1), end_date=date(2026, 6, 30), days=30,
    )
    ar = st.render_text("leave_ending", "ar", leave, emp)
    assert (
        "نفيدكم علماً بأن إجازتك السنوية تنتهي بتاريخ 30/06/2026 (الثلاثاء) "
        "على أن تتم المباشرة في اليوم التالي 01/07/2026 (الأربعاء)." in ar
    )
    assert "يرجى مراجعة مكتب الإدارة لتسجيل مباشرة العمل." in ar
    assert "في حال الإجازات الرسمية تتم المباشرة عند مسؤول السرية المناوبة." in ar
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_templates.py -k leave_ending -v`
Expected: FAIL — `KeyError: 'leave_ending'`

- [ ] **Step 3: Implement** — in `sms_templates.py` add the import at the top (after `from __future__ import annotations`):

```python
from datetime import timedelta
```

Add the builder (after `_sick_leave_registered`):

```python
def _leave_ending(leave, emp: Employee, lang: str) -> str:
    """Automatic reminder 2 days before an Approved Annual Leave ends.
    Wording locked in the 2026-07-15 review — do not rephrase."""
    name = nf.employee_name(emp, lang)
    e, ew = nf.fmt_date(leave.end_date), nf.weekday(leave.end_date, lang)
    resume = leave.end_date + timedelta(days=1)
    r, rw = nf.fmt_date(resume), nf.weekday(resume, lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"نفيدكم علماً بأن إجازتك السنوية تنتهي بتاريخ {e} ({ew}) "
            f"على أن تتم المباشرة في اليوم التالي {r} ({rw}).\n"
            f"يرجى مراجعة مكتب الإدارة لتسجيل مباشرة العمل.\n"
            f"في حال الإجازات الرسمية تتم المباشرة عند مسؤول السرية المناوبة.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Please be informed that your Annual Leave ends on {e} ({ew}), "
        f"and duty resumption is due on the following day, {r} ({rw}).\n"
        f"Please visit the administration office to register your duty resumption.\n"
        f"On official holidays, duty resumption is registered with the on-duty company supervisor.\n"
        f"{_SIGNATURE_EN}"
    )
```

Register in `_BUILDERS`:

```python
    nf.EVENT_LEAVE_ENDING: _leave_ending,
```

And in `notify_dispatch._LOADERS`:

```python
    nf.EVENT_LEAVE_ENDING: _load_leave,
```

- [ ] **Step 4: Run tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_templates.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/sms_templates.py backend/app/services/notify_dispatch.py backend/tests/test_sms_templates.py
git commit -m "feat(notify): annual-leave ending reminder template (locked wording)"
```

---

### Task 5: Reminder selection + scheduler job

**Files:**
- Modify: `backend/app/services/notify_dispatch.py` (new `send_ending_reminders`)
- Modify: `backend/app/services/scheduler_service.py` (job + cron registration + `__all__`)
- Test: `backend/tests/test_notify_dispatch.py`, `backend/tests/test_scheduler_leave_ending.py` (new)

**Interfaces:**
- Produces: `notify_dispatch.send_ending_reminders(db, *, today: date | None = None) -> int` — sends `EVENT_LEAVE_ENDING` for every Approved Annual Leave whose `end_date == today + 2`, not soft-deleted, no return recorded, not already reminded (dedup on `event_ref = "leave_ending:{id}"` via `last_status`). Gated by `_autosend_enabled`.
- Produces: scheduler job `leave-ending-reminder`, daily 09:00 Asia/Dubai.

- [ ] **Step 1: Write the failing selection tests** (append to `test_notify_dispatch.py`):

```python
def _mk_emp_leave(db, *, emp_id, leave_type, status, end, deleted=False, returned=False):
    from datetime import date as _date, datetime as _dt

    from app.db.models import Employee, Leave

    emp = Employee(id=emp_id, name_en=f"E {emp_id}", name_ar="م", msg_language="en",
                   contact="0501112233")
    db.add(emp)
    db.commit()
    leave = Leave(
        employee_id=emp_id, leave_type=leave_type,
        start_date=_date(2026, 6, 1), end_date=end, days=30, status=status,
        deleted_at=_dt(2026, 6, 2) if deleted else None,
        return_date=_date(2026, 6, 20) if returned else None,
    )
    db.add(leave)
    db.commit()
    return leave


def test_ending_reminders_selects_only_approved_annual_ending_in_2_days(db_session, monkeypatch):
    from datetime import date as _date

    from app.services import notify_dispatch as nd

    target = _date(2026, 6, 30)  # today = 28/06 → end == 30/06
    hit = _mk_emp_leave(db_session, emp_id="GA", leave_type="Annual Leave",
                        status="Approved", end=target)
    _mk_emp_leave(db_session, emp_id="GB", leave_type="Annual Leave",
                  status="Cancelled", end=target)
    _mk_emp_leave(db_session, emp_id="GC", leave_type="Sick Leave",
                  status="Approved", end=target)
    _mk_emp_leave(db_session, emp_id="GD", leave_type="Annual Leave",
                  status="Approved", end=_date(2026, 7, 5))  # wrong date
    _mk_emp_leave(db_session, emp_id="GE", leave_type="Annual Leave",
                  status="Approved", end=target, deleted=True)
    _mk_emp_leave(db_session, emp_id="GF", leave_type="Annual Leave",
                  status="Approved", end=target, returned=True)

    monkeypatch.setattr(nd, "_autosend_enabled", lambda db: True)
    sent: list[int] = []
    monkeypatch.setattr(nd, "send_for_event",
                        lambda db, event, rid, *, sent_by: sent.append(rid))

    n = nd.send_ending_reminders(db_session, today=_date(2026, 6, 28))
    assert n == 1
    assert sent == [hit.id]


def test_ending_reminders_dedup_and_gating(db_session, monkeypatch):
    from datetime import date as _date

    from app.db.models import OutboundMessage
    from app.services import notify_dispatch as nd

    target = _date(2026, 6, 30)
    leave = _mk_emp_leave(db_session, emp_id="GH", leave_type="Annual Leave",
                          status="Approved", end=target)
    # A prior reminder row → dedup skips it.
    db_session.add(OutboundMessage(
        employee_id="GH", event_type="leave_ending",
        event_ref=f"leave_ending:{leave.id}", language="en",
        phone="971501112233", body="x", channel="sms", status="sent",
    ))
    db_session.commit()

    monkeypatch.setattr(nd, "_autosend_enabled", lambda db: True)
    sent: list[int] = []
    monkeypatch.setattr(nd, "send_for_event",
                        lambda db, event, rid, *, sent_by: sent.append(rid))
    assert nd.send_ending_reminders(db_session, today=_date(2026, 6, 28)) == 0
    assert sent == []

    # Gating: autosend disabled → no query, no sends.
    monkeypatch.setattr(nd, "_autosend_enabled", lambda db: False)
    assert nd.send_ending_reminders(db_session, today=_date(2026, 6, 28)) == 0
```

Note: if `OutboundMessage` requires other non-nullable columns, supply them the way `test_notify_dispatch.py` already constructs rows — mirror an existing row-creation in that file.

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_notify_dispatch.py -k ending_reminders -v`
Expected: FAIL — `AttributeError: ... no attribute 'send_ending_reminders'`

- [ ] **Step 3: Implement `send_ending_reminders`** — in `notify_dispatch.py`, after `auto_send_for_book`:

```python
def send_ending_reminders(db: Session, *, today: date | None = None) -> int:
    """One-time reminder 2 days before an Approved Annual Leave ends.

    Selection: end_date == today+2, not soft-deleted, no return recorded,
    Annual + Approved (bilingual/legacy labels handled by leave_lifecycle).
    Dedup rides on outbound_messages.event_ref — restart-safe, one per leave.
    """
    if not _autosend_enabled(db):
        return 0
    today = today or date.today()
    target_end = today + timedelta(days=2)
    rows = list(
        db.scalars(
            select(Leave).where(
                Leave.end_date == target_end,
                Leave.deleted_at.is_(None),
                Leave.return_date.is_(None),
            )
        )
    )
    sent = 0
    for leave in rows:
        if not leave_lifecycle.is_annual(leave.leave_type):
            continue
        if leave_lifecycle.canonical_status(leave.status) != "Approved":
            continue
        if last_status(db, nf.EVENT_LEAVE_ENDING, leave.id) is not None:
            continue
        try:
            send_for_event(db, nf.EVENT_LEAVE_ENDING, leave.id, sent_by=None)
            sent += 1
        except Exception:
            log.exception("leave-ending reminder failed for leave %s", leave.id)
    return sent
```

- [ ] **Step 4: Run the selection tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_notify_dispatch.py -k ending_reminders -v`
Expected: PASS

- [ ] **Step 5: Write the failing scheduler tests** — create `backend/tests/test_scheduler_leave_ending.py`:

```python
"""Tests for the daily leave-ending reminder scheduler worker."""

import contextlib
from types import SimpleNamespace

from app.services import scheduler_service as sched


def test_run_leave_ending_reminder_calls_dispatch(monkeypatch):
    called = {"n": 0}
    dummy_session = SimpleNamespace()

    @contextlib.contextmanager
    def _fake_session_local():
        yield dummy_session

    monkeypatch.setattr(sched, "SessionLocal", _fake_session_local)

    def fake_send(db):
        called["n"] += 1
        return 2

    monkeypatch.setattr(sched.notify_dispatch, "send_ending_reminders", fake_send)
    sched._run_leave_ending_reminder()
    assert called["n"] == 1


def test_run_leave_ending_reminder_swallows_errors(monkeypatch):
    dummy_session = SimpleNamespace()

    @contextlib.contextmanager
    def _fake_session_local():
        yield dummy_session

    monkeypatch.setattr(sched, "SessionLocal", _fake_session_local)

    def boom(db):
        raise RuntimeError("gateway down")

    monkeypatch.setattr(sched.notify_dispatch, "send_ending_reminders", boom)
    sched._run_leave_ending_reminder()  # must not raise
```

- [ ] **Step 6: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scheduler_leave_ending.py -v`
Expected: FAIL — no `_run_leave_ending_reminder`

- [ ] **Step 7: Implement the job** — in `scheduler_service.py`:

Constants (after `_DIGEST_JOB_ID`):

```python
_LEAVE_ENDING_JOB_ID = "leave-ending-reminder"
```

Job body (after `_run_monthly_digest`):

```python
def _run_leave_ending_reminder() -> None:
    """Daily 09:00 Asia/Dubai — remind Approved Annual Leaves ending in 2 days."""
    with SessionLocal() as session:
        try:
            n = notify_dispatch.send_ending_reminders(session)
            if n:
                log.info("scheduler: %d leave-ending reminder(s) sent", n)
        except Exception:
            log.exception("scheduler: leave-ending reminder failed")
```

Registration in `start()` (after the monthly-digest `add_job` block):

```python
            _scheduler.add_job(
                _run_leave_ending_reminder,
                trigger=CronTrigger(hour=9, minute=0, timezone="Asia/Dubai"),
                id=_LEAVE_ENDING_JOB_ID,
                replace_existing=True,
            )
            log.info("scheduler: leave-ending reminder daily at 09:00 Asia/Dubai")
```

Add `"_run_leave_ending_reminder",` to `__all__` (sorted).

- [ ] **Step 8: Run tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scheduler_leave_ending.py backend/tests/test_notify_dispatch.py -v`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/notify_dispatch.py backend/app/services/scheduler_service.py backend/tests/test_notify_dispatch.py backend/tests/test_scheduler_leave_ending.py
git commit -m "feat(notify): daily leave-ending reminder job (end-2d, 09:00 Dubai, deduped)"
```

---

### Task 6: Amend backend — render, dispatch, service, route

**Files:**
- Modify: `backend/app/schemas/leave.py` (new `LeaveAmend` after `LeaveUpdate`)
- Modify: `backend/app/services/sms_templates.py` (public `render_leave_amended`)
- Modify: `backend/app/services/notify_dispatch.py` (`auto_send_leave_amended`)
- Modify: `backend/app/services/leave_service.py` (`amend_approved_leave`)
- Modify: `backend/app/api/v1/leaves.py` (route + schema import)
- Test: `backend/tests/test_sms_templates.py`, `backend/tests/test_leave_amend.py` (new)

**Interfaces:**
- Consumes: `leave_lifecycle.can_amend` (Task 1); `notify_dispatch.send_direct` (existing).
- Produces:
  - `LeaveAmend(BaseModel)` — `end_date: date`, `reason: str` (stripped, non-empty).
  - `sms_templates.render_leave_amended(leave, employee, lang, *, old_days: int, reason: str) -> str`
  - `notify_dispatch.auto_send_leave_amended(db, leave_id, *, old_days: int, reason: str, sent_by: int | None = None) -> OutboundMessage | None`
  - `leave_service.amend_approved_leave(db, leave_id, *, end_date: date, reason: str, actor: str | None = None) -> Leave`
  - `POST /api/v1/leaves/{leave_id}/amend` → `LeaveRead` (capability `leaves.edit`). Task 8/10 consume this route as `api.amendLeave(id, {end_date, reason})`.

- [ ] **Step 1: Write the failing render test** (append to `test_sms_templates.py`):

```python
def test_render_leave_amended_full_text_en():
    emp = _emp(msg_language="en")
    leave = Leave(
        id=51, employee_id="G1", leave_type="Annual Leave",
        start_date=date(2026, 8, 1), end_date=date(2026, 8, 20), days=20,
    )
    text = st.render_leave_amended(
        leave, emp, "en", old_days=25, reason="Insufficient annual-leave balance."
    )
    assert text == (
        "Dear John Smith,\n"
        "Your Annual Leave has been updated.\n"
        "Start: 01/08/2026 (Saturday)\n"
        "End: 20/08/2026 (Thursday)\n"
        "New duration: 20 day(s) (was 25).\n"
        "Reason: Insufficient annual-leave balance.\n"
        "For any clarification, please contact the administration office.\n"
        "Al Wathba Rehabilitation Centre"
    )


def test_render_leave_amended_arabic_wording():
    emp = _emp()
    leave = Leave(
        id=52, employee_id="G1", leave_type="Annual Leave - إجازة سنوية",
        start_date=date(2026, 8, 1), end_date=date(2026, 8, 20), days=20,
    )
    ar = st.render_leave_amended(leave, emp, "ar", old_days=25, reason="نقص الرصيد")
    assert "تم تعديل إجازتك السنوية." in ar
    assert "المدة الجديدة: 20 يوم (بدلاً من 25)." in ar
    assert "سبب التعديل: نقص الرصيد" in ar
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_sms_templates.py -k amended -v`
Expected: FAIL — no `render_leave_amended`

- [ ] **Step 3: Implement `render_leave_amended`** — in `sms_templates.py` after `render_text`:

```python
def render_leave_amended(
    leave, employee: Employee, lang: str, *, old_days: int, reason: str
) -> str:
    """Pre-rendered 'your leave was amended' body — the old duration is gone
    from the record after the update, so this cannot ride the _BUILDERS path."""
    lang = "ar" if lang == "ar" else "en"
    name = nf.employee_name(employee, lang)
    s, sw = nf.fmt_date(leave.start_date), nf.weekday(leave.start_date, lang)
    e, ew = nf.fmt_date(leave.end_date), nf.weekday(leave.end_date, lang)
    days = str(leave.days)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم تعديل إجازتك السنوية.\n"
            f"تاريخ البداية: {s} ({sw})\n"
            f"تاريخ النهاية: {e} ({ew})\n"
            f"المدة الجديدة: {days} يوم (بدلاً من {old_days}).\n"
            f"سبب التعديل: {reason}\n"
            f"لأي استفسار يرجى مراجعة {nf.ADMIN_OFFICE_AR}.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your Annual Leave has been updated.\n"
        f"Start: {s} ({sw})\n"
        f"End: {e} ({ew})\n"
        f"New duration: {days} day(s) (was {old_days}).\n"
        f"Reason: {reason}\n"
        f"For any clarification, please contact the administration office.\n"
        f"{_SIGNATURE_EN}"
    )
```

- [ ] **Step 4: Run render tests** — `venv\Scripts\python.exe -m pytest backend/tests/test_sms_templates.py -v` → PASS

- [ ] **Step 5: Write the failing service tests** — create `backend/tests/test_leave_amend.py`:

```python
"""amend_approved_leave — lifecycle gate, day recompute, audit, notify hook."""

from datetime import date

import pytest

from app.api.errors import ValidationFailedError
from app.db.models import AuditLog, Employee, Leave
from app.schemas.leave import LeaveAmend
from app.services import leave_service


def _seed(db, *, leave_type="Annual Leave", status="Approved"):
    emp = Employee(id="GA1", name_en="Amend Tester", name_ar="معدل",
                   msg_language="en", contact="0501234567")
    db.add(emp)
    db.commit()
    leave = Leave(employee_id="GA1", leave_type=leave_type,
                  start_date=date(2026, 8, 1), end_date=date(2026, 8, 25),
                  days=25, status=status)
    db.add(leave)
    db.commit()
    return leave


def test_amend_updates_end_days_notes_and_audits(db_session, monkeypatch):
    leave = _seed(db_session)
    calls: list[dict] = []
    from app.services import notify_dispatch
    monkeypatch.setattr(
        notify_dispatch, "auto_send_leave_amended",
        lambda db, lid, *, old_days, reason, sent_by=None: calls.append(
            {"lid": lid, "old_days": old_days, "reason": reason}
        ),
    )
    row = leave_service.amend_approved_leave(
        db_session, leave.id, end_date=date(2026, 8, 20),
        reason="Insufficient balance", actor="t@x.ae",
    )
    assert row.end_date == date(2026, 8, 20)
    assert row.days == 20
    assert row.notes == "Insufficient balance"
    assert calls == [{"lid": leave.id, "old_days": 25, "reason": "Insufficient balance"}]
    audit = db_session.query(AuditLog).filter(AuditLog.action == "leave.amended").all()
    assert len(audit) == 1


def test_amend_rejected_for_non_amendable_states(db_session):
    pending = _seed(db_session, status="Pending")
    with pytest.raises(ValidationFailedError):
        leave_service.amend_approved_leave(
            db_session, pending.id, end_date=date(2026, 8, 20), reason="x", actor=None
        )


def test_amend_rejects_end_before_start(db_session):
    leave = _seed(db_session)
    with pytest.raises(ValidationFailedError):
        leave_service.amend_approved_leave(
            db_session, leave.id, end_date=date(2026, 7, 31), reason="x", actor=None
        )


def test_leave_amend_schema_requires_reason():
    with pytest.raises(Exception):
        LeaveAmend(end_date=date(2026, 8, 20), reason="   ")
```

Notes for the implementer: `db_session` is the shared fixture from `backend/tests/conftest.py`. If `AuditLog` filtering needs a different query style in this codebase, mirror how other tests assert audit rows (grep `AuditLog` in `backend/tests/`).

- [ ] **Step 6: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_leave_amend.py -v`
Expected: FAIL — `ImportError: cannot import name 'LeaveAmend'`

- [ ] **Step 7: Implement schema, dispatch hook, service, route**

`backend/app/schemas/leave.py` — extend the pydantic import and add after `LeaveUpdate`:

```python
from pydantic import BaseModel, Field, field_validator
```

```python
class LeaveAmend(BaseModel):
    """POST /leaves/{id}/amend — post-approval end-date change (Annual only).

    The reason is required: it is sent to the employee in the notification.
    """

    end_date: date
    reason: str = Field(min_length=1)

    @field_validator("reason")
    @classmethod
    def _strip_reason(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("reason must not be empty")
        return v
```

`backend/app/services/notify_dispatch.py` — after `send_ending_reminders`:

```python
def auto_send_leave_amended(
    db: Session, leave_id: int, *, old_days: int, reason: str, sent_by: int | None = None
) -> OutboundMessage | None:
    """Best-effort 'your leave was amended' notification.

    Pre-rendered via sms_templates.render_leave_amended because the old
    duration is gone from the record after the update. Same gating as the
    other auto-sends.
    """
    if not _autosend_enabled(db):
        return None
    leave = db.get(Leave, leave_id)
    if leave is None or leave.employee_id is None:
        return None
    employee = leave.employee
    lang = "ar" if (employee.msg_language or "ar") == "ar" else "en"
    body = sms_templates.render_leave_amended(
        leave, employee, lang, old_days=old_days, reason=reason
    )
    return send_direct(
        db,
        employee=employee,
        body=body,
        language=lang,
        event_type="leave_amended",
        event_ref=f"leave_amended:{leave_id}",
        sent_by=sent_by,
    )
```

`backend/app/services/leave_service.py` — after `update_leave`:

```python
def amend_approved_leave(
    db: Session, leave_id: int, *, end_date: date, reason: str, actor: str | None = None
) -> Leave:
    """Post-approval amendment: Annual + Approved only, end date/days only
    (start fixed), reason required. Notifies the employee (best-effort) with
    old vs new duration and the reason. Spec 2026-07-15."""
    row = get_leave(db, leave_id)
    if not leave_lifecycle.can_amend(row.leave_type, row.status):
        raise ValidationFailedError(
            "LEAVE_AMEND_FORBIDDEN",
            f"A {row.leave_type!r} record in state {row.status!r} cannot be amended",
            current_status=row.status,
        )
    if end_date < row.start_date:
        raise ValidationFailedError(
            "LEAVE_DATES_INVALID", "end_date must be on or after start_date"
        )
    old = {"end": str(row.end_date), "days": row.days}
    old_days = row.days
    row.end_date = end_date
    row.days = (end_date - row.start_date).days + 1
    row.notes = reason
    row.updated_at = _utcnow()
    _audit(
        db,
        "leave.amended",
        leave_id,
        actor,
        {"from": old, "to": {"end": str(end_date), "days": row.days}, "reason": reason},
    )
    db.commit()
    db.refresh(row)
    _cache_invalidate_employee(row.employee_id)
    # Best-effort — a gateway hiccup must never fail the amendment.
    try:
        from app.services import notify_dispatch

        notify_dispatch.auto_send_leave_amended(
            db, leave_id, old_days=old_days, reason=reason
        )
    except Exception:
        log.exception("auto leave-amended notification failed for leave %s", leave_id)
    return row
```

(`_utcnow` and `_audit` already exist in this module — reuse them; check their exact names near `update_leave` and match.)

`backend/app/api/v1/leaves.py` — add `LeaveAmend` to the `app.schemas.leave` import list (line ~33) and add the route after `update_leave`:

```python
@router.post("/{leave_id}/amend", response_model=LeaveRead)
def amend_leave(
    leave_id: int,
    payload: LeaveAmend,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("leaves.edit"))],
) -> LeaveRead:
    """Post-approval amendment (Annual Leave): change the end date with a
    required reason; the employee is notified with old vs new duration."""
    row = leave_service.amend_approved_leave(
        db, leave_id, end_date=payload.end_date, reason=payload.reason, actor=_user.email
    )
    return _with_employee_name(LeaveRead.model_validate(row), row)
```

Also update the module docstring route list at the top of `leaves.py` (it enumerates the endpoints).

- [ ] **Step 8: Run tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_leave_amend.py backend/tests/test_sms_templates.py -v`
Expected: PASS

- [ ] **Step 9: Lint + typecheck the backend**

Run: `venv\Scripts\ruff.exe check backend && venv\Scripts\mypy.exe`
Expected: clean

- [ ] **Step 10: Commit**

```bash
git add backend/app/schemas/leave.py backend/app/services/sms_templates.py backend/app/services/notify_dispatch.py backend/app/services/leave_service.py backend/app/api/v1/leaves.py backend/tests/test_leave_amend.py backend/tests/test_sms_templates.py
git commit -m "feat(leaves): POST /leaves/{id}/amend — post-approval end-date change + notify"
```

---

### Task 7: Direct-to-employee announcements (backend)

**Files:**
- Modify: `backend/app/schemas/announcement.py` (`DirectSendOut`, `AnnouncementOut`)
- Modify: `backend/app/services/announce_service.py` (`DirectSendResult`, `send_direct_announcement`)
- Modify: `backend/app/api/v1/announcements.py` (`send_announcement` route)
- Test: `backend/tests/test_announce_direct.py` (new), `backend/tests/test_announcements_api.py` (append)

**Interfaces:**
- Consumes: `notify_dispatch.send_direct` (text path); `openwa_client.send_file` + `openwa_client._chat_id` (attachment path); `normalize_phone` from `app.core.phone`.
- Produces:
  - `announce_service.DirectSendResult` dataclass: `employee_id: str, employee_name: str, ok: bool, fell_back: bool = False, error: str | None = None`.
  - `announce_service.send_direct_announcement(db, *, employee_ids: list[str], text: str, attachment: Attachment | None, sent_by: int | None) -> list[DirectSendResult]`.
  - Route: `group_ids` becomes optional, new `employee_ids` form field; 422 unless at least one of the two is non-empty; `AnnouncementOut.announcement_id` becomes `int | None`; new `AnnouncementOut.direct_results: list[DirectSendOut]`. Task 8/11 consume `direct_results` rows `{employee_id, employee_name, ok, fell_back, error}`.

- [ ] **Step 1: Write the failing service tests** — create `backend/tests/test_announce_direct.py`:

```python
"""send_direct_announcement — text routing, unknown ids, attachment path."""

from datetime import date
from types import SimpleNamespace

from app.db.models import Employee
from app.services import announce_service, notify_dispatch, openwa_client


def _emp(db, emp_id="GD1", contact="0501234567"):
    emp = Employee(id=emp_id, name_en=f"Direct {emp_id}", name_ar="مباشر",
                   msg_language="en", contact=contact)
    db.add(emp)
    db.commit()
    return emp


def test_direct_text_routes_through_send_direct(db_session, monkeypatch):
    emp = _emp(db_session)
    calls: list[dict] = []

    def fake_send_direct(db, *, employee, body, language, event_type, event_ref, sent_by):
        calls.append({"emp": employee.id, "body": body, "event": event_type})
        return SimpleNamespace(status="sent", fell_back=False, error=None)

    monkeypatch.setattr(notify_dispatch, "send_direct", fake_send_direct)
    out = announce_service.send_direct_announcement(
        db_session, employee_ids=[emp.id], text="hello", attachment=None, sent_by=1
    )
    assert calls == [{"emp": "GD1", "body": "hello", "event": "announcement_direct"}]
    assert out[0].ok is True and out[0].employee_id == "GD1"


def test_direct_unknown_employee_is_failed_row(db_session):
    out = announce_service.send_direct_announcement(
        db_session, employee_ids=["NOPE"], text="hello", attachment=None, sent_by=1
    )
    assert out[0].ok is False
    assert out[0].error == "employee not found"


def test_direct_attachment_uses_whatsapp_file_send(db_session, monkeypatch):
    emp = _emp(db_session, emp_id="GD2")
    sent: list[dict] = []

    def fake_send_file(chat_id, *, data, filename, caption, mentions=None):
        sent.append({"chat": chat_id, "filename": filename, "caption": caption})
        return SimpleNamespace(ok=True, message_id="m1", error=None)

    monkeypatch.setattr(openwa_client, "send_file", fake_send_file)
    att = announce_service.Attachment(filename="roster.pdf", data=b"%PDF")
    out = announce_service.send_direct_announcement(
        db_session, employee_ids=[emp.id], text="see attached", attachment=att, sent_by=1
    )
    assert out[0].ok is True
    assert sent[0]["filename"] == "roster.pdf"
    assert sent[0]["chat"].endswith("@c.us")
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_announce_direct.py -v`
Expected: FAIL — no `send_direct_announcement`

- [ ] **Step 3: Implement schema + service**

`backend/app/schemas/announcement.py` — pydantic import becomes `from pydantic import BaseModel, Field`; add after `GroupSendOut`:

```python
class DirectSendOut(BaseModel):
    """Outcome of one direct (private) employee send."""

    employee_id: str
    employee_name: str
    ok: bool
    fell_back: bool = False
    error: str | None = None
```

Change `AnnouncementOut` to:

```python
class AnnouncementOut(BaseModel):
    # None when the send had no group targets (direct-only private message).
    announcement_id: int | None = None
    sent: int
    failed: int
    results: list[GroupSendOut]
    direct_results: list[DirectSendOut] = Field(default_factory=list)
```

`backend/app/services/announce_service.py` — extend the models import to include `Employee`:

```python
from app.db.models import Document, Employee, GroupAnnouncement, GroupAnnouncementSend
```

Add `from app.core.phone import normalize_phone` to the imports. Add after `AnnouncementResult`:

```python
@dataclass
class DirectSendResult:
    """Outcome of sending an announcement directly to one employee."""

    employee_id: str
    employee_name: str
    ok: bool
    fell_back: bool = False
    error: str | None = None
```

Add at the end of the module:

```python
def send_direct_announcement(
    db: Session,
    *,
    employee_ids: list[str],
    text: str,
    attachment: Attachment | None,
    sent_by: int | None,
) -> list[DirectSendResult]:
    """Deliver the announcement to individual employees as private messages.

    Text-only sends go through notify_dispatch.send_direct — the standard
    WhatsApp-first / SMS-fallback router with outbound_messages logging.
    With an attachment the file goes to the employee's personal chat via
    openwa_client.send_file with the text as caption (WhatsApp only — SMS
    cannot carry a file).
    """
    results: list[DirectSendResult] = []
    for emp_id in employee_ids:
        emp = db.get(Employee, emp_id)
        if emp is None:
            results.append(
                DirectSendResult(emp_id, emp_id, ok=False, error="employee not found")
            )
            continue
        name = emp.name_en or emp.name_ar or emp.id
        lang = "ar" if (emp.msg_language or "ar") == "ar" else "en"
        if attachment is None:
            row = notify_dispatch.send_direct(
                db,
                employee=emp,
                body=text,
                language=lang,
                event_type="announcement_direct",
                event_ref=f"announcement_direct:{emp.id}",
                sent_by=sent_by,
            )
            results.append(
                DirectSendResult(
                    emp.id,
                    name,
                    ok=row.status in ("sent", "queued"),
                    fell_back=bool(row.fell_back),
                    error=row.error,
                )
            )
            continue
        phone = normalize_phone(emp.contact, default_cc=get_settings().sms_country_code)
        if not phone:
            results.append(
                DirectSendResult(emp.id, name, ok=False, error="no valid phone number")
            )
            continue
        try:
            res = openwa_client.send_file(
                openwa_client._chat_id(phone),
                data=attachment.data,
                filename=attachment.filename,
                caption=text,
            )
            results.append(DirectSendResult(emp.id, name, ok=res.ok, error=res.error))
        except Exception as exc:  # noqa: BLE001 — per-recipient isolation
            results.append(DirectSendResult(emp.id, name, ok=False, error=str(exc)))
    return results
```

(If `openwa_client._chat_id` has a different name/signature, mirror how `notify_dispatch.poll_deliveries` builds the chat id — same call.)

- [ ] **Step 4: Run service tests** — `venv\Scripts\python.exe -m pytest backend/tests/test_announce_direct.py -v` → PASS

- [ ] **Step 5: Write the failing API tests** (append to `test_announcements_api.py`, using its fixtures):

```python
def test_send_requires_some_recipient(admin_client):
    r = admin_client.post("/api/v1/announcements/send", data={"text": "hi"})
    assert r.status_code == 422


def test_send_direct_only(admin_client, monkeypatch):
    monkeypatch.setattr(
        announce_service,
        "send_direct_announcement",
        lambda db, *, employee_ids, text, attachment, sent_by: [
            announce_service.DirectSendResult("G1", "John", ok=True),
            announce_service.DirectSendResult("G2", "Ali", ok=False, error="no valid phone number"),
        ],
    )
    r = admin_client.post(
        "/api/v1/announcements/send",
        data={"text": "hi", "employee_ids": ["G1", "G2"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["announcement_id"] is None
    assert body["sent"] == 1 and body["failed"] == 1
    assert body["results"] == []
    assert body["direct_results"][0] == {
        "employee_id": "G1", "employee_name": "John",
        "ok": True, "fell_back": False, "error": None,
    }


def test_send_groups_and_direct_counts_combine(admin_client, monkeypatch):
    monkeypatch.setattr(
        announce_service, "groups_available",
        lambda db: [SimpleNamespace(id="1@g.us", name="Alpha")],
    )
    monkeypatch.setattr(
        announce_service, "send_announcement",
        lambda db, *, groups, text, attachment, book_id, sent_by, mentions=None: SimpleNamespace(
            announcement_id=7, sent=1, failed=0,
            results=[SimpleNamespace(group_id="1@g.us", group_name="Alpha", ok=True, error=None)],
        ),
    )
    monkeypatch.setattr(
        announce_service, "send_direct_announcement",
        lambda db, *, employee_ids, text, attachment, sent_by: [
            announce_service.DirectSendResult("G1", "John", ok=True),
        ],
    )
    r = admin_client.post(
        "/api/v1/announcements/send",
        data={"text": "hi", "group_ids": ["1@g.us"], "employee_ids": ["G1"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["announcement_id"] == 7
    assert body["sent"] == 2 and body["failed"] == 0
```

- [ ] **Step 6: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_announcements_api.py -v`
Expected: new tests FAIL (`group_ids` currently required → 422 on all three; assertions on the direct fields fail)

- [ ] **Step 7: Rework the route** — in `announcements.py`, change the `send_announcement` signature and body:

```python
@router.post("/send", response_model=AnnouncementOut)
async def send_announcement(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("messages.broadcast"))],
    group_ids: Annotated[list[str] | None, Form()] = None,
    employee_ids: Annotated[list[str] | None, Form()] = None,
    text: Annotated[str, Form()] = "",
    book_id: Annotated[int | None, Form()] = None,
    file: Annotated[UploadFile | None, File()] = None,
    mentions: Annotated[list[str] | None, Form()] = None,
) -> AnnouncementOut:
    """Fan-out a message to groups and/or directly to employees (private chats)."""
    if not (group_ids or employee_ids):
        raise HTTPException(status_code=422, detail="at least one group or employee required")

    # Resolve attachment.
    attachment: announce_service.Attachment | None = None
    if file is not None:
        attachment = announce_service.Attachment(
            filename=file.filename or "file",
            data=await file.read(),
        )
    elif book_id is not None:
        try:
            filename, data = announce_service.resolve_book_pdf(db, book_id)
        except announce_service.BookPdfError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        attachment = announce_service.Attachment(filename=filename, data=data)

    # Require text or attachment.
    if not text.strip() and attachment is None:
        raise HTTPException(status_code=422, detail="text or attachment required")

    # Group fan-out (unchanged) — only when groups were requested.
    result = None
    if group_ids:
        available = announce_service.groups_available(db)
        target_ids = set(group_ids)
        groups = [(g.id, g.name) for g in available if g.id in target_ids]
        if not groups:
            raise HTTPException(status_code=422, detail="no matching groups found")
        result = announce_service.send_announcement(
            db,
            groups=groups,
            text=text,
            attachment=attachment,
            book_id=(book_id if file is None else None),
            sent_by=user.id,
            mentions=mentions or [],
        )

    # Direct (private) fan-out. @mentions are a group-chat concept — the plain
    # text is sent as-is to each employee.
    direct = (
        announce_service.send_direct_announcement(
            db,
            employee_ids=employee_ids,
            text=text.strip(),
            attachment=attachment,
            sent_by=user.id,
        )
        if employee_ids
        else []
    )

    sent = (result.sent if result else 0) + sum(1 for d in direct if d.ok)
    failed = (result.failed if result else 0) + sum(1 for d in direct if not d.ok)
    return AnnouncementOut(
        announcement_id=result.announcement_id if result else None,
        sent=sent,
        failed=failed,
        results=[
            GroupSendOut(
                group_id=r.group_id,
                group_name=r.group_name,
                ok=r.ok,
                error=r.error,
            )
            for r in (result.results if result else [])
        ],
        direct_results=[
            DirectSendOut(
                employee_id=d.employee_id,
                employee_name=d.employee_name,
                ok=d.ok,
                fell_back=d.fell_back,
                error=d.error,
            )
            for d in direct
        ],
    )
```

Add `DirectSendOut` to the `app.schemas.announcement` import list.

- [ ] **Step 8: Run all announcement tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_announcements_api.py backend/tests/test_announce_direct.py backend/tests/test_announce_service_send.py -v`
Expected: PASS (existing group-send tests must not regress)

- [ ] **Step 9: Lint + typecheck** — `venv\Scripts\ruff.exe check backend && venv\Scripts\mypy.exe` → clean
  (If ruff flags the private `openwa_client._chat_id` usage or `BLE001`, keep the inline `# noqa` shown above / mirror how `notify_dispatch` handles the same calls.)

- [ ] **Step 10: Commit**

```bash
git add backend/app/schemas/announcement.py backend/app/services/announce_service.py backend/app/api/v1/announcements.py backend/tests/test_announce_direct.py backend/tests/test_announcements_api.py
git commit -m "feat(announcements): direct-to-employee send — employee_ids, groups now optional"
```

---

### Task 8: Resync API types + frontend api wrappers

**Files:**
- Regenerate: `frontend/src/lib/api.types.ts` (via the `/sync-api-types` skill)
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Produces: `api.amendLeave(id: number, body: LeaveAmend) -> Promise<LeaveRead>`; regenerated `AnnouncementOut` type with `direct_results`; `LeaveAmend` type export. Tasks 10-11 consume these.

- [ ] **Step 1: Run the `/sync-api-types` skill** (dump openapi from the backend app → `pnpm -C frontend run gen:api` → typecheck). Follow the skill's own steps exactly.

- [ ] **Step 2: Add the wrapper** — in `frontend/src/lib/api.ts`, next to `updateLeave` (~line 883), following the file's existing type-alias pattern (e.g. how `LeaveUpdate` is exported):

```ts
export type LeaveAmend = components['schemas']['LeaveAmend']
```

```ts
  amendLeave: (id: number, body: LeaveAmend) =>
    request<LeaveRead>('POST', `/leaves/${id}/amend`, body),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -C frontend exec tsc -b --noEmit`
Expected: clean (the `AnnouncementOut` change is additive; `announcement_id: int | null` is unused by the page)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.types.ts frontend/src/lib/api.ts
git commit -m "chore(api): resync types — amend endpoint + direct announcement results"
```

---

### Task 9: Cancel requires a reason (both leave surfaces)

**Files:**
- Modify: `frontend/src/pages/leaves/report/RecordExpansion.tsx` (notes block + Cancel button)
- Modify: `frontend/src/pages/leaves/TabRecords.tsx` (LeaveDetailDrawer, ~lines 408-460)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/pages/leaves/report/RecordExpansion.cancelReason.test.tsx` (new)

**Interfaces:**
- Consumes: existing `useLeaveDecisionActions` (unchanged — the reason still travels as `notes`).
- Produces: Cancel disabled until the effective notes value is non-empty; a hint that the reason is sent to the employee.

- [ ] **Step 1: Locale keys** — add under the `leaves.report` object in `en.json`:

```json
"cancelReasonHint": "A reason is required to cancel — it is sent to the employee."
```

and in `ar.json` (same key path):

```json
"cancelReasonHint": "سبب الإلغاء إلزامي — يُرسل إلى الموظف."
```

(Match the surrounding JSON structure/indentation of the `leaves.report` section in each file.)

- [ ] **Step 2: Write the failing test** — create `frontend/src/pages/leaves/report/RecordExpansion.cancelReason.test.tsx`. Mirror the rendering setup used by existing component tests in this repo (QueryClient + i18n provider; check `frontend/src/pages/announcements/SendToGroupPage.test.tsx` for the pattern and reuse its helpers):

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RecordExpansion } from './RecordExpansion'

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      getLeave: vi.fn(),
      getLeaveBalance: vi.fn().mockResolvedValue({}),
      updateLeave: vi.fn().mockResolvedValue({}),
    },
  }
})

const row = {
  id: 1,
  employee_id: 'G1',
  leave_type: 'Annual Leave',
  start_date: '2026-08-01',
  end_date: '2026-08-25',
  days: 25,
  status: 'Approved',
  created_at: '2026-07-01T00:00:00',
} as never

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RecordExpansion row={row} today="2026-07-15" onMutated={() => {}} />
    </QueryClientProvider>,
  )
}

describe('cancel requires a reason', () => {
  it('disables Cancel until notes are typed', () => {
    renderIt()
    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    expect(cancelBtn).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'shortage' } })
    expect(cancelBtn).not.toBeDisabled()
  })
})
```

(If the app's tests wrap i18n differently — e.g. an `I18nextProvider` test util — reuse that util; the assertion is what matters. The accessible name for the Cancel action comes from `leaves.report.cancel`; scope the query if "cancel" collides with the delete-confirm Cancel.)

- [ ] **Step 3: Run to verify failure**

Run: `pnpm -C frontend exec vitest run src/pages/leaves/report/RecordExpansion.cancelReason.test.tsx`
Expected: FAIL — Cancel is enabled with empty notes

- [ ] **Step 4: Implement — desktop** (`RecordExpansion.tsx`):

Under the notes textarea (inside the `hasRequestActions` block, after the `<textarea …/>`), add:

```tsx
              {acts.includes('cancel') && (
                <p className="text-[0.72em] text-muted-foreground">
                  {t('leaves.report.cancelReasonHint')}
                </p>
              )}
```

Change the Cancel button's disabled prop:

```tsx
                  disabled={updateMutation.isPending || !notes.trim()}
```

- [ ] **Step 5: Implement — mobile drawer** (`TabRecords.tsx`, LeaveDetailDrawer): the drawer's textarea shows `notes || leave.notes || ''`. Compute the effective value above the actions block:

```tsx
  const effectiveNotes = (notes || leave?.notes || '').trim()
```

Change the drawer's Cancel button disabled prop (the button that mutates `{ status: 'Cancelled', n: notes }`, ~line 454):

```tsx
                    disabled={updateMutation.isPending || !effectiveNotes}
```

Add the same hint under the drawer's notes textarea when cancel is available:

```tsx
                {acts.includes('cancel') && (
                  <p className="text-[0.72em] text-muted-foreground">
                    {t('leaves.report.cancelReasonHint')}
                  </p>
                )}
```

- [ ] **Step 6: Run tests + gates**

Run: `pnpm -C frontend exec vitest run src/pages/leaves && pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint`
Expected: PASS / clean

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/leaves/report/RecordExpansion.tsx frontend/src/pages/leaves/TabRecords.tsx frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/pages/leaves/report/RecordExpansion.cancelReason.test.tsx
git commit -m "feat(leaves): cancel requires a reason — sent to the employee (both surfaces)"
```

---

### Task 10: Amend dialog (both leave surfaces)

**Files:**
- Modify: `frontend/src/pages/leaves/lifecycle.ts` (`LeaveAction` + `actionsFor`)
- Modify: `frontend/src/pages/leaves/useLeaveDecisionActions.ts` (add `amendMutation`)
- Create: `frontend/src/pages/leaves/AmendLeaveDialog.tsx`
- Modify: `frontend/src/pages/leaves/report/RecordExpansion.tsx` (button + dialog mount)
- Modify: `frontend/src/pages/leaves/TabRecords.tsx` (button + dialog mount in the drawer)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/pages/leaves/lifecycle.test.ts` (append), `frontend/src/pages/leaves/AmendLeaveDialog.test.tsx` (new)

**Interfaces:**
- Consumes: `api.amendLeave(id, {end_date, reason})` (Task 8).
- Produces: `'amend'` in `LeaveAction`; `AmendLeaveDialog({ open, leave, onOpenChange, onAmended })`; `useLeaveDecisionActions` gains `amendMutation: UseMutationResult<unknown, Error, { end_date: string; reason: string }>` (shares the invalidation set).

- [ ] **Step 1: Write the failing lifecycle test** (append to `lifecycle.test.ts`, matching its import style):

```ts
it('offers amend only on approved annual leaves', () => {
  expect(actionsFor('Annual Leave', 'Approved', '2026-08-25', '2026-07-15')).toContain('amend')
  // legacy 'Generated' aliases to Approved
  expect(actionsFor('Annual Leave - إجازة سنوية', 'Generated', '2026-08-25', '2026-07-15')).toContain('amend')
  expect(actionsFor('Annual Leave', 'Pending', '2026-08-25', '2026-07-15')).not.toContain('amend')
  expect(actionsFor('Emergency Leave', 'Approved', '2026-08-25', '2026-07-15')).not.toContain('amend')
  expect(actionsFor('Sick Leave', 'Approved', '2026-08-25', '2026-07-15')).not.toContain('amend')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C frontend exec vitest run src/pages/leaves/lifecycle.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement lifecycle** — in `lifecycle.ts`:

```ts
export type LeaveAction = 'approve' | 'reject' | 'cancel' | 'delay' | 'extend' | 'certificate' | 'return' | 'amend'
```

In `actionsFor`, replace the request-group Approved branch:

```ts
    if (s === 'Approved') {
      const acts: LeaveAction[] = isReturnable(leaveType) && isOverdue(endDate, todayIso)
        ? ['return', 'cancel'] : ['cancel']
      // Post-approval amendment: Annual only (mirrors backend can_amend).
      if (isReturnable(leaveType) && lifecycleGroup(leaveType) === 'request') acts.unshift('amend')
      return acts
    }
```

Run the lifecycle test again → PASS.

- [ ] **Step 4: Add `amendMutation` to `useLeaveDecisionActions.ts`:**

Extend the `Decisions` interface:

```ts
interface Decisions {
  updateMutation: UseMutationResult<unknown, Error, { status: LeaveStatus; n: string }>
  deleteMutation: UseMutationResult<unknown, Error, void>
  amendMutation: UseMutationResult<unknown, Error, { end_date: string; reason: string }>
}
```

Add before the `return`:

```ts
  const amendMutation = useMutation({
    mutationFn: ({ end_date, reason }: { end_date: string; reason: string }) =>
      api.amendLeave(leaveId, { end_date, reason }),
    onSuccess: () => {
      invalidate()
      toast.success(t('leaves.amend.toast'))
      onMutated()
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
```

Return `{ updateMutation, deleteMutation, amendMutation }`.

- [ ] **Step 5: Locale keys** — add a `leaves.amend` object to `en.json`:

```json
"amend": {
  "action": "Edit leave",
  "title": "Edit approved leave",
  "startDate": "Start date",
  "endDate": "End date",
  "newDuration": "New duration: {{days}} days (was {{oldDays}})",
  "reason": "Reason for the change — sent to the employee",
  "help": "Saving updates the record and notifies the employee on WhatsApp/SMS with the new dates and your reason.",
  "save": "Save & notify employee",
  "toast": "Leave updated — employee notified"
}
```

and `ar.json`:

```json
"amend": {
  "action": "تعديل الإجازة",
  "title": "تعديل إجازة موافَق عليها",
  "startDate": "تاريخ البداية",
  "endDate": "تاريخ النهاية",
  "newDuration": "المدة الجديدة: {{days}} يوم (بدلاً من {{oldDays}})",
  "reason": "سبب التعديل — يُرسل إلى الموظف",
  "help": "عند الحفظ يُحدَّث السجل ويُشعَر الموظف عبر واتساب/SMS بالتواريخ الجديدة والسبب.",
  "save": "حفظ وإشعار الموظف",
  "toast": "تم تعديل الإجازة — تم إشعار الموظف"
}
```

- [ ] **Step 6: Write the failing dialog test** — create `frontend/src/pages/leaves/AmendLeaveDialog.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { AmendLeaveDialog } from './AmendLeaveDialog'

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: { ...mod.api, amendLeave: vi.fn().mockResolvedValue({}) },
  }
})

const leave = {
  id: 5,
  employee_id: 'G1',
  leave_type: 'Annual Leave',
  start_date: '2026-08-01',
  end_date: '2026-08-25',
  days: 25,
  status: 'Approved',
} as never

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AmendLeaveDialog open leave={leave} onOpenChange={() => {}} onAmended={() => {}} />
    </QueryClientProvider>,
  )
}

describe('AmendLeaveDialog', () => {
  it('disables save until a reason is given, then submits end_date + reason', async () => {
    renderIt()
    const save = screen.getByRole('button', { name: /save|حفظ/i })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/reason|سبب/i), { target: { value: 'balance' } })
    expect(save).not.toBeDisabled()
    fireEvent.click(save)
    await waitFor(() =>
      expect(api.amendLeave).toHaveBeenCalledWith(5, {
        end_date: '2026-08-25',
        reason: 'balance',
      }),
    )
  })
})
```

- [ ] **Step 7: Run to verify failure** — `pnpm -C frontend exec vitest run src/pages/leaves/AmendLeaveDialog.test.tsx` → FAIL (module missing)

- [ ] **Step 8: Implement `AmendLeaveDialog.tsx`** — pattern the dialog shell after `ReturnFormDialog.tsx` in the same folder (same Radix dialog primitives, same layout classes; read it first and reuse its structure). Component contract:

```tsx
/**
 * AmendLeaveDialog — post-approval end-date change for an Approved Annual
 * Leave (spec 2026-07-15). Start is fixed; the new day count is derived; a
 * reason is required and is sent to the employee with the notification.
 * Used by BOTH detail surfaces (RecordExpansion + LeaveDetailDrawer).
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LeaveListItem } from '@/lib/api'

import { useLeaveDecisionActions } from './useLeaveDecisionActions'

interface Props {
  open: boolean
  leave: LeaveListItem
  onOpenChange: (open: boolean) => void
  onAmended: () => void
}

export function AmendLeaveDialog({ open, leave, onOpenChange, onAmended }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [endDate, setEndDate] = useState(leave.end_date.slice(0, 10))
  const [reason, setReason] = useState('')

  const { amendMutation } = useLeaveDecisionActions({
    leaveId: leave.id,
    employeeId: leave.employee_id,
    onMutated: () => {
      onAmended()
      onOpenChange(false)
    },
  })

  const newDays = useMemo(() => {
    const start = new Date(leave.start_date.slice(0, 10))
    const end = new Date(endDate)
    return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  }, [leave.start_date, endDate])

  const canSave = reason.trim().length > 0 && newDays >= 1 && !amendMutation.isPending

  // …dialog shell copied from ReturnFormDialog: title t('leaves.amend.title'),
  // read-only start (t('leaves.amend.startDate')), <input type="date"
  // min={leave.start_date.slice(0,10)}> for t('leaves.amend.endDate'),
  // a line {t('leaves.amend.newDuration', { days: newDays, oldDays: leave.days })},
  // labelled textarea for t('leaves.amend.reason') (dir="auto"),
  // help text t('leaves.amend.help'), and a submit button t('leaves.amend.save')
  // with disabled={!canSave} calling:
  //   amendMutation.mutate({ end_date: endDate, reason: reason.trim() })
}
```

The comment block above describes the exact fields; write the full JSX following `ReturnFormDialog`'s dialog markup (do not invent a new dialog system). Ensure the reason `<textarea>` is associated with its label via `htmlFor`/`id` so `getByLabelText` works.

- [ ] **Step 9: Wire into both surfaces**

`RecordExpansion.tsx`: add state `const [amendOpen, setAmendOpen] = useState(false)`; in the actions column, next to the request actions:

```tsx
          {acts.includes('amend') && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setAmendOpen(true)} className="rounded-full">
                {t('leaves.amend.action')}
              </Button>
            </div>
          )}
```

and mount next to `ReturnFormDialog`:

```tsx
    <AmendLeaveDialog open={amendOpen} leave={row} onOpenChange={setAmendOpen} onAmended={onMutated} />
```

`TabRecords.tsx` (LeaveDetailDrawer): same pattern — state, a button in the drawer's actions when `acts.includes('amend')`, and the dialog mounted with `leave` and the drawer's `onMutated` callback.

- [ ] **Step 10: Run tests + gates**

Run: `pnpm -C frontend exec vitest run src/pages/leaves && pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint`
Expected: PASS / clean

- [ ] **Step 11: Commit**

```bash
git add frontend/src/pages/leaves frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(leaves): Edit-leave dialog on approved annual rows (both surfaces)"
```

---

### Task 11: Direct recipients on the Send-to-Group page

**Files:**
- Create: `frontend/src/pages/announcements/DirectEmployeesField.tsx`
- Modify: `frontend/src/pages/announcements/SendToGroupPage.tsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/pages/announcements/DirectEmployeesField.test.tsx` (new), `frontend/src/pages/announcements/SendToGroupPage.test.tsx` (append)

**Interfaces:**
- Consumes: `api.listEmployees({ q, limit: 6 })` (same as `EmployeeMentionField`); `mentionDigits` from `./mention` (usable-number check); `AnnouncementOut.direct_results` (Task 8 types).
- Produces:
  - `type DirectEmployee = { id: string; name_en: string | null; name_ar: string | null; contact: string | null }` (export from `DirectEmployeesField.tsx`).
  - `DirectEmployeesField({ selected, onAdd, onRemove })` — search by G-number/name, dropdown, disabled rows for no-mobile employees, selected list with remove.
  - Page: send enabled with employees only (private message); `employee_ids` appended to the FormData; reach meter + hint states; direct rows in the result panel.

- [ ] **Step 1: Locale keys** — add a `direct` object under `sendToGroup` in `en.json`:

```json
"direct": {
  "title": "Employees — direct message",
  "searchPlaceholder": "Search by G-number or name…",
  "empty": "No employees added yet — messages go to their personal WhatsApp (SMS fallback), not to any group.",
  "noResults": "No employee matches",
  "noMobile": "no mobile",
  "remove": "Remove {{name}}",
  "reach": "direct",
  "tag": "direct",
  "hintPrivate": "Private message — sends directly to {{count}} employee(s), no group",
  "hintMixed": "Will send to {{groups}} group(s) + {{employees}} employee(s) (direct)",
  "fellBack": "sent by SMS (not on WhatsApp)"
}
```

`ar.json`:

```json
"direct": {
  "title": "الموظفون — رسالة مباشرة",
  "searchPlaceholder": "ابحث برقم G أو بالاسم…",
  "empty": "لم يُضف موظفون بعد — تُرسل الرسائل إلى واتساب الموظف الشخصي (مع SMS احتياطي)، وليس إلى أي مجموعة.",
  "noResults": "لا يوجد موظف مطابق",
  "noMobile": "بدون هاتف",
  "remove": "إزالة {{name}}",
  "reach": "مباشر",
  "tag": "مباشر",
  "hintPrivate": "رسالة خاصة — تُرسل مباشرة إلى {{count}} موظف، بدون مجموعة",
  "hintMixed": "سيُرسل إلى {{groups}} مجموعة + {{employees}} موظف (مباشر)",
  "fellBack": "أُرسلت عبر SMS (غير مسجّل في واتساب)"
}
```

(If the existing `sendToGroup` keys use i18next plural forms elsewhere, keep these as simple interpolations — counts are small.)

- [ ] **Step 2: Write the failing field test** — create `DirectEmployeesField.test.tsx` (mirror the query/mocking setup of `EmployeeMentionField.test.tsx` in the same folder — read it first and reuse its helpers):

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { DirectEmployeesField } from './DirectEmployeesField'

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      listEmployees: vi.fn().mockResolvedValue({
        items: [
          { id: 'G-1023', name_en: 'Ahmed', name_ar: 'أحمد', contact: '0501234567' },
          { id: 'G-0231', name_en: 'Ali', name_ar: 'علي', contact: null },
        ],
      }),
    },
  }
})

function renderIt(onAdd = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <DirectEmployeesField selected={[]} onAdd={onAdd} onRemove={vi.fn()} />
    </QueryClientProvider>,
  )
  return onAdd
}

describe('DirectEmployeesField', () => {
  it('adds an employee with a mobile; disables one without', async () => {
    const onAdd = renderIt()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '10' } })
    await waitFor(() => expect(api.listEmployees).toHaveBeenCalled())
    const ahmed = await screen.findByRole('button', { name: /Ahmed/ })
    const ali = screen.getByRole('button', { name: /Ali/ })
    expect(ali).toBeDisabled()
    fireEvent.click(ahmed)
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'G-1023', contact: '0501234567' }),
    )
  })
})
```

- [ ] **Step 3: Run to verify failure** — `pnpm -C frontend exec vitest run src/pages/announcements/DirectEmployeesField.test.tsx` → FAIL (module missing)

- [ ] **Step 4: Implement `DirectEmployeesField.tsx`:**

```tsx
/**
 * DirectEmployeesField — pick employees (by G-number or name) as direct
 * (private-chat) recipients for a Send-to-Group announcement. Multi-select,
 * no cap; employees without a usable mobile are shown disabled.
 * Search reuses the same employee query as EmployeeMentionField.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '@/lib/api'
import { mentionDigits } from './mention'

export interface DirectEmployee {
  id: string
  name_en: string | null
  name_ar: string | null
  contact: string | null
}

export function DirectEmployeesField({
  selected,
  onAdd,
  onRemove,
}: {
  selected: DirectEmployee[]
  onAdd: (emp: DirectEmployee) => void
  onRemove: (id: string) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [q, setQ] = useState('')
  const ar = i18n.language.startsWith('ar')

  const empQuery = useQuery({
    queryKey: ['announce-direct-employees', q],
    queryFn: () => api.listEmployees({ q, limit: 6 }),
    enabled: q.trim().length > 0,
    staleTime: 30_000,
  })

  const selectedIds = new Set(selected.map((e) => e.id))
  const localName = (e: DirectEmployee): string =>
    (ar ? e.name_ar : e.name_en) || e.name_en || e.name_ar || e.id

  return (
    <div className="rounded-xl border border-border bg-surface/60 p-4">
      <p className="mb-2 text-[0.9em] font-semibold text-foreground">
        {t('sendToGroup.direct.title')}
      </p>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('sendToGroup.direct.searchPlaceholder')}
        aria-label={t('sendToGroup.direct.searchPlaceholder')}
        dir="auto"
        className="h-9 w-full rounded-md border border-border bg-surface px-3 text-[0.85em] text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />

      {q.trim().length > 0 && (
        <ul className="mt-1 space-y-1">
          {(empQuery.data?.items ?? [])
            .filter((emp) => !selectedIds.has(emp.id))
            .map((emp) => {
              const usable = !!emp.contact && mentionDigits(emp.contact) !== ''
              return (
                <li key={emp.id}>
                  <button
                    type="button"
                    disabled={!usable}
                    onClick={() => {
                      onAdd({
                        id: emp.id,
                        name_en: emp.name_en,
                        name_ar: emp.name_ar,
                        contact: emp.contact,
                      })
                      setQ('')
                    }}
                    className="w-full rounded-md border border-border px-3 py-1.5 text-start text-[0.82em] hover:bg-surface-tinted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span dir="auto" className="text-foreground">{localName(emp)}</span>
                    <span className="ms-1 text-muted-foreground">({emp.id})</span>
                    {!usable && (
                      <span className="ms-1 text-[0.75em] text-muted-foreground">
                        {t('sendToGroup.direct.noMobile')}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          {empQuery.data && empQuery.data.items.length === 0 && (
            <li className="px-3 py-2 text-[0.82em] text-muted-foreground" dir="auto">
              {t('sendToGroup.direct.noResults')}
            </li>
          )}
        </ul>
      )}

      {selected.length === 0 ? (
        <p className="mt-2 text-[0.78em] text-muted-foreground" dir="auto">
          {t('sendToGroup.direct.empty')}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {selected.map((emp) => (
            <li
              key={emp.id}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-[0.85em] text-foreground" dir="auto">
                {localName(emp)}
                <span className="ms-1 text-muted-foreground">({emp.id})</span>
              </span>
              <button
                type="button"
                aria-label={t('sendToGroup.direct.remove', { name: localName(emp) })}
                onClick={() => onRemove(emp.id)}
                className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-accent/10 hover:text-accent"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

(Adjust the `listEmployees` item field names to the actual `EmployeeListResponse` item type if they differ — `EmployeeMentionField` reads `emp.id / emp.name_en / emp.name_ar / emp.contact`, so these are correct.)

- [ ] **Step 5: Run the field test** — PASS.

- [ ] **Step 6: Wire into `SendToGroupPage.tsx`:**

State (near the group-selection state):

```tsx
  const [directEmps, setDirectEmps] = useState<DirectEmployee[]>([])
```

Imports:

```tsx
import { DirectEmployeesField, type DirectEmployee } from './DirectEmployeesField'
```

Submit rule (replace `hasGroup` usage in `canSubmit`):

```tsx
  const hasGroup = selectedIds.size > 0
  const hasDirect = directEmps.length > 0
  const hasRecipient = hasGroup || hasDirect
  ...
  const canSubmit = isConnected && hasRecipient && hasContent
```

FormData (in `sendMut.mutationFn`, make group ids conditional and append employees):

```tsx
      for (const id of selectedIds) {
        form.append('group_ids', id)
      }
      for (const e of directEmps) {
        form.append('employee_ids', e.id)
      }
```

Recipients rail: render `<DirectEmployeesField …/>` directly under the groups card `</div>` (inside the `<aside>`), passing:

```tsx
            <DirectEmployeesField
              selected={directEmps}
              onAdd={(e) => setDirectEmps((prev) => (prev.some((p) => p.id === e.id) ? prev : [...prev, e]))}
              onRemove={(id) => setDirectEmps((prev) => prev.filter((p) => p.id !== id))}
            />
```

Reach meter — add a second figure to the existing gradient card:

```tsx
            <div className="rounded-xl bg-gradient-to-br from-primary to-primary-hover p-4 text-primary-foreground">
              <div className="flex items-center gap-4">
                <div>
                  <div className="text-[2.2em] font-bold leading-none">{selectedIds.size}</div>
                  <div className="mt-1 text-[0.8em] opacity-90">
                    {t('sendToGroup.reach.groups', { count: selectedIds.size })}
                  </div>
                </div>
                <div className="h-8 w-px bg-white/20" aria-hidden />
                <div>
                  <div className="text-[2.2em] font-bold leading-none">{directEmps.length}</div>
                  <div className="mt-1 text-[0.8em] opacity-90">{t('sendToGroup.direct.reach')}</div>
                </div>
              </div>
            </div>
```

Validation hints — replace the `pickGroup` hint block:

```tsx
            {!showBanner && !hasRecipient && !sendMut.isPending && (
              <p className="mt-2 text-[0.8em] text-muted-foreground">{t('sendToGroup.pickGroup')}</p>
            )}
            {!showBanner && hasRecipient && !hasContent && !sendMut.isPending && (
              <p className="mt-2 text-[0.8em] text-muted-foreground">
                {t('sendToGroup.needContent')}
              </p>
            )}
            {!showBanner && !hasGroup && hasDirect && (
              <p className="mt-2 text-[0.8em] font-medium text-primary">
                {t('sendToGroup.direct.hintPrivate', { count: directEmps.length })}
              </p>
            )}
            {!showBanner && hasGroup && hasDirect && (
              <p className="mt-2 text-[0.8em] text-muted-foreground">
                {t('sendToGroup.direct.hintMixed', { groups: selectedIds.size, employees: directEmps.length })}
              </p>
            )}
```

(Also update `en.json`/`ar.json` `sendToGroup.pickGroup` copy to mention employees: EN "Select at least one group or employee." / AR "اختر مجموعة واحدة أو موظفاً واحداً على الأقل.")

Result panel — after the existing group rows `</ul>`, render direct rows:

```tsx
          {result.direct_results.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-border pt-2">
              {result.direct_results.map((row) => (
                <li key={row.employee_id} className="flex items-center gap-2 text-[0.82em]">
                  <span className={row.ok ? 'text-green-600' : 'text-destructive'} aria-hidden>
                    {row.ok ? '✓' : '✗'}
                  </span>
                  <span dir="ltr" className="font-mono text-muted-foreground">{row.employee_id}</span>
                  <span dir="auto" className="text-foreground">{row.employee_name}</span>
                  <span className="rounded-full bg-surface-tinted px-2 py-0.5 text-[0.72em] text-muted-foreground">
                    {t('sendToGroup.direct.tag')}
                  </span>
                  {row.ok && row.fell_back && (
                    <span className="text-muted-foreground">{t('sendToGroup.direct.fellBack')}</span>
                  )}
                  {!row.ok && (
                    <span className="text-muted-foreground" title={row.error ?? undefined}>
                      — {t('sendToGroup.groupSendFailed')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
```

Phone preview header for private-only sends — change `firstGroupName`:

```tsx
  const firstDirectName = directEmps.length > 0
    ? ((i18n.language.startsWith('ar') ? directEmps[0].name_ar : directEmps[0].name_en) ?? directEmps[0].id)
    : null
  const previewChatName =
    (groups ?? []).find((g) => selectedIds.has(g.id))?.name ?? firstDirectName
```

and pass `previewChatName` where `firstGroupName` was passed to `PhonePreview` / `WebChatWindow`. (`useTranslation` already provides `i18n` on this page via `const { t } = useTranslation()` — destructure `i18n` too.)

- [ ] **Step 7: Append page tests** (to `SendToGroupPage.test.tsx`, using its existing render/mock helpers — read the file first; add cases):

```tsx
it('enables send with employees only and posts employee_ids', async () => {
  // arrange: mock gateway connected + listGroups as the existing tests do,
  // mock api.listEmployees to return one employee with a contact,
  // mock api.sendAnnouncement to capture the FormData
  // act: type a message, add the employee via the direct field, click send
  // assert: sendAnnouncement called; captured FormData has employee_ids=G-1023
  //         and no group_ids entries
})

it('renders direct results with the direct tag', async () => {
  // arrange: mock sendAnnouncement to resolve with
  //   { announcement_id: null, sent: 1, failed: 0, results: [],
  //     direct_results: [{ employee_id: 'G-1023', employee_name: 'Ahmed',
  //                        ok: true, fell_back: false, error: null }] }
  // assert after send: screen shows 'Ahmed' and the direct tag
})
```

Implement these two tests fully using the file's existing helper functions (they already mock `useGatewayStatus`, `api.listGroups`, and submit flows — extend, don't re-invent; the arrange/act/assert comments above define the required behavior, the helpers define the mechanics).

- [ ] **Step 8: Run tests + gates**

Run: `pnpm -C frontend exec vitest run src/pages/announcements && pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint`
Expected: PASS / clean

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/announcements frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(announcements): direct-to-employee recipients on Send-to-Group (private messages)"
```

---

### Task 12: Full gates + bilingual reviewers

**Files:** none new — verification and fixes only.

- [ ] **Step 1: Full backend suite** — `venv\Scripts\python.exe -m pytest` → all green.
- [ ] **Step 2: Backend lint/format/type** — `venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check . && venv\Scripts\mypy.exe` → clean.
- [ ] **Step 3: Full frontend suite** — `pnpm -C frontend test && pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint` → clean.
- [ ] **Step 4: Dispatch the `i18n-rtl-reviewer` agent** on the diff (locales, RecordExpansion, TabRecords, AmendLeaveDialog, DirectEmployeesField, SendToGroupPage). Fix real findings, re-run gates.
- [ ] **Step 5: Dispatch the `notification-template-reviewer` agent** on `sms_templates.py` / `notify_format.py` changes. The wording is user-locked — accept placeholder/parity findings, reject rephrasing suggestions.
- [ ] **Step 6: Check `git status` for `backend/templates/*.docx` churn** — revert any (`git checkout -- backend/templates`).
- [ ] **Step 7: Commit any review fixes**

```bash
git add -A ':!backend/templates'
git commit -m "fix: review findings — i18n/RTL + notification templates"
```

- [ ] **Step 8: Finish** — use the superpowers:finishing-a-development-branch skill (merge to `main`, push to `origin/main`; deployment via `mng deploy` is the operator's call).
