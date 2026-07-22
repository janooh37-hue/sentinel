# Permit → 1/5 General Book with mulkiya + ID OCR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate an official Arabic 1/5 General Book (security permit) from a permit record, with vehicle-licence + Emirates-ID OCR pre-fill and a manager signature; the generated PDF is the printed permit.

**Architecture:** Extend the existing `permits` feature. New vehicle columns + `permit.book_id`/`manager_id`. A pure Arabic letter builder (`core/permit_letter.py`) and a mulkiya OCR parser (`core/extraction/vehicle_licence.py`). A shared `regenerate_permit_book()` in `permit_service` calls the existing `document_service.generate_document(template_id="General Book", classification_code="5/1", …)` on create and on every roster/header change. Two thin scan endpoints pre-fill the form; nothing is written hands-off.

**Tech Stack:** FastAPI · SQLAlchemy (SQLite) · Alembic (batch alter) · Pydantic v2 · Tesseract (`ara+eng`) via `core/extraction/ocr.py` · React 19 / Vite / TS · React Query · Radix + Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-07-22-permit-general-book-design.md`
**Mockup:** `docs/permit-general-book-mockup.html`

## Global Constraints

- **Live main:** work stays on branch `worktree-permit-general-book`; do not commit to `main`.
- **Backend tests:** `venv/Scripts/python.exe -m pytest <path>` run from the worktree root. Lint/type gates are real: `venv/Scripts/ruff.exe check .`, `venv/Scripts/mypy.exe` (strict), `pytest` runs with `filterwarnings=error`.
- **Frontend:** `pnpm -C frontend exec vitest run <file>`, `pnpm -C frontend exec tsc -b --noEmit`, `pnpm -C frontend run lint`.
- **API contract is generated:** after any backend schema/route change, resync types (the `/sync-api-types` skill: dump `backend/openapi.json`, `pnpm gen:api`, typecheck) and commit `openapi.json` + `frontend/src/lib/api.types.ts` together. (Permit types are currently hand-declared in `frontend/src/lib/api.ts` — follow that existing pattern for permit shapes; see Task 8.)
- **Migrations:** hand-numbered `NNNN_slug`, single linear head, SQLite → `op.batch_alter_table`, no named FKs to existing tables, nullable columns need no `server_default`. Current head: **`0062`**.
- **Bilingual is first-class.** New UI strings need `en` + `ar` parity; the letter copy is Arabic. Run `i18n-rtl-reviewer` + `notification-template-reviewer` after Task 13.
- **Zone colours everywhere:** `green→green`, `red→red`, `work_residence→blue`.
- **Arabic letter rules (verbatim from spec):** terminology «الفرد/الأفراد» (never «الموظف»); person count 1 vs ≥2; vehicle clause **and** الجدول الثاني table dropped when zero vehicles; possessive ـه/ـهم follows person count, المركبة/المركبات follows vehicle count; zone phrase built from selected zones joined with «و».

**Preflight (once, before Task 1):** From the worktree root run `venv/Scripts/python.exe -m pytest backend/tests/test_dav.py -q` (any fast existing test) to confirm the venv resolves the *worktree* `backend` (pytest `pythonpath`/`conftest` uses cwd). Confirm green baseline before starting.

---

## Task 1: DB columns — vehicle mulkiya fields + permit.book_id/manager_id

**Files:**
- Modify: `backend/app/db/models.py` (class `PermitVehicle` ~lines 511-537; class `Permit` ~lines 421-481)
- Create: `backend/app/db/migrations/versions/0063_permit_mulkiya_book.py`
- Test: `backend/tests/test_permit_mulkiya_model.py`

**Interfaces:**
- Produces: `PermitVehicle.colour/vehicle_type/plate_category/traffic_no: str|None`, `PermitVehicle.reg_expiry: date|None`; `Permit.book_id: int|None`, `Permit.manager_id: int|None`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_permit_mulkiya_model.py
from datetime import date
from app.db.models import Permit, PermitVehicle

def test_vehicle_has_mulkiya_columns(db_session):
    p = Permit(company="ACME", zones=["green"], start_date=date(2026,7,22), end_date=date(2026,8,1), status="active")
    p.vehicles.append(PermitVehicle(
        plate_no="A 12345", plate_emirate="Dubai", make_model="Toyota Camry",
        colour="White", vehicle_type="Sedan", plate_category="Private",
        traffic_no="12345678", reg_expiry=date(2027,3,14),
    ))
    p.manager_id = 1
    db_session.add(p); db_session.commit(); db_session.refresh(p)
    v = p.vehicles[0]
    assert (v.colour, v.vehicle_type, v.plate_category, v.traffic_no) == ("White","Sedan","Private","12345678")
    assert v.reg_expiry == date(2027,3,14)
    assert p.book_id is None and p.manager_id == 1
```

Use the same `db_session` fixture the existing permit tests use (see `backend/tests/test_security_permits.py` or `conftest.py`). If none, copy that fixture's import.

- [ ] **Step 2: Run it, expect FAIL** — `venv/Scripts/python.exe -m pytest backend/tests/test_permit_mulkiya_model.py -q` → fails: `PermitVehicle` has no attribute `colour` (or column error).

- [ ] **Step 3: Add columns to models.py**

In `class PermitVehicle` add (match the surrounding `Mapped[...] = mapped_column(...)` style):

```python
    colour: Mapped[str | None] = mapped_column(String(32))
    vehicle_type: Mapped[str | None] = mapped_column(String(64))
    plate_category: Mapped[str | None] = mapped_column(String(32))
    traffic_no: Mapped[str | None] = mapped_column(String(32))
    reg_expiry: Mapped[date | None] = mapped_column(Date)
```

In `class Permit` add:

