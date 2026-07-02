# Passport-Number OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `Employee.passport_no` by OCR'ing employees' stored passport scans — auto-writing only checksum-validated MRZ results — with a manual-entry path on the employee profile, so the Passport Release list auto-fills the passport column.

**Architecture:** Reuse the existing extraction pipeline (`ocr.py`, `passport_mrz.py`, `DocType.PASSPORT`). Add a printed-field fallback parser, a `passport_ocr_service` that resolves an employee's vault passport scan → extraction result (no write), and a write-policy helper that auto-writes only validated MRZ. Three trigger paths reuse that service: a backfill script, an auto-on-upload hook, and an on-demand extract endpoint. A `passport_no_source` provenance column + a computed `has_passport_scan` flag drive the profile status badge.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy / Alembic / pytest (backend); React / TypeScript / react-hook-form / vitest / i18next (frontend); Tesseract + `mrz>=0.6.2` + PyMuPDF (OCR).

## Global Constraints

- Auto-write `passport_no` **only** when the MRZ checksum is valid (parser confidence `>= 0.9`) **and** the field is currently empty (unless `allow_overwrite=True`). Never silently overwrite an existing value.
- `passport_no_source` has exactly two non-null values: `mrz` (automatic writes) and `manual` (any `PATCH`-originated write). NULL otherwise.
- `passport_no` max length is 128 chars (`_FIELD_TEXT_MAX`); the column is `String(64)` — keep extracted values within 64 chars.
- OCR is capped by `OCR_GATE = threading.Semaphore(2)`; the backfill runs sequentially. `OcrUnavailableError` and a missing `mrz` package must degrade gracefully (never 500 the upload / never crash the batch).
- Employee edit is gated by capability `employees.edit`.
- Frontend copy must keep Arabic and English separated (project has an i18n reviewer). Provide both `label_en`/`ar` strings.
- The vault "kind" for passport scans is the literal `"passport"` (`VaultKind`).

---

## File Structure

**Backend — new:**
- `backend/app/core/extraction/passport_printed.py` — printed-field fallback parser (pure function).
- `backend/app/services/passport_ocr_service.py` — `PassportExtractResult`, `extract_passport_for_employee`, `apply_passport_extraction`.
- `backend/app/db/migrations/versions/0046_employee_passport_no_source.py` — add column.
- `backend/scripts/backfill_passport_no.py` — one-time batch.
- Tests: `backend/tests/test_passport_printed.py`, `test_passport_ocr_service.py`, `test_passport_extract_endpoint.py`, `test_passport_upload_hook.py`, `test_backfill_passport_no.py`, `test_employee_passport_source.py`.

**Backend — modified:**
- `backend/app/db/models.py` — add `Employee.passport_no_source`.
- `backend/app/schemas/employee.py` — `EmployeeRead`: `passport_no_source`, `has_passport_scan`.
- `backend/app/services/employee_service.py` — set `passport_no_source='manual'` when a PATCH sets `passport_no`.
- `backend/app/api/v1/employees.py` — inject `has_passport_scan`; add `POST /employees/{id}/passport/extract`; auto-extract hook in the vault upload handler.

**Frontend — modified:**
- `frontend/src/lib/api.types.ts` + `frontend/src/lib/api.ts` — types + client method for the extract endpoint.
- Employee profile detail component (located in Task 8) — passport field + badge + "Read from scan" button.
- `frontend/src/locales/en/*.json` + `frontend/src/locales/ar/*.json` (or the project's i18n files, located in Task 8).

---

### Task 1: Provenance column `passport_no_source`

**Files:**
- Modify: `backend/app/db/models.py` (Employee class — add column next to `passport_no`)
- Create: `backend/app/db/migrations/versions/0046_employee_passport_no_source.py`
- Test: `backend/tests/test_employee_passport_source.py`

**Interfaces:**
- Produces: `Employee.passport_no_source: str | None` (column, `String(16)`, nullable).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_employee_passport_source.py
from app.db.models import Employee


def test_employee_has_passport_no_source_column(db_session):
    emp = Employee(id="G9001", name_en="Test", status="Active")
    emp.passport_no_source = "mrz"
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)
    assert emp.passport_no_source == "mrz"


def test_passport_no_source_defaults_none(db_session):
    emp = Employee(id="G9002", name_en="Test2", status="Active")
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)
    assert emp.passport_no_source is None
```

> If `db_session` is not the fixture name, check `backend/tests/conftest.py` for the session fixture and match it.

- [ ] **Step 2: Run test to verify it fails**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest tests/test_employee_passport_source.py -v` (from `backend/`)
Expected: FAIL — `AttributeError`/column missing.

- [ ] **Step 3: Add the column to the model**

In `backend/app/db/models.py`, in the `Employee` class immediately after the `passport_no` column:

```python
    passport_no_source: Mapped[str | None] = mapped_column(String(16), nullable=True)
```

- [ ] **Step 4: Create the Alembic migration**

