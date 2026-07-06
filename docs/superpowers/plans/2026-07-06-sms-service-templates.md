# SMS Service Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bilingual (Arabic-default) "Notify by SMS" messages for 7 HR document/form services (Salary Transfer, Salary Deduction, Employee Clearance, HR Request, Passport Release, Warning, Resignation), reusing the existing manual SMS channel.

**Architecture:** These services are stored as `Book` records; `BookVersion.template_id` identifies the service and `BookVersion.fields` (JSON) holds the data. A new `_load_book_event` loader in `sms_service` returns a `BookEvent` (employee + fields + send-date) that the existing `render_text` → `_BUILDERS` dispatch feeds into 7 new builder functions. New formatting helpers (salary-month rule, document-label map, month tables, office constants) live in `notify_format` so the existing no-English-leak guarantee is inherited.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.x, pytest (backend); React + TypeScript, react-i18next (frontend).

## Global Constraints

- **Arabic is default and primary.** Every message has an AR and EN body; language = `employee.msg_language` (`"ar"` unless explicitly `"en"`).
- **Zero cross-language leak.** No English text in an AR body; no Arabic in an EN body. Reuse `notify_format` helpers — do not hand-format names/dates/types.
- **Signature exact match:** AR `إدارة مركز الإصلاح والتأهيل بالوثبة`, EN `Al Wathba Rehabilitation Centre` (existing `_SIGNATURE_AR` / `_SIGNATURE_EN` in `sms_templates.py`).
- **Dates use western digits, `%d/%m/%Y`** via `nf.fmt_date`; weekday via `nf.weekday`.
- **Routing offices are named constants** — `مكتب الموارد البشرية` (HR services) and `مكتب الإدارة` (Warning, matching the violation template). Never inline new copies.
- **Salary-month token contract:** the AR template already contains the word «شهر»; `salary_transfer_month()` returns month-name + year ONLY (e.g. «أغسطس 2026»), never with a leading «شهر». This prevents the doubled-«شهر» bug.
- **Event constant strings** (backend + frontend must agree): `salary_transfer`, `salary_deduction`, `employee_clearance`, `hr_request`, `passport_release`, `warning`, `resignation`.
- **Approved copy source of truth:** `docs/sms-services-templates-preview.html`. The exact strings are reproduced in this plan.

---

### Task 1: Salary-month helper + month tables + office constants (`notify_format`)

**Files:**
- Modify: `backend/app/services/notify_format.py`
- Test: `backend/tests/test_notify_format.py`

**Interfaces:**
- Produces:
  - `AR_MONTHS: tuple[str, ...]` / `EN_MONTHS: tuple[str, ...]` (12 entries, January-indexed at 0).
  - `HR_OFFICE_AR: str = "مكتب الموارد البشرية"`, `ADMIN_OFFICE_AR: str = "مكتب الإدارة"`.
  - `salary_transfer_month(today: date, lang: str) -> str` — returns e.g. `"أغسطس 2026"` / `"August 2026"`. Rule: `today.day <= 15` → next month; else → the month after. No leading «شهر».

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_notify_format.py`:

```python
from datetime import date
from app.services import notify_format as nf


def test_salary_month_on_or_before_15_is_next_month():
    # 5 July 2026 (<=15) -> next month = August 2026
    assert nf.salary_transfer_month(date(2026, 7, 5), "ar") == "أغسطس 2026"
    assert nf.salary_transfer_month(date(2026, 7, 5), "en") == "August 2026"


def test_salary_month_boundary_15_is_next_month():
    assert nf.salary_transfer_month(date(2026, 7, 15), "en") == "August 2026"


def test_salary_month_after_15_is_month_after():
    # 20 July 2026 (>15) -> month after = September 2026
    assert nf.salary_transfer_month(date(2026, 7, 20), "ar") == "سبتمبر 2026"
    assert nf.salary_transfer_month(date(2026, 7, 20), "en") == "September 2026"


def test_salary_month_year_rollover_before_15():
    # 5 Dec 2026 (<=15) -> January 2027
    assert nf.salary_transfer_month(date(2026, 12, 5), "en") == "January 2027"


def test_salary_month_year_rollover_after_15():
    # 20 Dec 2026 (>15) -> February 2027
    assert nf.salary_transfer_month(date(2026, 12, 20), "en") == "February 2027"


def test_salary_month_has_no_leading_shahr():
    # Guard the doubled-«شهر» contract: helper must not prefix «شهر».
    assert not nf.salary_transfer_month(date(2026, 7, 5), "ar").startswith("شهر")