```python
    book_id: Mapped[int | None] = mapped_column(Integer)
    manager_id: Mapped[int | None] = mapped_column(Integer)
```

Ensure `Date`/`Integer` are imported at the top of `models.py` (they already are — verify).

- [ ] **Step 4: Create migration `0063_permit_mulkiya_book.py`**

```python
"""permits: mulkiya vehicle fields + permit.book_id/manager_id.

Revision ID: 0063
Revises: 0062
Create Date: 2026-07-22
"""
from __future__ import annotations
from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op

revision: str = "0063"
down_revision: str | Sequence[str] | None = "0062"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("permit_vehicles") as batch:
        batch.add_column(sa.Column("colour", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("vehicle_type", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("plate_category", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("traffic_no", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("reg_expiry", sa.Date(), nullable=True))
    with op.batch_alter_table("permits") as batch:
        batch.add_column(sa.Column("book_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("manager_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("permits") as batch:
        batch.drop_column("manager_id")
        batch.drop_column("book_id")
    with op.batch_alter_table("permit_vehicles") as batch:
        batch.drop_column("reg_expiry")
        batch.drop_column("traffic_no")
        batch.drop_column("plate_category")
        batch.drop_column("vehicle_type")
        batch.drop_column("colour")
```

- [ ] **Step 5: Apply migration + run test** — `venv/Scripts/alembic.exe upgrade head` then Step 2's command → PASS. Also `venv/Scripts/alembic.exe heads` shows a single head `0063`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/db/models.py backend/app/db/migrations/versions/0063_permit_mulkiya_book.py backend/tests/test_permit_mulkiya_model.py
git commit -m "feat(permits): mulkiya vehicle columns + permit.book_id/manager_id (0063)"
```

---

## Task 2: Schemas — vehicle fields, manager_id, book ref, scan responses

**Files:**
- Modify: `backend/app/schemas/permit.py`
- Test: `backend/tests/test_permit_schemas.py`

**Interfaces:**
- Produces: `PermitVehicleCreate`/`PermitVehicleRead` gain `colour, vehicle_type, plate_category, traffic_no: str|None`, `reg_expiry: date|None`. `PermitCreate.manager_id: int|None`. `PermitRead.manager_id: int|None`, `PermitRead.book_id: int|None`, `PermitRead.book_ref: str|None`. New `VehicleLicenceScan`, `PersonIdScan`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_permit_schemas.py
from datetime import date
from app.schemas.permit import PermitVehicleCreate, PermitCreate, VehicleLicenceScan, PersonIdScan

def test_vehicle_create_accepts_mulkiya_fields():
    v = PermitVehicleCreate(plate_no="A 1", colour="White", vehicle_type="Sedan",
                            plate_category="Private", traffic_no="123", reg_expiry=date(2027,1,1))
    assert v.colour == "White" and v.reg_expiry == date(2027,1,1)

def test_permit_create_accepts_manager_id():
    p = PermitCreate(company="ACME", zones=["green"], start_date=date(2026,7,1),
                     end_date=date(2026,7,2), people=[{"name":"X","uae_id":"1"}], manager_id=3)
    assert p.manager_id == 3

def test_scan_response_shapes():
    assert VehicleLicenceScan(colour="White").colour == "White"
    assert PersonIdScan(name="X", uae_id="1").uae_id == "1"
```

- [ ] **Step 2: Run it, expect FAIL** — unexpected-keyword / import errors.

- [ ] **Step 3: Edit `permit.py`**

Add the five fields to **both** `PermitVehicleCreate` (after `driver_name`) and `PermitVehicleRead` (after `driver_name`):

```python
    colour: str | None = Field(default=None, max_length=32)
    vehicle_type: str | None = Field(default=None, max_length=64)
    plate_category: str | None = Field(default=None, max_length=32)
    traffic_no: str | None = Field(default=None, max_length=32)
    reg_expiry: date | None = None
```

Add to `PermitCreate` (after `vehicles`):

```python
    manager_id: int | None = None
```

Add to `PermitRead` (after `notes`/computed block — near `document_name`):

```python
    manager_id: int | None = None
    book_id: int | None = None
    book_ref: str | None = None
```

Append the two scan schemas at end of file:

```python
class VehicleLicenceScan(BaseModel):
    """OCR pre-fill result for a vehicle licence (mulkiya). All optional; the
    operator confirms/edits every field before saving."""
    plate_no: str | None = None
    plate_emirate: str | None = None
    plate_category: str | None = None
    traffic_no: str | None = None
    make_model: str | None = None
    vehicle_type: str | None = None
    colour: str | None = None
    reg_expiry: date | None = None
    driver_name: str | None = None


class PersonIdScan(BaseModel):
    """OCR pre-fill result for an Emirates ID."""
    name: str | None = None
    uae_id: str | None = None
    nationality: str | None = None
```

- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(permits): schema fields for mulkiya, manager, book ref + scan responses"`

---

## Task 3: Mulkiya OCR parser

**Files:**
- Create: `backend/app/core/extraction/vehicle_licence.py`
- Test: `backend/tests/test_vehicle_licence_ocr.py`

**Interfaces:**
- Produces: `extract_vehicle_licence(text: str) -> dict[str, str]` — keys among `plate_no, plate_emirate, plate_category, traffic_no, make_model, vehicle_type, colour, reg_expiry` (ISO date), `owner_name`. Mirrors `emirates_id.extract_emirates_id`'s "text in" contract so the service reuses `_ocr_text(bytes)`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_vehicle_licence_ocr.py
from app.core.extraction.vehicle_licence import extract_vehicle_licence