```python
# backend/app/db/migrations/versions/0046_employee_passport_no_source.py
"""Add employees.passport_no_source provenance column.

Records how passport_no was set: 'mrz' (auto OCR of a validated MRZ) or
'manual' (operator PATCH). NULL when unset. See spec 2026-07-02-passport-ocr.

Revision ID: 0046_employee_passport_no_source
Revises: 0045_leave_dedupe_index
Create Date: 2026-07-02
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0046_employee_passport_no_source"
down_revision: str | Sequence[str] | None = "0045_leave_dedupe_index"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "employees",
        sa.Column("passport_no_source", sa.String(length=16), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("employees", "passport_no_source")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest tests/test_employee_passport_source.py -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Verify the migration applies cleanly on a scratch DB**

Run (from `backend/`):
```bash
/c/Users/Admin/sentinel/venv/Scripts/python.exe -c "import sqlalchemy as sa; e=sa.create_engine('sqlite:////tmp/mig.db'); from alembic.config import Config; from alembic import command; c=Config('alembic.ini'); command.upgrade(c,'head'); print('ok')"
```
Expected: prints `ok` (adjust `alembic.ini` path if the config lives elsewhere — check `backend/`). If the harness has no alembic.ini, skip and rely on Step 5 (tests build schema from `Base.metadata`).

- [ ] **Step 7: Commit**

```bash
git add backend/app/db/models.py backend/app/db/migrations/versions/0046_employee_passport_no_source.py backend/tests/test_employee_passport_source.py
git commit -m "feat(employees): add passport_no_source provenance column (migration 0046)"
```

---

### Task 2: Printed-field fallback parser

**Files:**
- Create: `backend/app/core/extraction/passport_printed.py`
- Test: `backend/tests/test_passport_printed.py`

**Interfaces:**
- Produces: `extract_printed_passport_no(text: str) -> tuple[str, str] | None` — returns `(number, source_snippet)` or `None`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_passport_printed.py
from app.core.extraction.passport_printed import extract_printed_passport_no


def test_english_label():
    got = extract_printed_passport_no("Nationality: India\nPassport No: N1234567\nDOB: 1990")
    assert got is not None
    assert got[0] == "N1234567"


def test_english_label_hash_and_spacing():
    assert extract_printed_passport_no("Passport #  A9988776")[0] == "A9988776"


def test_arabic_label():
    got = extract_printed_passport_no("رقم الجواز : P7654321\nالجنسية: مصر")
    assert got is not None
    assert got[0] == "P7654321"


def test_no_label_returns_none():
    assert extract_printed_passport_no("just some text with 12345 and no label") is None


def test_requires_digit_rejects_words():
    # A labelled but all-alpha token is not a passport number.
    assert extract_printed_passport_no("Passport No: PENDING") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest tests/test_passport_printed.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the parser**

```python
# backend/app/core/extraction/passport_printed.py
"""Printed-field fallback for passport numbers.

Used when a scan has no clean MRZ. Reads a *labelled* passport number from OCR
text (English or Arabic label). Lower confidence than MRZ — callers must NOT
auto-write these (see passport_ocr_service write policy).
"""

from __future__ import annotations

import re

# Label variants, then optional separator, then the candidate token.
# Token: 6-12 chars of A-Z/0-9 with at least one digit (passport numbers vary
# by country but always contain digits).
_LABELS = r"(?:passport\s*(?:no|number|#)|رقم\s*(?:ال)?جواز(?:\s*السفر)?)"
_PATTERN = re.compile(
    rf"{_LABELS}\s*[:#\-]?\s*([A-Z0-9]{{6,12}})",
    re.IGNORECASE,
)