def test_office_constants():
    assert nf.HR_OFFICE_AR == "مكتب الموارد البشرية"
    assert nf.ADMIN_OFFICE_AR == "مكتب الإدارة"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_notify_format.py -k "salary_month or office_constants" -v`
Expected: FAIL with `AttributeError: module 'app.services.notify_format' has no attribute 'salary_transfer_month'`.

- [ ] **Step 3: Implement the helper and constants**

Add to `backend/app/services/notify_format.py` (near the other module-level constants; `date` is already imported):

```python
HR_OFFICE_AR = "مكتب الموارد البشرية"
ADMIN_OFFICE_AR = "مكتب الإدارة"

# Gregorian month names, January at index 0 (UAE-standard Arabic transliterations).
AR_MONTHS: tuple[str, ...] = (
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
)
EN_MONTHS: tuple[str, ...] = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)


def salary_transfer_month(today: date, lang: str) -> str:
    """Month a salary transfer takes effect: on/before the 15th -> next month;
    after the 15th -> the month after. Returns month name + year only (no
    leading «شهر» — the template already supplies it)."""
    bump = 1 if today.day <= 15 else 2
    m = today.month - 1 + bump  # 0-indexed target month, may exceed 11
    year = today.year + m // 12
    table = AR_MONTHS if lang == "ar" else EN_MONTHS
    return f"{table[m % 12]} {year}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_notify_format.py -k "salary_month or office_constants" -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/notify_format.py backend/tests/test_notify_format.py
git commit -m "feat(sms): salary-transfer month helper + office constants"
```

---

### Task 2: HR-request document-label map + join (`notify_format`)

**Files:**
- Modify: `backend/app/services/notify_format.py`
- Test: `backend/tests/test_notify_format.py`

**Interfaces:**
- Produces:
  - `hr_request_docs(selections, lang: str) -> tuple[str, int]` — returns `(joined_labels, count)`. `selections` may be a `dict` (`{key: True}`), `list`, or `str`. Labels joined with `«، »` (AR) or `", "` (EN); unknown keys skipped. `count` = number of recognized labels (drives singular/plural copy in Task 4).

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_notify_format.py`:

```python
def test_hr_docs_single_arabic():
    assert nf.hr_request_docs({"salary_certificate": True}, "ar") == ("شهادة راتب", 1)


def test_hr_docs_single_english():
    assert nf.hr_request_docs("salary_certificate", "en") == ("Salary Certificate", 1)


def test_hr_docs_employment_certificate_label():
    # Confirmed label: خطاب عمل (NOT شهادة عمل / شهادة راتب).
    assert nf.hr_request_docs(["employment_certificate"], "ar") == ("خطاب عمل", 1)


def test_hr_docs_multiple_joined_arabic():
    label, count = nf.hr_request_docs(
        {"salary_certificate": True, "experience_certificate": True}, "ar"
    )
    assert label == "شهادة راتب، شهادة خبرة"
    assert count == 2


def test_hr_docs_unknown_key_skipped():
    assert nf.hr_request_docs(["salary_certificate", "bogus"], "en") == ("Salary Certificate", 1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_notify_format.py -k hr_docs -v`
Expected: FAIL with `AttributeError: ... has no attribute 'hr_request_docs'`.

- [ ] **Step 3: Implement the map and join**

Add to `backend/app/services/notify_format.py`:

```python
# HR Request form "Requested Documents" options -> (English, Arabic) label.
# These options have no Arabic label elsewhere in the app; this is their source.
_HR_DOC_LABELS: dict[str, tuple[str, str]] = {
    "insurance_card": ("Insurance Card", "بطاقة التأمين"),
    "id_card": ("ID Card", "بطاقة الهوية"),
    "employment_certificate": ("Employment Certificate", "خطاب عمل"),
    "salary_certificate": ("Salary Certificate", "شهادة راتب"),
    "salary_transfer_letter": ("Salary Transfer Letter", "خطاب تحويل راتب"),
    "salary_pay_slip": ("Salary Pay Slip", "قسيمة الراتب"),
    "experience_certificate": ("Experience Certificate", "شهادة خبرة"),
}


def _doc_keys(selections) -> list[str]:
    """Normalize the stored doc_selections shape (dict/list/str) to a key list."""
    if isinstance(selections, dict):
        return [k for k, v in selections.items() if v]
    if isinstance(selections, list):
        return [s for s in selections if isinstance(s, str)]
    if isinstance(selections, str) and selections:
        return [selections]
    return []


def hr_request_docs(selections, lang: str) -> tuple[str, int]:
    """Localized, joined label(s) for the requested documents, plus the count."""
    idx = 1 if lang == "ar" else 0
    labels = [
        _HR_DOC_LABELS[k][idx] for k in _doc_keys(selections) if k in _HR_DOC_LABELS
    ]
    sep = "، " if lang == "ar" else ", "
    return sep.join(labels), len(labels)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_notify_format.py -k hr_docs -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/notify_format.py backend/tests/test_notify_format.py
git commit -m "feat(sms): HR-request document-label map"
```