SAMPLE = """
United Arab Emirates  Ministry of Interior
Vehicle Registration Card
Owner: MOHAMMED AL FARSI
Nationality: Egypt
Place of Issue: Dubai
Traffic Plate No: A 45213
Plate Category: Private
T.C. No: 12345678
Model: Toyota Camry
Type: Sedan
Colour: White
Expiry Date: 14/03/2027
"""

def test_extracts_core_fields():
    f = extract_vehicle_licence(SAMPLE)
    assert f["plate_no"] == "A 45213"
    assert f["plate_emirate"] == "Dubai"
    assert f["plate_category"] == "Private"
    assert f["traffic_no"] == "12345678"
    assert f["make_model"] == "Toyota Camry"
    assert f["vehicle_type"] == "Sedan"
    assert f["colour"] == "White"
    assert f["reg_expiry"] == "2027-03-14"

def test_empty_text_returns_empty_dict():
    assert extract_vehicle_licence("") == {}
```

- [ ] **Step 2: Run it, expect FAIL** (module missing).

- [ ] **Step 3: Implement `vehicle_licence.py`**

```python
"""Best-effort parser for a UAE vehicle licence (mulkiya).

ponytail: label-anchored regex over OCR'd `ara+eng` text — no ML. Real scans
vary by emirate and OCR is noisy, so this is an *assist*: the operator confirms
every field in the form. Upgrade path: OpenCV field-crop + per-field OCR.
"""
from __future__ import annotations

import re

from app.core.extraction.dates import parse_date

# (label variants) : (dict key, post-processor)
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?i)(?:traffic\s+)?plate\s*(?:no\.?|number)\s*[:\-]?\s*([A-Z]{0,3}\s?\d{1,6})"), "plate_no"),
    (re.compile(r"(?i)(?:place\s+of\s+issue|emirate|source)\s*[:\-]?\s*([A-Za-z ]{3,20})"), "plate_emirate"),
    (re.compile(r"(?i)(?:plate\s+)?(?:category|class)\s*[:\-]?\s*([A-Za-z ]{3,20})"), "plate_category"),
    (re.compile(r"(?i)T\.?C\.?\s*(?:no\.?|number)?\s*[:\-]?\s*(\d{4,10})"), "traffic_no"),
    (re.compile(r"(?i)(?:model|make)\s*[:\-]?\s*([A-Za-z0-9 .\-]{2,40})"), "make_model"),
    (re.compile(r"(?i)type\s*[:\-]?\s*([A-Za-z ]{3,20})"), "vehicle_type"),
    (re.compile(r"(?i)colou?r\s*[:\-]?\s*([A-Za-z ]{3,20})"), "colour"),
    (re.compile(r"(?i)owner\s*[:\-]?\s*([A-Za-z][A-Za-z .'\-]{2,60})"), "owner_name"),
]
_EXPIRY_RE = re.compile(r"(?i)(?:reg\.?\s*)?(?:expiry|exp)\s*(?:date)?\s*[:\-]?\s*(\d{2}[/-]\d{2}[/-]\d{4})")


def extract_vehicle_licence(text: str) -> dict[str, str]:
    if not text or not text.strip():
        return {}
    out: dict[str, str] = {}
    for rx, key in _PATTERNS:
        m = rx.search(text)
        if m:
            out[key] = m.group(1).strip()
    m = _EXPIRY_RE.search(text)
    if m:
        d = parse_date(m.group(1))
        if d:
            out["reg_expiry"] = d.isoformat()
    return out
```

- [ ] **Step 4: Run it, expect PASS.** If `parse_date` import path differs, confirm against `emirates_id.py` line 5 (`from app.core.extraction.dates import parse_date`).
- [ ] **Step 5: Commit** — `git commit -am "feat(permits): mulkiya vehicle-licence OCR parser"`

---

## Task 4: Arabic permit-letter builder (pure)

**Files:**
- Create: `backend/app/core/permit_letter.py`
- Test: `backend/tests/test_permit_letter.py`

**Interfaces:**
- Produces:
  - `ZONE_AR: dict[str, str]`
  - `zones_phrase(zones: list[str]) -> str`
  - `build_permit_letter_html(*, company: str, zones: list[str], start_date, end_date, people: list[dict], vehicles: list[dict]) -> str`
  - `people` dicts: `{name, uae_id, nationality}`; `vehicles` dicts: `{plate_no, plate_emirate, plate_category, traffic_no, make_model, colour, reg_expiry}`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_permit_letter.py
from datetime import date
from app.core.permit_letter import build_permit_letter_html, zones_phrase

P1 = [{"name": "Ali", "uae_id": "784-1", "nationality": "مصر"}]
P2 = P1 + [{"name": "Rakesh", "uae_id": "784-2", "nationality": "الهند"}]
V1 = [{"plate_no": "A 1", "plate_emirate": "دبي", "plate_category": "خصوصي",
       "traffic_no": "123", "make_model": "Toyota", "colour": "أبيض", "reg_expiry": "2027-03-14"}]

def test_zone_phrase_join():
    assert zones_phrase(["green"]) == "المنطقة الخضراء"
    assert zones_phrase(["green", "work_residence"]) == "المنطقة الخضراء وسكن الموظفين"

def test_single_person_single_vehicle():
    html = build_permit_letter_html(company="ACME", zones=["green"], start_date=date(2026,7,1),
                                    end_date=date(2026,7,2), people=P1, vehicles=V1)
    assert "للفرد المبيّن" in html and "بحوزته المركبة" in html and "يتسنّى له القيام بعمله" in html
    assert "الجدول الثاني" in html and "A 1" in html

def test_many_persons_many_vehicles():
    html = build_permit_letter_html(company="ACME", zones=["green"], start_date=date(2026,7,1),
                                    end_date=date(2026,7,2), people=P2, vehicles=V1+V1)
    assert "للأفراد المبيّنين" in html and "بحوزتهم المركبات" in html and "يتسنّى لهم القيام بعملهم" in html

def test_no_vehicles_drops_clause_and_table():
    html = build_permit_letter_html(company="ACME", zones=["green"], start_date=date(2026,7,1),
                                    end_date=date(2026,7,2), people=P2, vehicles=[])
    assert "المركبة" not in html and "المركبات" not in html
    assert "الجدول الثاني" not in html
    assert "للأفراد المبيّنين" in html

def test_uses_individual_not_employee_term():
    html = build_permit_letter_html(company="ACME", zones=["green"], start_date=date(2026,7,1),
                                    end_date=date(2026,7,2), people=P1, vehicles=[])
    assert "الموظف" not in html   # generic template: individuals, not employees
```