def extract_printed_passport_no(text: str) -> tuple[str, str] | None:
    """Return (number, source_snippet) for a labelled passport number, or None."""
    for m in _PATTERN.finditer(text):
        token = m.group(1).upper()
        if any(ch.isdigit() for ch in token):
            snippet = text[max(0, m.start() - 10) : m.end() + 10].strip()
            return token, snippet
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest tests/test_passport_printed.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/extraction/passport_printed.py backend/tests/test_passport_printed.py
git commit -m "feat(extraction): printed-field passport-number fallback parser"
```

---

### Task 3: Passport OCR service (resolve scan → result; write policy)

**Files:**
- Create: `backend/app/services/passport_ocr_service.py`
- Test: `backend/tests/test_passport_ocr_service.py`

**Interfaces:**
- Consumes: `vault_service.list_tree`, `vault_service.resolve_file`; `ocr.ocr_bytes_to_text`, `ocr.OcrUnavailableError`; `passport_mrz.extract_passport`; `passport_printed.extract_printed_passport_no`; `Employee` model (Task 1 column).
- Produces:
  - `PassportExtractResult` dataclass: `number: str | None`, `confidence: float`, `method: str` (`"mrz"|"printed"|"none"`), `source_snippet: str | None`, `scan_filename: str`.
  - `extract_passport_for_employee(db: Session, g_number: str) -> PassportExtractResult | None` — `None` when no passport scan exists.
  - `apply_passport_extraction(db: Session, employee: Employee, result: PassportExtractResult, *, allow_overwrite: bool = False) -> bool` — returns True if it wrote.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_passport_ocr_service.py
import pytest

from app.db.models import Employee
from app.services import passport_ocr_service as svc


@pytest.fixture
def emp(db_session):
    e = Employee(id="G7001", name_en="Scan Target", status="Active")
    db_session.add(e)
    db_session.commit()
    return e


def _fake_tree_with_passport(monkeypatch, filename="pp.pdf"):
    from datetime import datetime
    from app.schemas.vault_file import VaultEntry, VaultTree

    entry = VaultEntry(filename=filename, kind="passport", size_bytes=10,
                       modified=datetime(2026, 1, 1), is_pdf=True)
    monkeypatch.setattr(svc.vault_service, "list_tree",
                        lambda g: VaultTree(employee_id=g, folders={"passport": [entry]}))
    monkeypatch.setattr(svc.vault_service, "resolve_file",
                        lambda g, k, f: __import__("pathlib").Path("/tmp/pp.pdf"))
    monkeypatch.setattr(svc.Path, "read_bytes", lambda self: b"%PDF-1.4 fake")


def test_no_scan_returns_none(db_session, emp, monkeypatch):
    from app.schemas.vault_file import VaultTree
    monkeypatch.setattr(svc.vault_service, "list_tree",
                        lambda g: VaultTree(employee_id=g, folders={"passport": []}))
    assert svc.extract_passport_for_employee(db_session, "G7001") is None


def test_mrz_hit_is_high_confidence(db_session, emp, monkeypatch):
    _fake_tree_with_passport(monkeypatch)
    monkeypatch.setattr(svc, "ocr_bytes_to_text", lambda raw: "IGNORED")
    from app.core.extraction.types import DocType, ExtractedField, Extraction
    monkeypatch.setattr(svc, "extract_passport", lambda t: Extraction(
        doc_type=DocType.PASSPORT, doc_type_confidence=0.95,
        fields=[ExtractedField("passport_no", "N1234567", 0.95)]))
    res = svc.extract_passport_for_employee(db_session, "G7001")
    assert res.method == "mrz" and res.number == "N1234567" and res.confidence >= 0.9


def test_printed_fallback_when_no_mrz(db_session, emp, monkeypatch):
    _fake_tree_with_passport(monkeypatch)
    monkeypatch.setattr(svc, "ocr_bytes_to_text", lambda raw: "Passport No: A7654321")
    monkeypatch.setattr(svc, "extract_passport", lambda t: None)
    res = svc.extract_passport_for_employee(db_session, "G7001")
    assert res.method == "printed" and res.number == "A7654321" and res.confidence < 0.9


def test_apply_writes_mrz_when_empty(db_session, emp):
    res = svc.PassportExtractResult(number="N1234567", confidence=0.95,
                                    method="mrz", source_snippet=None, scan_filename="pp.pdf")
    wrote = svc.apply_passport_extraction(db_session, emp, res)
    assert wrote is True
    db_session.refresh(emp)
    assert emp.passport_no == "N1234567" and emp.passport_no_source == "mrz"


def test_apply_does_not_write_printed(db_session, emp):
    res = svc.PassportExtractResult(number="A7654321", confidence=0.5,
                                    method="printed", source_snippet=None, scan_filename="pp.pdf")
    assert svc.apply_passport_extraction(db_session, emp, res) is False
    db_session.refresh(emp)
    assert emp.passport_no is None


def test_apply_does_not_overwrite_existing(db_session, emp):
    emp.passport_no = "EXISTING1"
    emp.passport_no_source = "manual"
    db_session.commit()
    res = svc.PassportExtractResult(number="N1234567", confidence=0.95,
                                    method="mrz", source_snippet=None, scan_filename="pp.pdf")
    assert svc.apply_passport_extraction(db_session, emp, res) is False
    db_session.refresh(emp)
    assert emp.passport_no == "EXISTING1"


def test_apply_overwrite_flag_allows_replace(db_session, emp):
    emp.passport_no = "EXISTING1"
    db_session.commit()
    res = svc.PassportExtractResult(number="N1234567", confidence=0.95,
                                    method="mrz", source_snippet=None, scan_filename="pp.pdf")
    assert svc.apply_passport_extraction(db_session, emp, res, allow_overwrite=True) is True
    db_session.refresh(emp)
    assert emp.passport_no == "N1234567"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest tests/test_passport_ocr_service.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

```python
# backend/app/services/passport_ocr_service.py
"""Resolve an employee's stored passport scan → passport number.

Reuses the extraction pipeline: OCR the newest passport-kind vault file, try
the checksum-validated MRZ parser first, then a labelled printed-field
fallback. Never writes on its own — `apply_passport_extraction` owns the
write policy (auto-write only validated MRZ into an empty field).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.extraction.ocr import OcrUnavailableError, ocr_bytes_to_text
from app.core.extraction.passport_mrz import extract_passport
from app.core.extraction.passport_printed import extract_printed_passport_no
from app.db.models import Employee
from app.services import vault_service

log = logging.getLogger(__name__)

# Auto-write threshold: the MRZ parser returns 0.95 for a checksum-valid block
# and 0.55 for a structurally-sound but failing one. Only the former auto-writes.
MRZ_AUTOWRITE_CONFIDENCE = 0.9


@dataclass(frozen=True)
class PassportExtractResult:
    number: str | None
    confidence: float
    method: str  # "mrz" | "printed" | "none"
    source_snippet: str | None
    scan_filename: str


def _newest_passport_scan(g_number: str) -> str | None:
    """Filename of the most-recently-modified passport-kind vault file, or None."""
    tree = vault_service.list_tree(g_number)
    entries = tree.folders.get("passport", [])
    if not entries:
        return None
    return max(entries, key=lambda e: e.modified).filename


def extract_passport_for_employee(
    db: Session, g_number: str
) -> PassportExtractResult | None:
    """OCR the employee's newest passport scan → result. None if no scan."""
    filename = _newest_passport_scan(g_number)
    if filename is None:
        return None

    path: Path = vault_service.resolve_file(g_number, "passport", filename)
    try:
        text = ocr_bytes_to_text(path.read_bytes())
    except OcrUnavailableError:
        log.warning("passport OCR unavailable for %s", g_number)
        return PassportExtractResult(None, 0.0, "none", None, filename)

    mrz = extract_passport(text)
    if mrz is not None:
        f = mrz.field("passport_no")
        if f and f.value:
            return PassportExtractResult(
                f.value[:64], mrz.doc_type_confidence, "mrz", None, filename
            )

    printed = extract_printed_passport_no(text)
    if printed is not None:
        number, snippet = printed
        return PassportExtractResult(number[:64], 0.5, "printed", snippet, filename)

    return PassportExtractResult(None, 0.0, "none", None, filename)