---

### Task 3: Event constants (`notify_format`)

**Files:**
- Modify: `backend/app/services/notify_format.py`
- Test: `backend/tests/test_notify_format.py`

**Interfaces:**
- Produces 7 event-type constants and a set of all of them:
  - `EVENT_SALARY_TRANSFER = "salary_transfer"`, `EVENT_SALARY_DEDUCTION = "salary_deduction"`, `EVENT_EMPLOYEE_CLEARANCE = "employee_clearance"`, `EVENT_HR_REQUEST = "hr_request"`, `EVENT_PASSPORT_RELEASE = "passport_release"`, `EVENT_WARNING = "warning"`, `EVENT_RESIGNATION = "resignation"`.
  - `BOOK_EVENTS: frozenset[str]` = all seven.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_notify_format.py`:

```python
def test_book_event_constants():
    assert nf.EVENT_SALARY_TRANSFER == "salary_transfer"
    assert nf.EVENT_WARNING == "warning"
    assert nf.BOOK_EVENTS == frozenset({
        "salary_transfer", "salary_deduction", "employee_clearance",
        "hr_request", "passport_release", "warning", "resignation",
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend; python -m pytest tests/test_notify_format.py -k book_event_constants -v`
Expected: FAIL with `AttributeError: ... has no attribute 'EVENT_SALARY_TRANSFER'`.

- [ ] **Step 3: Implement the constants**

Add to `backend/app/services/notify_format.py`, directly below the existing `EVENT_VIOLATION = "violation"` line:

```python
EVENT_SALARY_TRANSFER = "salary_transfer"
EVENT_SALARY_DEDUCTION = "salary_deduction"
EVENT_EMPLOYEE_CLEARANCE = "employee_clearance"
EVENT_HR_REQUEST = "hr_request"
EVENT_PASSPORT_RELEASE = "passport_release"
EVENT_WARNING = "warning"
EVENT_RESIGNATION = "resignation"

BOOK_EVENTS: frozenset[str] = frozenset({
    EVENT_SALARY_TRANSFER, EVENT_SALARY_DEDUCTION, EVENT_EMPLOYEE_CLEARANCE,
    EVENT_HR_REQUEST, EVENT_PASSPORT_RELEASE, EVENT_WARNING, EVENT_RESIGNATION,
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend; python -m pytest tests/test_notify_format.py -k book_event_constants -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/notify_format.py backend/tests/test_notify_format.py
git commit -m "feat(sms): book-service event constants"
```

---

### Task 4: Completion builders — Salary Transfer, Salary Deduction, Clearance (`sms_templates`)

**Files:**
- Modify: `backend/app/services/sms_templates.py`
- Test: `backend/tests/test_sms_templates.py`

**Interfaces:**
- Consumes: `nf.salary_transfer_month`, `nf.HR_OFFICE_AR`, `nf.fmt_date`, `nf.weekday`, `nf.employee_name`, event constants (Task 1/3).
- Produces: builders `_salary_transfer`, `_salary_deduction`, `_employee_clearance` registered in `_BUILDERS`. Each reads from a record exposing `.fields: dict`, `.today: date` (the `BookEvent` from Task 7). Signature matches existing builders: `(record, employee, lang) -> str`.

**Note on the record:** builders read `record.fields.get(...)` and `record.today`. Tests construct a tiny stand-in (`SimpleNamespace`) so they don't need a DB. The real `BookEvent` (Task 7) provides the same attributes.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_sms_templates.py` (check top-of-file imports; add any missing):

```python
from datetime import date
from types import SimpleNamespace
from app.services import notify_format as nf, sms_templates


def _emp():
    return SimpleNamespace(name_ar="محمد أحمد", name_en="Mohammed Ahmed")


def _has_ascii_letter(s: str) -> bool:
    return any("a" <= c.lower() <= "z" for c in s)


def test_salary_transfer_ar():
    rec = SimpleNamespace(fields={"bank_name": "بنك أبوظبي الأول"}, today=date(2026, 7, 5))
    text = sms_templates.render_text(nf.EVENT_SALARY_TRANSFER, "ar", rec, _emp())
    assert "تم اعتماد طلب تحويل راتبك إلى حسابك لدى بنك أبوظبي الأول." in text
    assert "سيتم التحويل مع راتب شهر أغسطس 2026." in text
    assert "مكتب الموارد البشرية" in text
    assert text.strip().endswith("إدارة مركز الإصلاح والتأهيل بالوثبة")
    assert "شهر شهر" not in text                       # doubled-word guard
    assert not _has_ascii_letter(text.replace("2026", ""))  # no English leak (year digits ok)


def test_salary_transfer_en():
    rec = SimpleNamespace(fields={"bank_name": "First Abu Dhabi Bank"}, today=date(2026, 7, 5))
    text = sms_templates.render_text(nf.EVENT_SALARY_TRANSFER, "en", rec, _emp())
    assert "Your salary transfer request to your account at First Abu Dhabi Bank has been approved." in text
    assert "The transfer will take effect with the August 2026 salary." in text


def test_salary_deduction_ar():
    rec = SimpleNamespace(fields={"amount": "500"}, today=date(2026, 7, 5))
    text = sms_templates.render_text(nf.EVENT_SALARY_DEDUCTION, "ar", rec, _emp())
    assert "سيتم خصم مبلغ 500 درهم من المرتب الشهري." in text
    assert not _has_ascii_letter(text.replace("500", ""))


def test_salary_deduction_en():
    rec = SimpleNamespace(fields={"amount": "500"}, today=date(2026, 7, 5))
    text = sms_templates.render_text(nf.EVENT_SALARY_DEDUCTION, "en", rec, _emp())
    assert "An amount of AED 500 will be deducted from the monthly salary." in text


def test_employee_clearance_ar():
    rec = SimpleNamespace(fields={}, today=date(2026, 7, 5))  # 05/07/2026 is a Sunday
    text = sms_templates.render_text(nf.EVENT_EMPLOYEE_CLEARANCE, "ar", rec, _emp())
    assert "تم إنجاز إخلاء طرفك اعتباراً من 05/07/2026 (الأحد)." in text
    assert "نتمنى لك التوفيق." in text
    assert not _has_ascii_letter(text.replace("05/07/2026", ""))


def test_employee_clearance_en():
    rec = SimpleNamespace(fields={}, today=date(2026, 7, 5))
    text = sms_templates.render_text(nf.EVENT_EMPLOYEE_CLEARANCE, "en", rec, _emp())
    assert "Your employee clearance has been completed, effective 05/07/2026 (Sunday)." in text
    assert "We wish you all the best." in text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_sms_templates.py -k "salary or clearance" -v`
Expected: FAIL with `KeyError: 'salary_transfer'` (builder not in `_BUILDERS`).

- [ ] **Step 3: Implement the builders and register them**

In `backend/app/services/sms_templates.py`, add office constants below `_SIGNATURE_AR`:

```python
_HR_OFFICE_LINE_AR = f"لأي استفسار يرجى مراجعة {nf.HR_OFFICE_AR}."
_HR_OFFICE_LINE_EN = "For any clarification, please contact the HR office."
```

Add the three builders (after `_violation`):

```python
def _salary_transfer(rec, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    bank = (rec.fields or {}).get("bank_name", "")
    month = nf.salary_transfer_month(rec.today, lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم اعتماد طلب تحويل راتبك إلى حسابك لدى {bank}.\n"
            f"سيتم التحويل مع راتب شهر {month}.\n"
            f"{_HR_OFFICE_LINE_AR}\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your salary transfer request to your account at {bank} has been approved.\n"
        f"The transfer will take effect with the {month} salary.\n"
        f"{_HR_OFFICE_LINE_EN}\n"
        f"{_SIGNATURE_EN}"
    )


def _salary_deduction(rec, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    amount = (rec.fields or {}).get("amount", "")
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"سيتم خصم مبلغ {amount} درهم من المرتب الشهري.\n"
            f"{_HR_OFFICE_LINE_AR}\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"An amount of AED {amount} will be deducted from the monthly salary.\n"
        f"{_HR_OFFICE_LINE_EN}\n"
        f"{_SIGNATURE_EN}"
    )


def _employee_clearance(rec, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    ds, wd = nf.fmt_date(rec.today), nf.weekday(rec.today, lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم إنجاز إخلاء طرفك اعتباراً من {ds} ({wd}).\n"
            f"نتمنى لك التوفيق.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your employee clearance has been completed, effective {ds} ({wd}).\n"
        f"We wish you all the best.\n"
        f"{_SIGNATURE_EN}"
    )
```

Extend `_BUILDERS`:

```python
_BUILDERS = {
    nf.EVENT_LEAVE_APPROVED: _leave_approved,
    nf.EVENT_DUTY_RESUMPTION: _duty_resumption,
    nf.EVENT_VIOLATION: _violation,
    nf.EVENT_SALARY_TRANSFER: _salary_transfer,
    nf.EVENT_SALARY_DEDUCTION: _salary_deduction,
    nf.EVENT_EMPLOYEE_CLEARANCE: _employee_clearance,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_sms_templates.py -k "salary or clearance" -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/sms_templates.py backend/tests/test_sms_templates.py
git commit -m "feat(sms): salary-transfer/deduction/clearance templates"
```

---

### Task 5: Acknowledgement builders — HR Request, Passport, Resignation (`sms_templates`)

**Files:**
- Modify: `backend/app/services/sms_templates.py`
- Test: `backend/tests/test_sms_templates.py`

**Interfaces:**
- Consumes: `nf.hr_request_docs`, `nf.fmt_date`, `nf.weekday`, `nf.employee_name`, event constants.
- Produces: builders `_hr_request`, `_passport_release`, `_resignation` added to `_BUILDERS`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_sms_templates.py`:

```python
def test_hr_request_single_ar():
    rec = SimpleNamespace(fields={"doc_selections": {"salary_certificate": True}}, today=date(2026, 7, 5))
    text = sms_templates.render_text(nf.EVENT_HR_REQUEST, "ar", rec, _emp())
    assert "تم تقديم طلبك للحصول على شهادة راتب." in text
    assert "سيتم إبلاغك عند صدور المستند." in text
    assert not _has_ascii_letter(text)


def test_hr_request_single_en():
    rec = SimpleNamespace(fields={"doc_selections": "salary_certificate"}, today=date(2026, 7, 5))
    text = sms_templates.render_text(nf.EVENT_HR_REQUEST, "en", rec, _emp())
    assert "Your request for Salary Certificate has been submitted." in text
    assert "You will be notified once the document is issued." in text


def test_hr_request_plural_ar():
    rec = SimpleNamespace(
        fields={"doc_selections": {"salary_certificate": True, "experience_certificate": True}},
        today=date(2026, 7, 5),
    )
    text = sms_templates.render_text(nf.EVENT_HR_REQUEST, "ar", rec, _emp())
    assert "تم تقديم طلبك للحصول على المستندات التالية: شهادة راتب، شهادة خبرة." in text
    assert "سيتم إبلاغك عند صدورها." in text


def test_passport_release_ar():
    rec = SimpleNamespace(fields={}, today=date(2026, 7, 5))
    text = sms_templates.render_text(nf.EVENT_PASSPORT_RELEASE, "ar", rec, _emp())
    assert "تم تقديم طلب استلام جواز سفرك." in text
    assert "سيتم إبلاغك عند جاهزيته للاستلام." in text
    assert not _has_ascii_letter(text)


def test_passport_release_en():
    rec = SimpleNamespace(fields={}, today=date(2026, 7, 5))
    text = sms_templates.render_text(nf.EVENT_PASSPORT_RELEASE, "en", rec, _emp())
    assert "Your passport release request has been submitted." in text
    assert "You will be notified when it is ready for collection." in text


def test_resignation_ar():
    rec = SimpleNamespace(fields={}, today=date(2026, 7, 5))
    text = sms_templates.render_text(nf.EVENT_RESIGNATION, "ar", rec, _emp())
    assert "تم استلام خطاب استقالتك بتاريخ 05/07/2026 (الأحد)." in text
    assert "سيتم إبلاغك بالإجراءات التالية." in text
    assert not _has_ascii_letter(text.replace("05/07/2026", ""))


def test_resignation_en():
    rec = SimpleNamespace(fields={}, today=date(2026, 7, 5))
    text = sms_templates.render_text(nf.EVENT_RESIGNATION, "en", rec, _emp())
    assert "Your resignation letter has been received on 05/07/2026 (Sunday)." in text
    assert "You will be informed of the next steps." in text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_sms_templates.py -k "hr_request or passport or resignation" -v`
Expected: FAIL with `KeyError: 'hr_request'`.

- [ ] **Step 3: Implement the builders and register them**

Add to `backend/app/services/sms_templates.py`:

```python
def _hr_request(rec, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    docs, count = nf.hr_request_docs((rec.fields or {}).get("doc_selections"), lang)
    if lang == "ar":
        if count > 1:
            body = (
                f"تم تقديم طلبك للحصول على المستندات التالية: {docs}.\n"
                f"سيتم إبلاغك عند صدورها.\n"
            )
        else:
            body = (
                f"تم تقديم طلبك للحصول على {docs}.\n"
                f"سيتم إبلاغك عند صدور المستند.\n"
            )
        return f"عزيزي {name}،\n{body}{_SIGNATURE_AR}"
    if count > 1:
        body = (
            f"Your request for the following documents has been submitted: {docs}.\n"
            f"You will be notified once the documents are issued.\n"
        )
    else:
        body = (
            f"Your request for {docs} has been submitted.\n"
            f"You will be notified once the document is issued.\n"
        )
    return f"Dear {name},\n{body}{_SIGNATURE_EN}"


def _passport_release(rec, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم تقديم طلب استلام جواز سفرك.\n"
            f"سيتم إبلاغك عند جاهزيته للاستلام.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your passport release request has been submitted.\n"
        f"You will be notified when it is ready for collection.\n"
        f"{_SIGNATURE_EN}"
    )


def _resignation(rec, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    ds, wd = nf.fmt_date(rec.today), nf.weekday(rec.today, lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم استلام خطاب استقالتك بتاريخ {ds} ({wd}).\n"
            f"سيتم إبلاغك بالإجراءات التالية.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your resignation letter has been received on {ds} ({wd}).\n"
        f"You will be informed of the next steps.\n"
        f"{_SIGNATURE_EN}"
    )
```

Add the three entries to `_BUILDERS`:

```python
    nf.EVENT_HR_REQUEST: _hr_request,
    nf.EVENT_PASSPORT_RELEASE: _passport_release,
    nf.EVENT_RESIGNATION: _resignation,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_sms_templates.py -k "hr_request or passport or resignation" -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/sms_templates.py backend/tests/test_sms_templates.py
git commit -m "feat(sms): HR-request/passport/resignation templates"
```

---

### Task 6: Disciplinary builder — Warning (`sms_templates`)

**Files:**
- Modify: `backend/app/services/sms_templates.py`
- Test: `backend/tests/test_sms_templates.py`

**Interfaces:**
- Consumes: `nf.type_label` (the same violation-type localizer the `_violation` builder uses), `nf.ADMIN_OFFICE_AR`, `nf.fmt_date`, `nf.weekday`.
- Produces: builder `_warning` added to `_BUILDERS`. Reads `record.fields["violation_type"]` and `record.today`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_sms_templates.py`:

```python
def test_warning_ar_routes_to_admin_office():
    rec = SimpleNamespace(
        fields={"violation_type": "Late Attendance - التأخر عن الدوام"},
        today=date(2026, 7, 5),
    )
    text = sms_templates.render_text(nf.EVENT_WARNING, "ar", rec, _emp())
    assert "تم إصدار إنذار بحقك بتاريخ 05/07/2026 (الأحد)." in text
    assert "المخالفة: التأخر عن الدوام." in text
    assert "يرجى مراجعة مكتب الإدارة لأي استفسار." in text
    assert "مكتب الموارد البشرية" not in text          # warnings route to admin, not HR
    assert not _has_ascii_letter(text.replace("05/07/2026", ""))


def test_warning_en():
    rec = SimpleNamespace(
        fields={"violation_type": "Late Attendance - التأخر عن الدوام"},
        today=date(2026, 7, 5),
    )
    text = sms_templates.render_text(nf.EVENT_WARNING, "en", rec, _emp())
    assert "A warning has been issued against you on 05/07/2026 (Sunday)." in text
    assert "Violation: Late Attendance." in text
    assert "Please contact the administration office for any clarification." in text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_sms_templates.py -k warning -v`
Expected: FAIL with `KeyError: 'warning'`.

- [ ] **Step 3: Implement the builder and register it**

Add to `backend/app/services/sms_templates.py`:

```python
def _warning(rec, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    ds, wd = nf.fmt_date(rec.today), nf.weekday(rec.today, lang)
    vtype = nf.type_label((rec.fields or {}).get("violation_type", ""), lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم إصدار إنذار بحقك بتاريخ {ds} ({wd}).\n"
            f"المخالفة: {vtype}.\n"
            f"يرجى مراجعة {nf.ADMIN_OFFICE_AR} لأي استفسار.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"A warning has been issued against you on {ds} ({wd}).\n"
        f"Violation: {vtype}.\n"
        f"Please contact the administration office for any clarification.\n"
        f"{_SIGNATURE_EN}"
    )
```

Add to `_BUILDERS`:

```python
    nf.EVENT_WARNING: _warning,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_sms_templates.py -k warning -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/sms_templates.py backend/tests/test_sms_templates.py
git commit -m "feat(sms): warning template (routes to admin office)"
```

---

### Task 7: Book loader + wire the 7 events into `sms_service`

**Files:**
- Modify: `backend/app/services/sms_service.py`
- Test: `backend/tests/test_sms_service.py`

**Interfaces:**
- Consumes: `nf.BOOK_EVENTS`, the builders (via `render_text`), `Book`/`BookVersion` models.
- Produces:
  - `BookEvent` (frozen dataclass): `.employee: Employee`, `.fields: dict`, `.today: date`.
  - `_load_book_event(db, book_id) -> BookEvent | None` — loads the `Book`, takes its latest version (`book.versions[-1]`, ordered by `version_no`), returns `BookEvent(employee=book.employee, fields=version.fields or {}, today=date.today())`. Returns `None` if the book, its versions, or its employee are missing.
  - `_LOADERS` extended so all 7 `BOOK_EVENTS` map to `_load_book_event`.

**Note:** `send_for_event` already does `record.employee`, `record` → `render_text`. `BookEvent.employee` satisfies the first; builders read `.fields`/`.today`. No change to `send_for_event`'s body is required beyond the loader registration.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_sms_service.py` (reuse the file's existing DB/session fixtures and Employee/Book factories; if a Book factory doesn't exist, build the rows inline as below):

```python
from datetime import date
from app.db.models import Book, BookVersion
from app.services import notify_format as nf, sms_service


def test_load_book_event_returns_latest_version_fields(db_session):
    emp = _make_employee(db_session, id="E1", name_ar="محمد أحمد", name_en="Mohammed Ahmed")
    book = Book(employee_id=emp.id)
    db_session.add(book); db_session.flush()
    db_session.add(BookVersion(book_id=book.id, version_no=1,
                               template_id="Salary Transfer Request", fields={"bank_name": "OLD"}))
    db_session.add(BookVersion(book_id=book.id, version_no=2,
                               template_id="Salary Transfer Request", fields={"bank_name": "بنك أبوظبي الأول"}))
    db_session.commit()

    ev = sms_service._load_book_event(db_session, book.id)
    assert ev is not None
    assert ev.employee.id == "E1"
    assert ev.fields["bank_name"] == "بنك أبوظبي الأول"   # latest version wins
    assert ev.today == date.today()


def test_load_book_event_missing_book_returns_none(db_session):
    assert sms_service._load_book_event(db_session, 999999) is None


def test_all_book_events_have_a_loader():
    for ev in nf.BOOK_EVENTS:
        assert sms_service._LOADERS.get(ev) is sms_service._load_book_event
```

(`_make_employee` — reuse the existing helper in `test_sms_service.py`; if absent, add a minimal one that inserts an `Employee` with the given id/names and commits.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend; python -m pytest tests/test_sms_service.py -k book_event -v`
Expected: FAIL with `AttributeError: module 'app.services.sms_service' has no attribute '_load_book_event'`.

- [ ] **Step 3: Implement the loader and register it**

In `backend/app/services/sms_service.py`:

Add imports at the top (extend the existing `from datetime import ...` / model import lines):

```python
from dataclasses import dataclass
from datetime import date

from app.db.models import Book  # add Book to the existing model import line
```

(Only `Book` is needed here — the loader reaches versions via `book.versions`. `BookVersion` is imported in the *test* file, not the service.)

Add the dataclass and loader (after the existing `_load_violation`):

```python
@dataclass(frozen=True)
class BookEvent:
    """Adapter so book-backed services flow through the same render path as
    Leave/Violation records: exposes the fields the builders read."""
    employee: Employee
    fields: dict
    today: date


def _load_book_event(db: Session, book_id: int) -> BookEvent | None:
    book = db.get(Book, book_id)
    if book is None or not book.versions or book.employee is None:
        return None
    version = book.versions[-1]  # relationship is ordered by version_no ascending
    return BookEvent(employee=book.employee, fields=version.fields or {}, today=date.today())
```

Register all 7 events in `_LOADERS` (after the existing three entries):

```python
_LOADERS = {
    nf.EVENT_LEAVE_APPROVED: _load_leave,
    nf.EVENT_DUTY_RESUMPTION: _load_leave,
    nf.EVENT_VIOLATION: _load_violation,
    **{ev: _load_book_event for ev in nf.BOOK_EVENTS},
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_sms_service.py -k book_event -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full backend SMS suite**

Run: `cd backend; python -m pytest tests/test_sms_service.py tests/test_sms_templates.py tests/test_notify_format.py -v`
Expected: PASS (all, including the pre-existing tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/sms_service.py backend/tests/test_sms_service.py
git commit -m "feat(sms): load book-backed services for SMS send"
```

---

### Task 8: Frontend — extend `SmsEventType` + surface the button on the book record page

**Files:**
- Modify: `frontend/src/lib/api.ts:1562`
- Modify: `frontend/src/pages/books/BookRecordPage.tsx`
- Test: `frontend/src/components/sms/SendSmsButton.test.tsx` (extend)

**Interfaces:**
- Consumes: existing `SendSmsButton` (`eventType: SmsEventType`, `recordId: number`).
- Produces: `TEMPLATE_SMS_EVENTS: Record<string, SmsEventType>` mapping `template_id` → event, and a `<SendSmsButton>` rendered on the book record page for supported per-employee templates.

- [ ] **Step 1: Extend the event-type union**

In `frontend/src/lib/api.ts`, replace line 1562:

```typescript
export type SmsEventType =
  | 'leave_approved' | 'duty_resumption' | 'violation'
  | 'salary_transfer' | 'salary_deduction' | 'employee_clearance'
  | 'hr_request' | 'passport_release' | 'warning' | 'resignation'
```

- [ ] **Step 2: Write the failing test (button renders for a book event type)**

In `frontend/src/components/sms/SendSmsButton.test.tsx`, add a case that mounts the button with `eventType="salary_transfer"` and a numeric `recordId`, mocking `getSmsStatus` to return `{ enabled: true, last: null }` and capabilities including `employees.notify`, then asserts the send button is visible. Mirror the existing test setup in that file (same mocks/harness) — only the `eventType` value differs.

Run: `cd frontend; npm test -- SendSmsButton`
Expected: FAIL only if the union type rejected the new value at compile time; otherwise it should compile once Step 1 is done. If it passes immediately after Step 1, that confirms the type wiring — proceed.

- [ ] **Step 3: Add the template→event map and render the button**

In `frontend/src/pages/books/BookRecordPage.tsx`, add near the top-level imports:

```typescript
import { SendSmsButton } from '../../components/sms/SendSmsButton'
import type { SmsEventType } from '../../lib/api'

const TEMPLATE_SMS_EVENTS: Record<string, SmsEventType> = {
  'Salary Transfer Request': 'salary_transfer',
  'Salary Deduction Form': 'salary_deduction',
  'Employee Clearance Form': 'employee_clearance',
  'HR Request Form': 'hr_request',
  'Passport Release Form': 'passport_release',
  'Warning Form': 'warning',
  'Resignation Letter': 'resignation',
}
```

In the record's action area (where other per-record actions render — locate the header/toolbar of the book detail; follow the pattern used for the PDF/print/sign actions already present), render:

```tsx
{book.employee_id && TEMPLATE_SMS_EVENTS[book.template_id] && (
  <SendSmsButton
    eventType={TEMPLATE_SMS_EVENTS[book.template_id]}
    recordId={book.id}
  />
)}
```

Use whatever the page already calls the book object and its `template_id`/`employee_id` accessors (the `Book` API type exposes `template_id` and `employee_id`; if the page reads `template_id` from the latest version, use that source instead — match the page's existing data shape). `SendSmsButton` self-hides when SMS is disabled or the user lacks `employees.notify`, so no extra gating is needed.

- [ ] **Step 4: Run frontend checks**

Run: `cd frontend; npm run typecheck; npm test -- SendSmsButton`
Expected: typecheck PASS (no type errors from the new union/map), tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/books/BookRecordPage.tsx frontend/src/components/sms/SendSmsButton.test.tsx
git commit -m "feat(sms): notify-by-SMS button on book service records"
```

---

### Task 9: Manual verification + i18n review

**Files:** none (verification only).

- [ ] **Step 1: Dispatch the i18n/notification reviewer** on the final `sms_templates.py` + `notify_format.py` diff (per the project's notification-template-reviewer agent) — confirm no English leak in AR bodies, canonical terminology, signature match. Fix any findings inline and re-run the affected tests.

- [ ] **Step 2: Full suite** — `cd backend; python -m pytest tests/ -q` → all pass.

- [ ] **Step 3: Live smoke (optional, requires `GSSG_SMS_ENABLED=true` + provisioned phone).** Generate one Salary Transfer book for a test employee with a mobile in `contact`, open its record page, click **Notify by SMS**, confirm the phone sends and the badge shows `Sent ✓`. If SMS is not yet provisioned, skip and note it.

- [ ] **Step 4: Update `deploy/SMS-SETUP.md`** — add the 7 new service events to the list of what "Notify by SMS" covers (one line). Commit.

```bash
git add deploy/SMS-SETUP.md
git commit -m "docs(sms): document service-form SMS events"
```