- [ ] **Step 2: Run it, expect FAIL** (module missing).

- [ ] **Step 3: Implement `permit_letter.py`**

```python
"""Builds the Arabic RTL body HTML for the 1/5 security-permit General Book.

Count-aware (1 vs ≥2), generic «الفرد/الأفراد» terminology, zone phrase from the
selected zones, and the vehicle clause + الجدول الثاني table dropped when there
are no vehicles. Pure + unit-tested — no DB, no I/O.
"""
from __future__ import annotations

from datetime import date
from html import escape

ZONE_AR: dict[str, str] = {
    "green": "المنطقة الخضراء",
    "red": "المنطقة الحمراء",
    "work_residence": "سكن الموظفين",
}


def zones_phrase(zones: list[str]) -> str:
    parts = [ZONE_AR.get(z, z) for z in zones]
    return " و".join(parts)  # Arabic conjunction "و" prefixes the next word


def _fmt(d: date | str) -> str:
    if isinstance(d, date):
        return d.strftime("%Y/%m/%d")
    return str(d).replace("-", "/")


def _people_table(people: list[dict]) -> str:
    rows = "".join(
        f"<tr><td>{i}</td><td>{escape(p.get('name') or '')}</td>"
        f"<td>{escape(p.get('uae_id') or '')}</td><td>{escape(p.get('nationality') or '')}</td></tr>"
        for i, p in enumerate(people, 1)
    )
    return (
        '<p><b>الجدول الأول: بيانات الأفراد</b></p>'
        '<table border="1" cellspacing="0" cellpadding="4"><thead><tr>'
        "<th>م</th><th>الاسم</th><th>رقم الهوية</th><th>الجنسية</th>"
        f"</tr></thead><tbody>{rows}</tbody></table>"
    )


def _vehicle_table(vehicles: list[dict]) -> str:
    rows = "".join(
        "<tr>"
        f"<td>{escape(v.get('plate_no') or '')}</td><td>{escape(v.get('plate_emirate') or '')}</td>"
        f"<td>{escape(v.get('plate_category') or '')}</td><td>{escape(v.get('traffic_no') or '')}</td>"
        f"<td>{escape(v.get('make_model') or '')}</td><td>{escape(v.get('colour') or '')}</td>"
        f"<td>{_fmt(v.get('reg_expiry') or '')}</td></tr>"
        for v in vehicles
    )
    return (
        '<p><b>الجدول الثاني: بيانات المركبات</b></p>'
        '<table border="1" cellspacing="0" cellpadding="4"><thead><tr>'
        "<th>اللوحة</th><th>الإمارة</th><th>الفئة</th><th>رقم المرور</th>"
        "<th>النوع/الموديل</th><th>اللون</th><th>انتهاء الرخصة</th>"
        f"</tr></thead><tbody>{rows}</tbody></table>"
    )


def build_permit_letter_html(
    *,
    company: str,
    zones: list[str],
    start_date: date,
    end_date: date,
    people: list[dict],
    vehicles: list[dict],
) -> str:
    many_people = len(people) >= 2
    has_vehicles = len(vehicles) > 0
    many_vehicles = len(vehicles) >= 2

    subject_person = "للأفراد المبيّنين" if many_people else "للفرد المبيّن"
    verb_tail = "يتسنّى لهم القيام بعملهم" if many_people else "يتسنّى له القيام بعمله"

    if has_vehicles:
        poss = "وبحوزتهم" if many_people else "وبحوزته"
        veh_word = "المركبات" if many_vehicles else "المركبة"
        vehicle_clause = f"، {poss} {veh_word} المنوّه عنها بالجدول الثاني"
    else:
        vehicle_clause = ""

    zone_ar = zones_phrase(zones)
    company_e = escape(company)

    para = (
        "<p>يطيب لنا أن نتقدم لسيادتكم بخالص التحية والتقدير، ويرجى من سيادتكم السماح "
        f"{subject_person} بالكشف أدناه بالدخول من البوابة الرئيسية إلى {zone_ar}"
        f"{vehicle_clause}، حتى {verb_tail} في الوقت المحدد.</p>"
    )
    facts = (
        f"<p><b>الجهة:</b> {company_e} · <b>صلاحية التصريح:</b> "
        f"من {_fmt(start_date)} إلى {_fmt(end_date)}</p>"
    )

    html = para + facts + _people_table(people)
    if has_vehicles:
        html += _vehicle_table(vehicles)
    return html
```

- [ ] **Step 4: Run it, expect PASS.** (Note: match the exact diacritic spelling in the asserts to the source — «المبيّن», «يتسنّى», «المنوّه» — copy/paste to avoid mismatches.)
- [ ] **Step 5: Commit** — `git commit -am "feat(permits): pure Arabic permit-letter HTML builder"`

---

## Task 5: `regenerate_permit_book` + service wiring

**Files:**
- Modify: `backend/app/services/permit_service.py`
- Test: `backend/tests/test_permit_book_generation.py`