def apply_passport_extraction(
    db: Session,
    employee: Employee,
    result: PassportExtractResult,
    *,
    allow_overwrite: bool = False,
) -> bool:
    """Write only a validated-MRZ number into an empty field. Returns True if written."""
    if result.method != "mrz" or not result.number:
        return False
    if result.confidence < MRZ_AUTOWRITE_CONFIDENCE:
        return False
    if employee.passport_no and not allow_overwrite:
        return False
    employee.passport_no = result.number
    employee.passport_no_source = "mrz"
    db.commit()
    return True
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest tests/test_passport_ocr_service.py -v`
Expected: PASS (7 tests). If `svc.Path.read_bytes` monkeypatch is awkward in the harness, adjust the test to monkeypatch `svc.vault_service.resolve_file` to return a real temp file written with `b"..."`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/passport_ocr_service.py backend/tests/test_passport_ocr_service.py
git commit -m "feat(passport): vault-scan passport OCR service + write policy"
```

---

### Task 4: Employee read badge data + manual-source on PATCH

**Files:**
- Modify: `backend/app/schemas/employee.py` (`EmployeeRead`)
- Modify: `backend/app/api/v1/employees.py` (inject `has_passport_scan`)
- Modify: `backend/app/services/employee_service.py` (`update_employee`)
- Test: `backend/tests/test_employee_passport_source.py` (extend)

**Interfaces:**
- Consumes: `passport_no_source` column (Task 1); `vault_service.list_tree`.
- Produces: `EmployeeRead.passport_no_source: str | None`, `EmployeeRead.has_passport_scan: bool`; `update_employee` sets `passport_no_source='manual'` when the patch includes `passport_no`.

- [ ] **Step 1: Write the failing tests**

```python
# append to backend/tests/test_employee_passport_source.py
from app.schemas.employee import EmployeeUpdate
from app.services import employee_service


def test_patch_passport_no_sets_manual_source(db_session):
    emp = Employee(id="G9003", name_en="Patch", status="Active")
    db_session.add(emp)
    db_session.commit()
    employee_service.update_employee(db_session, "G9003", EmployeeUpdate(passport_no="M0001234"))
    db_session.refresh(emp)
    assert emp.passport_no == "M0001234"
    assert emp.passport_no_source == "manual"


def test_patch_without_passport_leaves_source(db_session):
    emp = Employee(id="G9004", name_en="Patch2", status="Active", passport_no_source="mrz")
    db_session.add(emp)
    db_session.commit()
    employee_service.update_employee(db_session, "G9004", EmployeeUpdate(department="Ops"))
    db_session.refresh(emp)
    assert emp.passport_no_source == "mrz"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest tests/test_employee_passport_source.py::test_patch_passport_no_sets_manual_source -v`
Expected: FAIL — source stays None.

- [ ] **Step 3: Update `update_employee`**

In `backend/app/services/employee_service.py`, inside `update_employee`, after
`data = payload.model_dump(exclude_unset=True)` and before the `setattr` loop, add:

```python
    # A human-entered/confirmed passport number is provenance 'manual'.
    if "passport_no" in data:
        data["passport_no_source"] = "manual"
```