**Interfaces:**
- Consumes: `core.permit_letter.build_permit_letter_html`, `core.extraction.vehicle_licence.extract_vehicle_licence`, `document_service.generate_document`.
- Produces: `regenerate_permit_book(db, permit, *, actor=None) -> None`; `scan_vehicle_licence(data: bytes) -> VehicleLicenceScan`; `scan_emirates_id(data: bytes) -> PersonIdScan`. `create_permit` now stores `manager_id` and generates the book; `to_read` exposes `book_id/book_ref/manager_id`; `_new_vehicle` sets the new columns; roster mutations re-generate.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_permit_book_generation.py
from datetime import date
from app.schemas.permit import PermitCreate
from app.services import permit_service
from app.db.models import Book

def _payload(**kw):
    base = dict(company="ACME", zones=["green"], start_date=date(2026,7,1), end_date=date(2026,8,1),
                people=[{"name":"Ali","uae_id":"784-1","nationality":"مصر"}], vehicles=[])
    base.update(kw); return PermitCreate(**base)

def test_create_permit_generates_1_5_book(db_session):
    permit = permit_service.create_permit(db_session, _payload())
    assert permit.book_id is not None
    book = db_session.get(Book, permit.book_id)
    assert book.classification_code == "5/1"
    assert book.ref_number.startswith("1/5/")

def test_roster_change_reversions_same_ref(db_session):
    permit = permit_service.create_permit(db_session, _payload())
    ref_before = db_session.get(Book, permit.book_id).ref_number
    permit_service.add_vehicle(db_session, permit.id,
        __import__("app.schemas.permit", fromlist=["PermitVehicleCreate"]).PermitVehicleCreate(plate_no="A 1"))
    assert db_session.get(Book, permit.book_id).ref_number == ref_before  # same ref, new version
```

If DOCX→PDF (Word COM) is unavailable in the test env, `generate_document` still commits the Book with `pdf_path` NULL — the asserts above don't depend on the PDF. Confirm the existing General Book tests run in this env (see `backend/tests/test_general_book_ref_line.py`); reuse their fixture/monkeypatch approach for PDF conversion.

- [ ] **Step 2: Run it, expect FAIL** (`permit.book_id is None`).

- [ ] **Step 3: Add `regenerate_permit_book` + wiring to `permit_service.py`**

Add near the top-level imports:

```python
from app.core.permit_letter import build_permit_letter_html
```

Add the function (place after `create_permit`):

```python
def _letter_dicts(row: Permit) -> tuple[list[dict], list[dict]]:
    people = [{"name": p.name, "uae_id": p.uae_id, "nationality": p.nationality}
              for p in _active_people(row)]
    vehicles = [{"plate_no": v.plate_no, "plate_emirate": v.plate_emirate,
                 "plate_category": v.plate_category, "traffic_no": v.traffic_no,
                 "make_model": v.make_model, "colour": v.colour, "reg_expiry": v.reg_expiry}
                for v in _active_vehicles(row)]
    return people, vehicles


def regenerate_permit_book(db: Session, permit: Permit, *, actor: str | None = None) -> None:
    """Generate (or re-version) the permit's 1/5 General Book from its current
    roster. Reuses document_service.generate_document — ref allocation, Arabic
    letterhead, manager signature, PDF. Resilient: a PDF failure still commits
    the Book (pdf_path NULL), same as the rest of the app.

    ponytail: re-renders docx->PDF on each roster change (Word COM). Fine for
    infrequent admin edits; switch to regenerate-on-print if throughput matters.
    """
    from app.services import document_service

    people, vehicles = _letter_dicts(permit)
    body = build_permit_letter_html(
        company=permit.company, zones=list(permit.zones),
        start_date=permit.start_date, end_date=permit.end_date,
        people=people, vehicles=vehicles,
    )
    subject = f"تصريح دخول أمني — {permit.company}"
    result = document_service.generate_document(
        db,
        employee_id=None,
        template_id="General Book",
        fields={"subject": subject, "body": body},
        classification_code="5/1",
        commit=True,
        manager_id=permit.manager_id,
        revise_of_book_id=permit.book_id,  # None on first gen → fresh 1/5 ref
        current_user=None,
    )
    if permit.book_id is None:
        permit.book_id = result.book_id
        db.commit()
    _audit(db, "permit.book_generated", permit.id, actor, {"book_id": permit.book_id})
```

**Wire it in.** In `create_permit`, set the manager and generate before returning:

```python
    row = Permit(
        company=payload.company,
        zones=list(payload.zones),
        start_date=payload.start_date,
        end_date=payload.end_date,
        purpose=payload.purpose,
        notes=payload.notes,
        status="active",
        manager_id=payload.manager_id,   # NEW
    )
    ...
    _audit(db, "permit.created", row.id, actor, {"company": row.company, "zones": list(row.zones)})
    regenerate_permit_book(db, row, actor=actor)   # NEW
    return get_permit(db, row.id)
```

In `update_permit`, `add_person`, `remove_person`, `add_vehicle`, `remove_vehicle`, `renew_permit`: immediately **before** each `return get_permit(...)`, add:

```python
    regenerate_permit_book(db, get_permit(db, permit_id), actor=actor)
```

Do **not** add it to `revoke_permit` or `soft_delete_permit` (a voided permit keeps its last-issued letter).

Extend `_new_vehicle`:

```python
def _new_vehicle(payload: PermitVehicleCreate) -> PermitVehicle:
    return PermitVehicle(
        plate_no=payload.plate_no,
        plate_emirate=payload.plate_emirate,
        make_model=payload.make_model,
        driver_name=payload.driver_name,
        colour=payload.colour,
        vehicle_type=payload.vehicle_type,
        plate_category=payload.plate_category,
        traffic_no=payload.traffic_no,
        reg_expiry=payload.reg_expiry,
    )
```

Extend `to_read` update-dict with book + manager fields (add to the `update={...}`):

```python
            "manager_id": row.manager_id,
            "book_id": row.book_id,
            "book_ref": (
                db.get(Book, row.book_id).ref_number
                if row.book_id and (b := db.get(Book, row.book_id)) is not None else None
            ),
```

`to_read` currently has signature `to_read(row, *, today=None)` — it needs the `db` session for `book_ref`. Change to `to_read(row, *, today=None, db=None)` and pass `db` from callers (they all have a session). Where `db is None`, skip the ref lookup (`book_ref=None`). Import `Book` in `permit_service.py` if not already. Update the endpoint(s) that call `to_read`/`get_permit` to pass `db` (see `api/v1/permits.py`).

`_vehicle_read` needs **no** change — the new schema fields auto-populate from the ORM via `model_validate`.

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Add scan helpers + extend `attach_vehicle_document`**

Append scan wrappers (reuse `_ocr_text`):

```python
def scan_vehicle_licence(data: bytes) -> "VehicleLicenceScan":
    from app.core.extraction.vehicle_licence import extract_vehicle_licence
    from app.schemas.permit import VehicleLicenceScan
    text = _ocr_text(data) or ""
    f = extract_vehicle_licence(text)
    owner = f.get("owner_name")
    return VehicleLicenceScan(
        plate_no=f.get("plate_no"), plate_emirate=f.get("plate_emirate"),
        plate_category=f.get("plate_category"), traffic_no=f.get("traffic_no"),
        make_model=f.get("make_model"), vehicle_type=f.get("vehicle_type"),
        colour=f.get("colour"), reg_expiry=f.get("reg_expiry"), driver_name=owner,
    )


def scan_emirates_id(data: bytes) -> "PersonIdScan":
    from app.core.extraction.emirates_id import extract_emirates_id
    from app.schemas.permit import PersonIdScan
    text = _ocr_text(data) or ""
    fields = {fl.key: fl.value for fl in extract_emirates_id(text).fields}
    return PersonIdScan(
        name=fields.get("name_en") or fields.get("name_ar"),
        uae_id=fields.get("uae_id_no"), nationality=fields.get("nationality"),
    )
```

In `attach_vehicle_document`, after the existing plate-fill block, also fill the empty mulkiya fields and regenerate if anything changed:

```python
    changed = bool(extracted)
    filled = scan_vehicle_licence(data)
    for attr in ("plate_emirate", "plate_category", "traffic_no", "make_model",
                 "vehicle_type", "colour", "reg_expiry"):
        if getattr(vehicle, attr) in (None, "") and getattr(filled, attr):
            setattr(vehicle, attr, getattr(filled, attr)); changed = True
    ...
    db.commit()
    if changed and row.book_id:
        regenerate_permit_book(db, get_permit(db, permit_id), actor=actor)
```

(Add `PersonIdScan`/`VehicleLicenceScan` to type-check imports as needed; the string annotations above avoid a hard import at module top.)

- [ ] **Step 6: Run backend suite for permits** — `venv/Scripts/python.exe -m pytest backend/tests/test_permit_book_generation.py backend/tests/test_security_permits.py -q` → PASS. Then `venv/Scripts/ruff.exe check backend/app` and `venv/Scripts/mypy.exe` clean.
- [ ] **Step 7: Commit** — `git commit -am "feat(permits): auto-generate/re-version 1/5 book on roster change + scan helpers"`

---

## Task 6: Scan endpoints + create manager_id + print wiring

**Files:**
- Modify: `backend/app/api/v1/permits.py`
- Test: `backend/tests/test_permit_scan_endpoints.py`

**Interfaces:**
- Produces: `POST /permits/scan-vehicle-licence` → `VehicleLicenceScan`; `POST /permits/scan-emirates-id` → `PersonIdScan`. `PermitRead` responses now carry `book_id/book_ref/manager_id`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_permit_scan_endpoints.py
def test_scan_vehicle_licence_returns_fields(client, permits_manager_auth, monkeypatch):
    monkeypatch.setattr("app.services.permit_service._ocr_text",
                        lambda data: "Traffic Plate No: A 45213\nColour: White\nExpiry Date: 14/03/2027")
    r = client.post("/api/v1/permits/scan-vehicle-licence",
                    files={"file": ("m.jpg", b"x", "image/jpeg")}, headers=permits_manager_auth)
    assert r.status_code == 200
    body = r.json()
    assert body["plate_no"] == "A 45213" and body["colour"] == "White" and body["reg_expiry"] == "2027-03-14"
```

Use the same auth fixture the existing permit endpoint tests use (`backend/tests/test_security_permits.py`) — capability `permits.manage`.

- [ ] **Step 2: Run it, expect FAIL** (404).

- [ ] **Step 3: Add the endpoints to `permits.py`**