- [ ] **Step 4: Add read fields + inject `has_passport_scan`**

In `backend/app/schemas/employee.py`, add to `EmployeeRead` (after `passport_no`):

```python
    passport_no_source: str | None = None
    # True when the employee has at least one passport-kind vault scan on file.
    has_passport_scan: bool = False
```

In `backend/app/api/v1/employees.py`, add a helper near `_photo_fields` and
include it in the single-employee read responses (`get_employee`, `update_employee`)
via `model_copy`:

```python
def _passport_scan_field(employee_id: str) -> dict[str, object]:
    from app.services import vault_service
    tree = vault_service.list_tree(employee_id)
    return {"has_passport_scan": bool(tree.folders.get("passport"))}
```

Update the two single-read returns, e.g.:

```python
    return EmployeeRead.model_validate(row).model_copy(
        update={**_photo_fields(db, row.id), **_passport_scan_field(row.id)}
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest tests/test_employee_passport_source.py -v`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/employee.py backend/app/api/v1/employees.py backend/app/services/employee_service.py backend/tests/test_employee_passport_source.py
git commit -m "feat(employees): passport_no_source + has_passport_scan on read; manual source on PATCH"
```

---

### Task 5: On-demand extract endpoint

**Files:**
- Modify: `backend/app/api/v1/employees.py` (new route + response schema)
- Test: `backend/tests/test_passport_extract_endpoint.py`

**Interfaces:**
- Consumes: `passport_ocr_service.extract_passport_for_employee`; capability `employees.edit`.
- Produces: `POST /api/v1/employees/{employee_id}/passport/extract` → `PassportSuggestion { number: str | None, confidence: float, method: str, source_snippet: str | None, scan_filename: str | None }`. 404 when the employee has no passport scan. Does **not** write.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_passport_extract_endpoint.py
from app.db.models import Employee
from app.services import passport_ocr_service as svc


def test_extract_endpoint_returns_suggestion_without_writing(client, db_session, monkeypatch):
    emp = Employee(id="G8001", name_en="Endpoint", status="Active")
    db_session.add(emp)
    db_session.commit()
    monkeypatch.setattr(
        svc, "extract_passport_for_employee",
        lambda db, g: svc.PassportExtractResult("N1234567", 0.95, "mrz", None, "pp.pdf"))
    r = client.post("/api/v1/employees/G8001/passport/extract")
    assert r.status_code == 200
    body = r.json()
    assert body["number"] == "N1234567" and body["method"] == "mrz"
    db_session.refresh(emp)
    assert emp.passport_no is None  # endpoint never writes


def test_extract_endpoint_404_when_no_scan(client, db_session, monkeypatch):
    emp = Employee(id="G8002", name_en="NoScan", status="Active")
    db_session.add(emp)
    db_session.commit()
    monkeypatch.setattr(svc, "extract_passport_for_employee", lambda db, g: None)
    r = client.post("/api/v1/employees/G8002/passport/extract")
    assert r.status_code == 404
```

> Match `client` / auth fixtures to `conftest.py`. If routes require an authenticated capability, use the same helper other employee-endpoint tests use to authorize `employees.edit`.

- [ ] **Step 2: Run test to verify it fails**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest tests/test_passport_extract_endpoint.py -v`
Expected: FAIL — 404/route missing.

- [ ] **Step 3: Add the response schema + route**

In `backend/app/api/v1/employees.py`:

```python
from pydantic import BaseModel

from app.api.errors import NotFoundError
from app.services import passport_ocr_service


class PassportSuggestion(BaseModel):
    number: str | None
    confidence: float
    method: str
    source_snippet: str | None
    scan_filename: str | None


@router.post("/{employee_id}/passport/extract", response_model=PassportSuggestion)
def extract_passport(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[object, Depends(require_capability("employees.edit"))],
) -> PassportSuggestion:
    result = passport_ocr_service.extract_passport_for_employee(db, employee_id)
    if result is None:
        raise NotFoundError(
            "PASSPORT_SCAN_NOT_FOUND",
            f"Employee {employee_id!r} has no passport scan to read",
            employee_id=employee_id,
        )
    return PassportSuggestion(
        number=result.number,
        confidence=result.confidence,
        method=result.method,
        source_snippet=result.source_snippet,
        scan_filename=result.scan_filename,
    )
```

> Reuse the file's existing imports (`Annotated`, `Depends`, `Session`, `get_db`, `require_capability`, `router`) — don't duplicate them.

- [ ] **Step 4: Run test to verify it passes**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest tests/test_passport_extract_endpoint.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/employees.py backend/tests/test_passport_extract_endpoint.py
git commit -m "feat(employees): POST /employees/{id}/passport/extract (suggest, no write)"
```

---

### Task 6: Auto-on-upload hook

**Files:**
- Modify: `backend/app/api/v1/employees.py` (the vault upload handler)
- Test: `backend/tests/test_passport_upload_hook.py`