Import the schemas and add (mirror the existing `upload_vehicle_document` handler's shape; gate with the same `permits.manage` capability dependency the other mutating routes use):

```python
from app.schemas.permit import VehicleLicenceScan, PersonIdScan

@router.post("/scan-vehicle-licence", response_model=VehicleLicenceScan)
async def scan_vehicle_licence(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("permits.manage"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> VehicleLicenceScan:
    return permit_service.scan_vehicle_licence(await upload.read())

@router.post("/scan-emirates-id", response_model=PersonIdScan)
async def scan_emirates_id(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("permits.manage"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> PersonIdScan:
    return permit_service.scan_emirates_id(await upload.read())
```

**Route ordering:** declare these BEFORE `GET /{permit_id}` so `scan-vehicle-licence` isn't captured as a `permit_id`. (FastAPI matches in declaration order.)

Confirm the create route passes the whole `PermitCreate` (incl. `manager_id`) to `permit_service.create_permit` — it already does; no change needed beyond the schema. Confirm the read serialization uses `to_read(row, db=db)` so `book_ref` is populated (update the call site).

- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(permits): scan-vehicle-licence + scan-emirates-id endpoints"`

---

## Task 7: Regenerate API types

**Files:**
- Modify: `backend/openapi.json`, `frontend/src/lib/api.types.ts`

- [ ] **Step 1:** Invoke the `/sync-api-types` skill (dump openapi, `pnpm -C frontend gen:api`, `pnpm -C frontend exec tsc -b --noEmit`).
- [ ] **Step 2:** Confirm the new permit schema shapes appear in `api.types.ts`.
- [ ] **Step 3: Commit** — `git add backend/openapi.json frontend/src/lib/api.types.ts && git commit -m "chore(permits): resync api types"`

---

## Task 8: Frontend — api client (types, scan fns, managers, print url)

**Files:**
- Modify: `frontend/src/lib/api.ts` (permit types block ~lines 162-274)
- Test: `frontend/src/lib/api.permits.test.ts` (or extend existing)

**Interfaces:**
- Produces: TS `PermitVehicleCreate`/`PermitVehicleRead` gain `colour, vehicle_type, plate_category, traffic_no, reg_expiry`; `PermitCreate.manager_id`; `PermitRead.manager_id/book_id/book_ref`; `VehicleLicenceScan`, `PersonIdScan` types; `api.scanVehicleLicence(file)`, `api.scanEmiratesId(file)`, `api.permitPrintUrl(book_id)`, and (if absent) `api.listManagers()`.

- [ ] **Step 1: Extend the hand-declared permit types** in `api.ts` to match Task 2's Pydantic shapes (add the five vehicle fields, `manager_id`, `book_id`, `book_ref`, and the two scan types).

- [ ] **Step 2: Add client functions** (follow the existing `uploadVehicleDocument` multipart pattern):

```ts
export async function scanVehicleLicence(file: File): Promise<VehicleLicenceScan> {
  const fd = new FormData(); fd.append("file", file);
  return http.post("/permits/scan-vehicle-licence", fd).then(r => r.data);
}
export async function scanEmiratesId(file: File): Promise<PersonIdScan> {
  const fd = new FormData(); fd.append("file", file);
  return http.post("/permits/scan-emirates-id", fd).then(r => r.data);
}
```

(Match the actual http helper/naming already used in `api.ts`.)

- [ ] **Step 3: Managers list** — check whether an `api.listManagers()` / `useManagers()` already exists (Manager management shipped). Reuse it. Only add a thin `GET /managers` fetch if none exists.

- [ ] **Step 4: Print URL** — find how the Books register opens a book PDF (grep `frontend/src` for the book document/download URL) and expose `api.permitPrintUrl(bookId)` pointing at that same served-PDF endpoint.

- [ ] **Step 5:** `pnpm -C frontend exec tsc -b --noEmit` clean. **Commit** — `git commit -am "feat(permits): api client for scans, new fields, book print url"`

---

## Task 9: Frontend — zone colours (work_residence = blue)

**Files:**
- Modify: `frontend/src/pages/permits/ZoneBadge.tsx`, `frontend/src/pages/permits/permitUtils.ts` (`zoneTone`)
- Test: `frontend/src/pages/permits/ZoneBadge.test.tsx`

- [ ] **Step 1: Failing test** — assert `work_residence` renders the blue/`info` tone (green→green, red→red unchanged):

```tsx
test("work_residence badge uses blue/info tone", () => {
  render(<ZoneBadge zones={["work_residence"]} />);
  expect(screen.getByText(/work res/i).className).toMatch(/info|blue/);
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `permitUtils.ts` `zoneTone()` map `work_residence -> "info"` (or the blue tone token the design system uses); ensure `ZoneBadge` applies it. Green/red already correct.
- [ ] **Step 4:** Run → PASS. **Commit** — `git commit -am "feat(permits): work_residence zone renders blue"`

---

## Task 10: Frontend — PermitFormDialog (manager, scans, new fields)

**Files:**
- Modify: `frontend/src/pages/permits/PermitFormDialog.tsx`
- Test: `frontend/src/pages/permits/PermitFormDialog.test.tsx`

**Interfaces:**
- Consumes: `api.scanVehicleLicence`, `api.scanEmiratesId`, `api.listManagers`.

- [ ] **Step 1: Failing test** — uploading a licence pre-fills the vehicle row:

```tsx
test("scanning a licence pre-fills vehicle fields (editable)", async () => {
  vi.spyOn(api, "scanVehicleLicence").mockResolvedValue({ plate_no: "A 1", colour: "White", reg_expiry: "2027-03-14" });
  renderForm();
  await userEvent.upload(screen.getByLabelText(/scan licence/i), new File(["x"], "m.jpg"));
  expect(await screen.findByDisplayValue("White")).toBeInTheDocument();  // colour input filled, editable
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Add to the form (create mode):
  - A **Signing manager** `<select>` bound to `manager_id`, options from `api.listManagers()` (label = manager name — title).
  - Per **person** row: a "Scan ID" file input → `api.scanEmiratesId(file)` → set `name/uae_id/nationality` on that row (all editable); keep the `File` to upload post-create via `api.uploadPersonDocument`.
  - Per **vehicle** row: a "Scan licence" file input → `api.scanVehicleLicence(file)` → set all vehicle fields; new inputs for `colour, vehicle_type, plate_category, traffic_no, reg_expiry` (use `<input type="date">` for `reg_expiry`); keep the `File` for post-create `api.uploadVehicleDocument`.
  - On submit: `create` returns the permit with `people[]`/`vehicles[]` ids; for each row that has a held scan file, upload it to the matching person/vehicle id (mirror the current permit-paper attach-on-create). Match rows to created ids by index/order.
- [ ] **Step 4:** Run → PASS; `tsc -b --noEmit` clean. **Commit** — `git commit -am "feat(permits): form manager picker + ID/licence scan pre-fill + new vehicle fields"`

---

## Task 11: Frontend — PermitDetailDialog + PermitsPage (fields, book ref, print)

**Files:**
- Modify: `frontend/src/pages/permits/PermitDetailDialog.tsx`, `frontend/src/pages/permits/PermitsPage.tsx`
- Test: extend `frontend/src/pages/permits/PermitDetailDialog.test.tsx`

- [ ] **Step 1: Failing test** — detail dialog shows the book ref + a Print action, and vehicle rows show the new fields:

```tsx
test("detail shows 1/5 ref and prints the book", async () => {
  renderDetail({ book_ref: "1/5/GSSG/0042", book_id: 7, vehicles: [{ id:1, plate_no:"A 1", colour:"White", reg_expiry:"2027-03-14" }] });
  expect(screen.getByText("1/5/GSSG/0042")).toBeInTheDocument();
  expect(screen.getByText("White")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /print permit/i })).toHaveAttribute("href", expect.stringContaining("7"));
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
  - Detail dialog: render new vehicle fields in the vehicle read view; add-vehicle/add-person inline forms get the scan buttons + new fields (same handlers as Task 10); show `book_ref` and a **"Print permit (1/5)"** link → `api.permitPrintUrl(book_id)` (open in new tab).
  - `PermitsPage`: the per-row/per-permit "Print" points at `api.permitPrintUrl(book_id)` (the generated book PDF). Leave the register CSV export and the bulk register print untouched.
- [ ] **Step 4:** Run → PASS; `tsc`/`lint` clean. **Commit** — `git commit -am "feat(permits): detail/list show mulkiya fields, book ref, print 1/5"`

---

## Task 12: i18n strings + bilingual review

**Files:**
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/locales/permits.i18n.test.ts`

- [ ] **Step 1: Failing test** — assert every new key exists in BOTH locales AND that the Arabic value is not the English fallback (per the recurring-leak rule):

```ts
import en from "./en.json"; import ar from "./ar.json";
const KEYS = ["permits.vehicle.colour","permits.vehicle.type","permits.vehicle.plateCategory",
  "permits.vehicle.trafficNo","permits.vehicle.regExpiry","permits.scanId","permits.scanLicence",
  "permits.signingManager","permits.printPermit"];
test("new permit keys have AR parity, not EN leak", () => {
  for (const k of KEYS) {
    const e = k.split(".").reduce((o,p)=>o?.[p], en as any);
    const a = k.split(".").reduce((o,p)=>o?.[p], ar as any);
    expect(e).toBeTruthy(); expect(a).toBeTruthy(); expect(a).not.toBe(e);
  }
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add the keys with real Arabic (Colour=اللون, Type=النوع, Plate category=فئة اللوحة, Traffic No.=رقم المرور, Reg. expiry=انتهاء الرخصة, Scan ID=مسح الهوية, Scan licence=مسح الرخصة, Signing manager=المدير الموقّع, Print permit=طباعة التصريح). Wire the form/detail labels through `t(...)`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Bilingual review** — run the `i18n-rtl-reviewer` and `notification-template-reviewer` agents over the diff; fix findings.
- [ ] **Step 6: Commit** — `git commit -am "i18n(permits): AR/EN strings for mulkiya fields, scans, print"`

---

## Task 13: Full-suite gate + finish

- [ ] **Step 1:** Backend — `venv/Scripts/python.exe -m pytest -q` all green; `venv/Scripts/ruff.exe check . && venv/Scripts/ruff.exe format --check .`; `venv/Scripts/mypy.exe` clean.
- [ ] **Step 2:** Frontend — `pnpm -C frontend exec vitest run`, `pnpm -C frontend run lint`, `pnpm -C frontend exec tsc -b --noEmit` all clean.
- [ ] **Step 3:** Use `superpowers:requesting-code-review`, then `superpowers:finishing-a-development-branch` to decide merge/PR. Note deploy needs `alembic upgrade head` on the server.

---

## Self-Review (author checklist — completed)

**Spec coverage:** vehicle columns (T1) · schemas + scan shapes (T2) · mulkiya parser (T3) · Arabic letter incl. count/zone/no-vehicle rules (T4) · auto-generate + re-version + attach-fill (T5) · scan endpoints + manager_id + book ref (T6) · type sync (T7) · api client (T8) · zone tri-colour (T9) · form manager+scan+fields (T10) · detail/list fields+ref+print (T11) · i18n parity (T12) · gates+finish (T13). Manager signature = handled by existing General Book pipeline via `manager_id` (verified: `_build_template_data` renders Arabic manager block for "General Book").

**Placeholder scan:** none — every code/test step carries real content.

**Type consistency:** `build_permit_letter_html(*, company, zones, start_date, end_date, people, vehicles)` and `regenerate_permit_book(db, permit, *, actor)` used identically across T4/T5; `VehicleLicenceScan`/`PersonIdScan` fields identical in T2/T5/T6/T8; `book_id`/`book_ref`/`manager_id` consistent T2→T11.

**Known verification points for the implementer:** (a) confirm `form_policy.signing_path_of("General Book") == "auto"` so the manager signature embeds (a book-generation test asserting `book.doc_manager_id` is set catches regressions); (b) confirm the test env's `generate_document` tolerates missing Word COM (PDF NULL) — mirror `test_general_book_ref_line.py`; (c) confirm the `permits.manage` capability name against `api/deps.py`.