**Interfaces:**
- Consumes: `passport_ocr_service.extract_passport_for_employee` + `apply_passport_extraction`.
- Produces: after a successful `kind="passport"` vault upload, best-effort auto-extract + write (validated MRZ into empty field). Never fails the upload.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_passport_upload_hook.py
import io

from app.db.models import Employee
from app.services import passport_ocr_service as svc


def test_passport_upload_autofills_on_mrz(client, db_session, monkeypatch):
    emp = Employee(id="G8100", name_en="Upload", status="Active")
    db_session.add(emp)
    db_session.commit()
    monkeypatch.setattr(
        svc, "extract_passport_for_employee",
        lambda db, g: svc.PassportExtractResult("N1234567", 0.95, "mrz", None, "pp.pdf"))
    files = {"file": ("pp.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")}
    r = client.post("/api/v1/employees/G8100/vault/upload", data={"kind": "passport"}, files=files)
    assert r.status_code in (200, 201)
    db_session.refresh(emp)
    assert emp.passport_no == "N1234567" and emp.passport_no_source == "mrz"


def test_non_passport_upload_does_not_autofill(client, db_session, monkeypatch):
    emp = Employee(id="G8101", name_en="Upload2", status="Active")
    db_session.add(emp)
    db_session.commit()
    called = {"n": 0}
    monkeypatch.setattr(svc, "extract_passport_for_employee",
                        lambda db, g: called.__setitem__("n", called["n"] + 1))
    files = {"file": ("id.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")}
    client.post("/api/v1/employees/G8101/vault/upload", data={"kind": "uae_id"}, files=files)
    assert called["n"] == 0
```

> Match the upload route's exact form field names to the existing handler (`kind` form field, `file`/`upload` alias). Adjust the test to whatever the handler declares.

- [ ] **Step 2: Run test to verify it fails**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest tests/test_passport_upload_hook.py -v`
Expected: FAIL — passport_no stays None.

- [ ] **Step 3: Add the hook**

In `backend/app/api/v1/employees.py`, in the vault upload handler, after the
successful `vault_service.save_upload(...)` call and before returning, add:

```python
    if kind == "passport":
        # Best-effort: fill passport_no from a validated MRZ. Never fail the
        # upload if OCR is unavailable or the scan is unreadable.
        try:
            result = passport_ocr_service.extract_passport_for_employee(db, employee_id)
            emp = db.get(Employee, employee_id)
            if result is not None and emp is not None:
                passport_ocr_service.apply_passport_extraction(db, emp, result)
        except Exception:  # noqa: BLE001 — hook must never break uploads
            log.warning("passport auto-extract failed for %s", employee_id, exc_info=True)
```

> Ensure `Employee`, `db`, `log`, `passport_ocr_service`, and the handler's `kind`/`employee_id` variables are in scope — reuse existing imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest tests/test_passport_upload_hook.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/employees.py backend/tests/test_passport_upload_hook.py
git commit -m "feat(employees): auto-extract passport number on passport vault upload"
```

---

### Task 7: Backfill script

**Files:**
- Create: `backend/scripts/backfill_passport_no.py`
- Test: `backend/tests/test_backfill_passport_no.py`

**Interfaces:**
- Consumes: `passport_ocr_service`; `Employee` model; a DB session factory.
- Produces: `run_backfill(db, *, apply: bool) -> dict` with keys `filled: list[str]`, `needs_review: list[str]`, `no_scan: list[str]`. CLI wrapper with `--apply` (default dry-run) + DB backup on apply.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_backfill_passport_no.py
from app.db.models import Employee
from app.services import passport_ocr_service as svc
from scripts.backfill_passport_no import run_backfill


def test_dry_run_writes_nothing_but_reports(db_session, monkeypatch):
    a = Employee(id="G6001", name_en="A", status="Active")
    b = Employee(id="G6002", name_en="B", status="Active")
    db_session.add_all([a, b])
    db_session.commit()

    def fake_extract(db, g):
        if g == "G6001":
            return svc.PassportExtractResult("N1234567", 0.95, "mrz", None, "pp.pdf")
        return None  # G6002: no scan

    monkeypatch.setattr(svc, "extract_passport_for_employee", fake_extract)
    report = run_backfill(db_session, apply=False)
    assert "G6001" in report["filled"]
    assert "G6002" in report["no_scan"]
    db_session.refresh(a)
    assert a.passport_no is None  # dry-run: nothing written


def test_apply_writes_mrz(db_session, monkeypatch):
    a = Employee(id="G6003", name_en="A", status="Active")
    db_session.add(a)
    db_session.commit()
    monkeypatch.setattr(
        svc, "extract_passport_for_employee",
        lambda db, g: svc.PassportExtractResult("N7654321", 0.95, "mrz", None, "pp.pdf"))
    run_backfill(db_session, apply=True)
    db_session.refresh(a)
    assert a.passport_no == "N7654321"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest tests/test_backfill_passport_no.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the script**

```python
# backend/scripts/backfill_passport_no.py
"""Backfill Employee.passport_no by OCR'ing stored passport scans.

Dry-run by default. Auto-writes only validated-MRZ numbers into empty fields
(see passport_ocr_service). Prints filled / needs_review / no_scan buckets.

Usage:
    python -m scripts.backfill_passport_no            # dry-run
    python -m scripts.backfill_passport_no --apply    # write + DB backup
"""

from __future__ import annotations

import argparse
import shutil
import sys
from datetime import datetime

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import Employee
from app.db.session import SessionLocal
from app.services import passport_ocr_service as svc


def run_backfill(db: Session, *, apply: bool) -> dict[str, list[str]]:
    report: dict[str, list[str]] = {"filled": [], "needs_review": [], "no_scan": []}
    for emp in db.query(Employee).order_by(Employee.id).all():
        result = svc.extract_passport_for_employee(db, emp.id)
        if result is None:
            report["no_scan"].append(emp.id)
            continue
        if result.method == "mrz" and result.number and result.confidence >= svc.MRZ_AUTOWRITE_CONFIDENCE:
            if apply and not emp.passport_no:
                svc.apply_passport_extraction(db, emp, result)
            report["filled"].append(emp.id)
        else:
            report["needs_review"].append(emp.id)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill passport numbers via OCR.")
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    args = parser.parse_args()

    if args.apply:
        db_path = get_settings().db_path
        backup = db_path.with_suffix(db_path.suffix + f".bak-passport-{int(datetime.now().timestamp())}")
        shutil.copy2(db_path, backup)
        print(f"DB backed up -> {backup}")

    with SessionLocal() as db:
        report = run_backfill(db, apply=args.apply)

    mode = "APPLIED" if args.apply else "DRY-RUN"
    print(f"\n=== Passport backfill ({mode}) ===")
    print(f"  filled (auto-written MRZ): {len(report['filled'])}")
    print(f"  needs review (scan, no confident number): {len(report['needs_review'])}")
    print(f"  no scan on file: {len(report['no_scan'])}")
    if report["needs_review"]:
        print("\n  NEEDS REVIEW (enter manually from the profile):")
        print("  " + ", ".join(report["needs_review"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest tests/test_backfill_passport_no.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/backfill_passport_no.py backend/tests/test_backfill_passport_no.py
git commit -m "feat(scripts): passport-number OCR backfill (dry-run default + report)"
```

---

### Task 8: Frontend — profile passport field, badge, "Read from scan"

**Files:**
- Modify: `frontend/src/lib/api.types.ts`, `frontend/src/lib/api.ts`
- Modify: the employee profile detail component (locate in Step 1)
- Modify: the i18n locale files (locate in Step 1)
- Test: a vitest test beside the profile component

**Interfaces:**
- Consumes: `POST /employees/{id}/passport/extract` → `{ number, confidence, method, source_snippet, scan_filename }`; `EmployeeRead.passport_no`, `passport_no_source`, `has_passport_scan`; `PATCH /employees/{id}` with `{ passport_no }`.
- Produces: a passport row on the profile with a status badge + manual field + a "Read from scan" action.

- [ ] **Step 1: Locate the surfaces**

Run (from repo root):
```bash
rg -l "passport_no|EmployeeRead|employees\.edit" frontend/src --glob '*.tsx' | head
rg -l "\"employees\"|profile|EmployeeDetail|EmployeeProfile" frontend/src/pages/employees frontend/src/components/employees 2>/dev/null | head
ls frontend/src/locales 2>/dev/null || rg -l "application\\.|common\\." frontend/src --glob '*.json' | head
```
Record the profile component path and the locale file layout. Confirm whether `api.types.ts` is generated (`/sync-api-types`) — if so, regenerate rather than hand-editing.

- [ ] **Step 2: Regenerate / add API types + client method**

If `api.types.ts` is generated: run `/sync-api-types` (or `scripts/build.ps1`) so the new endpoint + `passport_no_source`/`has_passport_scan` fields appear, and commit the regenerated file. Then add to `frontend/src/lib/api.ts`:

```ts
export interface PassportSuggestion {
  number: string | null
  confidence: number
  method: string
  source_snippet: string | null
  scan_filename: string | null
}

export const api = {
  // ...existing...
  extractPassport: (employeeId: string) =>
    request<PassportSuggestion>(`/employees/${employeeId}/passport/extract`, { method: 'POST' }),
}
```

> Match the file's existing `request`/fetch helper and export style — don't introduce a second HTTP pattern.

- [ ] **Step 3: Write the failing component test**

```tsx
// beside the profile component, e.g. PassportField.test.tsx
import { render, screen } from '@testing-library/react'
import { PassportField } from './PassportField'

test('shows Missing when no value and no scan', () => {
  render(<PassportField employeeId="G1" passportNo={null} source={null} hasScan={false} />)
  expect(screen.getByText(/missing/i)).toBeInTheDocument()
})

test('shows Needs review when scan exists but no value', () => {
  render(<PassportField employeeId="G1" passportNo={null} source={null} hasScan={true} />)
  expect(screen.getByText(/needs review/i)).toBeInTheDocument()
})

test('shows Verified when value present', () => {
  render(<PassportField employeeId="G1" passportNo="N123" source="mrz" hasScan={true} />)
  expect(screen.getByText(/verified/i)).toBeInTheDocument()
})
```

- [ ] **Step 4: Run test to verify it fails**

Run (from `frontend/`): `pnpm vitest run src/**/PassportField.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 5: Implement the `PassportField` component**

Create `PassportField.tsx` beside the profile component:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'

interface Props {
  employeeId: string
  passportNo: string | null
  source: string | null
  hasScan: boolean
}

type BadgeKind = 'verified' | 'review' | 'missing'

function badgeOf(passportNo: string | null, hasScan: boolean): BadgeKind {
  if (passportNo) return 'verified'
  return hasScan ? 'review' : 'missing'
}

export function PassportField({ employeeId, passportNo, source, hasScan }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [value, setValue] = useState(passportNo ?? '')
  const [busy, setBusy] = useState(false)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const kind = badgeOf(value || null, hasScan)

  async function readFromScan(): Promise<void> {
    setBusy(true)
    try {
      const s = await api.extractPassport(employeeId)
      setSuggestion(s.number)
    } finally {
      setBusy(false)
    }
  }

  async function save(next: string): Promise<void> {
    setValue(next)
    await api.updateEmployee(employeeId, { passport_no: next })
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor="passport_no">{t('employees.passport.label', { defaultValue: 'Passport No.' })}</label>
        <span data-badge={kind} className="rounded px-1.5 text-xs">
          {t(`employees.passport.badge.${kind}`, {
            defaultValue: { verified: 'Verified', review: 'Needs review', missing: 'Missing' }[kind],
          })}
        </span>
      </div>
      <input
        id="passport_no"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value !== (passportNo ?? '') && void save(value)}
      />
      {hasScan && (
        <button type="button" onClick={() => void readFromScan()} disabled={busy}>
          {t('employees.passport.readFromScan', { defaultValue: 'Read from scan' })}
        </button>
      )}
      {suggestion && (
        <div role="group">
          <span>{t('employees.passport.suggested', { defaultValue: 'Suggested' })}: {suggestion}</span>
          <button type="button" onClick={() => { void save(suggestion); setSuggestion(null) }}>
            {t('common.confirm', { defaultValue: 'Confirm' })}
          </button>
          <button type="button" onClick={() => setSuggestion(null)}>
            {t('common.dismiss', { defaultValue: 'Dismiss' })}
          </button>
        </div>
      )}
    </div>
  )
}
```

> Integrate into the existing profile layout (Step 1 path) and match its styling/utility classes. Gate the input/save behind the same `employees.edit` capability guard the profile already uses for editable fields.

- [ ] **Step 6: Add EN + AR i18n strings**

In the located locale files add (English shown; provide the Arabic file equivalents):

```json
{
  "employees": {
    "passport": {
      "label": "Passport No.",
      "readFromScan": "Read from scan",
      "suggested": "Suggested",
      "badge": { "verified": "Verified", "review": "Needs review", "missing": "Missing" }
    }
  }
}
```

Arabic (`ar`): `label`: "رقم الجواز", `readFromScan`: "قراءة من المسح", `suggested`: "مقترح", `badge`: { `verified`: "مُوثّق", `review`: "بحاجة لمراجعة", `missing`: "غير متوفر" }.

- [ ] **Step 7: Run tests + typecheck**

Run (from `frontend/`): `pnpm vitest run src/**/PassportField.test.tsx` → PASS; `pnpm tsc -b` → 0 errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src
git commit -m "feat(employees): passport field with OCR read-from-scan + status badge (EN/AR)"
```

---

### Task 9: Full-suite verification + finish

- [ ] **Step 1: Backend suite**

Run (from `backend/`): `/c/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest -q`
Expected: all pass (baseline was 183; this adds ~20).

- [ ] **Step 2: Frontend suite + build**

Run (from `frontend/`): `pnpm vitest run` and `pnpm tsc -b` → all green.

- [ ] **Step 3: Invoke `superpowers:requesting-code-review`, then finish the branch**

Use `superpowers:finishing-a-development-branch` to decide merge/PR. Deploy is a separate `/deploy` after merge to `main`; then run the backfill:
```
python -m scripts.backfill_passport_no          # review report
python -m scripts.backfill_passport_no --apply  # write
```

---

## Notes for the implementer

- `db_session` / `client` / auth fixtures: confirm exact names in `backend/tests/conftest.py` and adjust the tests. The plan assumes a transactional `db_session` and a `TestClient` `client` with capability auth helpers already used by existing employee tests.
- Migration head is `0045_leave_dedupe_index`; if another migration lands first, update `down_revision`.
- The `mrz` package must be installed in the service venv for MRZ auto-writes; if absent, `extract_passport` returns `None` and everything routes to printed/manual (still correct, fewer auto-writes).
