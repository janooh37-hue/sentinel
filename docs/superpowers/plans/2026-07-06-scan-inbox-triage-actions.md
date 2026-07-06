# Scan Inbox — Actionable Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Scan Inbox from a dead-end triage list into a workspace where the operator sees the scanned document, verifies what the OCR read, and files/re-files it in one place.

**Architecture:** Cards expand in place to show a document preview + the OCR-read fields; actions scale to the item's state. A shared `ScanMatchDialog` (scan on one side, employee/record search on the other) handles all manual matching via the existing `POST /scan-inbox/{id}/route`. The matcher gains a ranked top-N so unrouted items show one-tap candidate chips. Auto-filed cards state where the document landed, deep-link to it, and offer undo + re-match.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (backend), React + TypeScript + TanStack Query + react-i18next + Tailwind (frontend), pytest + vitest/RTL (tests). Fuzzy matching via `rapidfuzz`.

## Global Constraints

- **i18n parity is mandatory.** Every user-facing string is added to BOTH `frontend/src/locales/en.json` and `frontend/src/locales/ar.json` under `scanInbox`. English leaking into Arabic / missing key parity / broken RTL is the #1 recurring bug here — run the `i18n-rtl-reviewer` agent over the diff (Task 9).
- **Capability gate:** every scan-inbox endpoint is gated on `require_capability("documents.scan")`.
- **Owner isolation:** foreign items raise `NotFoundError` (404), never 403 — do not leak existence.
- **Candidate scoring scale:** `rapidfuzz` returns 0..100; existing `_MATCH_THRESHOLD = 70.0`. Candidate floor is `55.0` on that scale; stored/exposed candidate `score` is normalized to 0..1.
- **Candidate shape (used verbatim backend + frontend):** `{ employee_id: str, name_en: str, name_ar: str | None, score: float }` — employee-only (book near-misses are out of scope; a fuzzy book ref already surfaces as a `confirm`-tier proposal).
- **Live checkout = production `main`.** Commit each task; the branch is deployed by `mng update`. Don't push mid-plan unless asked.
- **TDD:** write the failing test first, watch it fail, implement minimally, watch it pass, commit.

Run backend tests from `backend/`: `venv\Scripts\python.exe -m pytest ...`. Run frontend tests from `frontend/`: `pnpm vitest run ...`.

---

## File structure

**Backend**
- `backend/app/services/extraction_service.py` — add `match_employee_candidates` + `_name_scores` helper; add `candidates` to `PipelineResult`. (Task 1)
- `backend/app/services/scan_triage_service.py` — add `candidates` to `TriageDecision`; attach on manual branches. (Task 2)
- `backend/app/db/models.py` — add `ScanInbox.candidates` JSON column. (Task 3)
- `backend/app/db/migrations/versions/0047_scan_inbox_candidates.py` — new migration. (Task 3)
- `backend/app/services/scan_inbox_service.py` — store `candidates` in `_process_one`; add `get_item` + `abs_file_path` accessors. (Tasks 4, 5)
- `backend/app/schemas/scan_inbox.py` — `EmployeeCandidate` model; add `fields` + `candidates` to `ScanInboxItem`. (Task 4)
- `backend/app/api/v1/scan_inbox.py` — map new fields in `_to_item`; add `GET /{id}/document`. (Tasks 4, 5)

**Frontend**
- `frontend/src/lib/api.ts` — `EmployeeCandidate` type; extend `ScanInboxItem`; add `scanDocumentUrl`. (Task 6)
- `frontend/src/pages/scanInbox/ScanMatchDialog.tsx` — new match dialog. (Task 7)
- `frontend/src/pages/scanInbox/ScanInboxCard.tsx` — rework (expand, preview, OCR panel, chips, per-state actions, auto-filed destination + re-match). (Task 8)
- `frontend/src/locales/{en,ar}.json` — new `scanInbox` keys. (Tasks 7–8 add keys as used; Task 9 audits parity.)

**Tests (new)**
- `backend/tests/test_match_candidates.py` (Task 1)
- `backend/tests/test_triage_candidates.py` (Task 2)
- `backend/tests/test_scan_inbox_document.py` (Tasks 4–5)
- `frontend/src/pages/scanInbox/ScanMatchDialog.test.tsx` (Task 7)
- `frontend/src/pages/scanInbox/ScanInboxCard.test.tsx` (Task 8)

---

## Task 1: Ranked employee candidates (matcher)

**Files:**
- Modify: `backend/app/services/extraction_service.py`
- Test: `backend/tests/test_match_candidates.py`

**Interfaces:**
- Consumes: `_Emp` protocol (`id, name_en, name_ar, uae_id_no, passport_no`), `rapidfuzz.fuzz`, `fuzz_utils`.
- Produces: `match_employee_candidates(fields: dict[str,str], employees: list[_Emp], *, limit: int = 3, floor: float = 55.0) -> list[dict]` returning candidate dicts `{employee_id, name_en, name_ar, score}` (score 0..1, desc). `PipelineResult.candidates: list[dict]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_match_candidates.py`:

```python
"""Ranked employee candidates for the Scan Inbox chips."""

from app.services.extraction_service import match_employee, match_employee_candidates


class E:
    def __init__(self, id_, en, ar=None):
        self.id = id_
        self.name_en = en
        self.name_ar = ar
        self.uae_id_no = None
        self.passport_no = None


def test_candidates_ranked_capped_and_floored():
    emps = [E("G1", "Ahmed Ali"), E("G2", "Ali Hassan"), E("G3", "Ahmad Aly"), E("G4", "Zzz Xxx")]
    cands = match_employee_candidates({"name_en": "Ahmed Ali"}, emps, limit=3, floor=55.0)
    assert cands, "expected at least one candidate"
    assert cands[0]["employee_id"] == "G1"
    assert len(cands) <= 3
    assert all(c["score"] >= 0.55 for c in cands)
    assert all(set(c) == {"employee_id", "name_en", "name_ar", "score"} for c in cands)
    # G4 is far below the floor and must be excluded
    assert "G4" not in [c["employee_id"] for c in cands]


def test_candidates_empty_without_a_name_field():
    assert match_employee_candidates({}, [E("G1", "Ahmed Ali")]) == []


def test_match_employee_top_equals_candidate_top():
    emps = [E("G1", "Ahmed Ali"), E("G2", "Ali Hassan")]
    emp, _score = match_employee({"name_en": "Ahmed Ali"}, emps)
    top = match_employee_candidates({"name_en": "Ahmed Ali"}, emps)[0]
    assert emp is not None and emp.id == top["employee_id"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest tests/test_match_candidates.py -v`
Expected: FAIL — `ImportError: cannot import name 'match_employee_candidates'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/extraction_service.py`, add constants under `_MATCH_THRESHOLD` (line 14):

```python
_CANDIDATE_LIMIT = 3
_CANDIDATE_FLOOR = 55.0  # rapidfuzz 0..100
```

Add a shared scoring helper and the candidates function (place above `match_employee`), and refactor `match_employee` to reuse it:

```python
def _name_scores(name: str, employees: list[_Emp]) -> list[tuple[_Emp, float]]:
    """(_Emp, best-of-EN/AR score 0..100) for each employee, sorted desc."""
    scored: list[tuple[_Emp, float]] = []
    for emp in employees:
        best = 0.0
        for cand in (emp.name_en, emp.name_ar):
            if not cand:
                continue
            s = fuzz.token_sort_ratio(name, cand, processor=fuzz_utils.default_process)
            if s > best:
                best = s
        scored.append((emp, best))
    scored.sort(key=lambda t: t[1], reverse=True)
    return scored


def match_employee_candidates(
    fields: dict[str, str],
    employees: list[_Emp],
    *,
    limit: int = _CANDIDATE_LIMIT,
    floor: float = _CANDIDATE_FLOOR,
) -> list[dict]:
    """Top-N fuzzy NAME near-misses (denormalized), for the triage suggestion chips.

    Exact ID/passport hits never reach here — those resolve to a single certain
    match upstream and the item is never unrouted."""
    name = fields.get("name_en") or fields.get("name_ar")
    if not name:
        return []
    out: list[dict] = []
    for emp, score in _name_scores(name, employees):
        if score < floor:
            break
        out.append(
            {
                "employee_id": emp.id,
                "name_en": emp.name_en,
                "name_ar": emp.name_ar,
                "score": round(score / 100.0, 3),
            }
        )
        if len(out) >= limit:
            break
    return out
```

Replace the fuzzy-name block of `match_employee` (lines 58-72) with a call to `_name_scores`:

```python
    name = fields.get("name_en") or fields.get("name_ar")
    if not name:
        return None, 0.0
    scored = _name_scores(name, employees)
    if not scored:
        return None, 0.0
    best, best_score = scored[0]
    if best_score >= _MATCH_THRESHOLD:
        return best, best_score / 100.0
    return None, best_score / 100.0
```

- [ ] **Step 4: Add `candidates` to `PipelineResult` and populate it in `run_pipeline`**

In the `PipelineResult` dataclass (line 25-29) add a field (defaulted so existing constructions stay valid):

```python
@dataclass(frozen=True)
class PipelineResult:
    extraction: Extraction
    matched_employee_id: str | None
    match_score: float
    candidates: list[dict] = field(default_factory=list)
```

Add `from dataclasses import dataclass, field` (replace the existing `from dataclasses import dataclass`). In `run_pipeline`, populate it:

```python
    emp, score = match_employee(field_map, employees)
    return PipelineResult(
        extraction=extraction,
        matched_employee_id=emp.id if emp else None,
        match_score=score,
        candidates=match_employee_candidates(field_map, employees),
    )
```

Add `match_employee_candidates` to `__all__`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest tests/test_match_candidates.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Guard against regressions in the existing pipeline**

Run: `venv\Scripts\python.exe -m pytest tests/ -k "intake or extraction or pipeline" -q`
Expected: PASS (the `match_employee` refactor is behavior-preserving).

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/extraction_service.py backend/tests/test_match_candidates.py
git commit -m "feat(scan-inbox): ranked employee candidates in the extraction pipeline"
```

---

## Task 2: Thread candidates through triage

**Files:**
- Modify: `backend/app/services/scan_triage_service.py`
- Test: `backend/tests/test_triage_candidates.py`

**Interfaces:**
- Consumes: `PipelineResult.candidates` (Task 1), `run_intake` (via `IntakeResult.pipeline`).
- Produces: `TriageDecision.candidates: list[dict]` — populated on the `manual`/unrouted branches, empty on `auto`/`confirm`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_triage_candidates.py`:

```python
"""Unrouted triage decisions must carry the matcher's near-miss candidates."""

from app.core.extraction.types import DocType, Extraction
from app.services import scan_triage_service
from app.services.extraction_service import PipelineResult
from app.services.intake_service import IntakeResult

_CANDS = [{"employee_id": "G1", "name_en": "Ahmed Ali", "name_ar": None, "score": 0.62}]


def _fake_intake(pr):
    return lambda **_kw: IntakeResult(mode="external", pipeline=pr)


def test_manual_decision_carries_candidates(monkeypatch):
    # passport doctype but NO confident employee -> manual/unrouted, candidates attached
    ex = Extraction(DocType.PASSPORT, 0.9, [], raw_text="")
    pr = PipelineResult(extraction=ex, matched_employee_id=None, match_score=0.62, candidates=_CANDS)
    monkeypatch.setattr(scan_triage_service, "run_intake", _fake_intake(pr))
    d = scan_triage_service.route(ocr_text="x", qr_refs=[], db=None, employees=[])
    assert d.tier == "manual"
    assert d.candidates == _CANDS


def test_confident_decision_has_no_candidates(monkeypatch):
    # exact employee match -> auto, candidates stay empty (the proposal is the chip)
    ex = Extraction(DocType.EMIRATES_ID, 0.95, [], raw_text="")
    pr = PipelineResult(extraction=ex, matched_employee_id="G7", match_score=1.0, candidates=_CANDS)
    monkeypatch.setattr(scan_triage_service, "run_intake", _fake_intake(pr))
    d = scan_triage_service.route(ocr_text="x", qr_refs=[], db=None, employees=[])
    assert d.tier == "auto"
    assert d.candidates == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest tests/test_triage_candidates.py -v`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'candidates'` (once we reference it) / or AttributeError on `d.candidates`.

- [ ] **Step 3: Add the field to `TriageDecision`**

In `backend/app/services/scan_triage_service.py`, add to the dataclass (after `confidence`, line 38):

```python
    candidates: list[dict] = field(default_factory=list)
```

- [ ] **Step 4: Attach candidates on the manual branches**

Update the two `manual` returns in `route` that have a pipeline result (the early `pr is None` return at lines 79-82 stays `candidates=[]` by default). The branch at lines 89-93:

```python
    if doctype == "unknown" or emp_id is None:
        return TriageDecision(
            tier="manual", proposed_route="unknown",
            document_type=doctype, fields=fields, confidence=conf,
            candidates=pr.candidates,
        )
```

And the final fallthrough at lines 112-115:

```python
    return TriageDecision(
        tier="manual", proposed_route="unknown",
        document_type=doctype, fields=fields, confidence=conf,
        candidates=pr.candidates,
    )
```

Leave the `sick_leave` (confirm) and `_EMPLOYEE_DOCTYPES` (auto/confirm) branches untouched — they carry a proposal, not chips.

- [ ] **Step 5: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest tests/test_triage_candidates.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/scan_triage_service.py backend/tests/test_triage_candidates.py
git commit -m "feat(scan-inbox): triage attaches near-miss candidates to unrouted items"
```

---

## Task 3: `ScanInbox.candidates` column + migration 0047

**Files:**
- Modify: `backend/app/db/models.py:1012` (end of `ScanInbox` columns)
- Create: `backend/app/db/migrations/versions/0047_scan_inbox_candidates.py`

**Interfaces:**
- Produces: `ScanInbox.candidates` (JSON list, defaults to `[]`).

- [ ] **Step 1: Add the model column**

In `backend/app/db/models.py`, in `ScanInbox` after the `attempts` column (line 1012), add:

```python
    candidates: Mapped[list] = mapped_column(JSON, default=list)
```

(`JSON` is already imported and used by `fields`/`qr_refs` in this model.)

- [ ] **Step 2: Write the migration**

Create `backend/app/db/migrations/versions/0047_scan_inbox_candidates.py`:

```python
"""Add scan_inbox.candidates (ranked employee near-misses for triage chips).

Revision ID: 0047_scan_inbox_candidates
Revises: 0046_employee_passport_no_source
Create Date: 2026-07-06
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0047_scan_inbox_candidates"
down_revision: str | Sequence[str] | None = "0046_employee_passport_no_source"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("scan_inbox", sa.Column("candidates", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("scan_inbox", "candidates")
```

- [ ] **Step 3: Apply and verify the migration**

Run: `venv\Scripts\python.exe -m alembic upgrade head`
Expected: `Running upgrade 0046_employee_passport_no_source -> 0047_scan_inbox_candidates`.

Verify round-trip: `venv\Scripts\python.exe -m alembic downgrade -1` then `venv\Scripts\python.exe -m alembic upgrade head` — both succeed with no error.

- [ ] **Step 4: Commit**

```bash
git add backend/app/db/models.py backend/app/db/migrations/versions/0047_scan_inbox_candidates.py
git commit -m "feat(scan-inbox): add candidates column (migration 0047)"
```

---

## Task 4: Persist candidates + expose `fields` and `candidates` in the API

**Files:**
- Modify: `backend/app/services/scan_inbox_service.py:149` (in `_process_one`)
- Modify: `backend/app/schemas/scan_inbox.py`
- Modify: `backend/app/api/v1/scan_inbox.py:54-74` (`_to_item`)
- Test: `backend/tests/test_scan_inbox_document.py` (part 1)

**Interfaces:**
- Consumes: `TriageDecision.candidates` (Task 2), `ScanInbox.candidates`/`.fields` (Task 3).
- Produces: `EmployeeCandidate` pydantic model; `ScanInboxItem.fields: dict[str,str]`, `ScanInboxItem.candidates: list[EmployeeCandidate]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_scan_inbox_document.py`:

```python
"""Scan Inbox: candidates/fields exposure + the document-serve endpoint."""

import pytest

from app.api.errors import NotFoundError
from app.api.v1.scan_inbox import list_scan_inbox
from app.db.models import ScanInbox, User


def _user(db, email="op@x.ae") -> User:
    u = User(email=email, password_hash="x", role="operator", status="active")
    db.add(u)
    db.flush()
    return u


def test_list_exposes_fields_and_candidates(db_session):
    user = _user(db_session)
    cands = [{"employee_id": "G1", "name_en": "Ahmed Ali", "name_ar": None, "score": 0.62}]
    db_session.add(
        ScanInbox(
            source="email", file_path="/s/x.pdf", filename="x.pdf", state="unrouted",
            owner_user_id=user.id, fields={"name_en": "Ahmed Ali"}, candidates=cands,
        )
    )
    db_session.flush()
    res = list_scan_inbox(db=db_session, user=user, state="unrouted")
    item = res.items[0]
    assert item.fields == {"name_en": "Ahmed Ali"}
    assert item.candidates[0].employee_id == "G1"
    assert item.candidates[0].score == 0.62
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest tests/test_scan_inbox_document.py::test_list_exposes_fields_and_candidates -v`
Expected: FAIL — `AttributeError: 'ScanInboxItem' object has no attribute 'fields'`.

- [ ] **Step 3: Add the schema fields**

In `backend/app/schemas/scan_inbox.py`, add the candidate model and extend `ScanInboxItem`:

```python
class EmployeeCandidate(BaseModel):
    employee_id: str
    name_en: str
    name_ar: str | None = None
    score: float
```

Add to `ScanInboxItem` (after `error_detail`):

```python
    fields: dict[str, str] = {}
    candidates: list[EmployeeCandidate] = []
```

Add `EmployeeCandidate` to `__all__`.

- [ ] **Step 4: Map them in `_to_item`**

In `backend/app/api/v1/scan_inbox.py`, import the model and add two kwargs to the `ScanInboxItem(...)` construction in `_to_item` (after `error_detail=row.error_detail`):

```python
        fields=row.fields or {},
        candidates=row.candidates or [],
```

Update the import line: `from app.schemas.scan_inbox import EmployeeCandidate, RouteRequest, ScanInboxCount, ScanInboxItem, ScanInboxList` (Pydantic coerces the stored dicts into `EmployeeCandidate`; the explicit import keeps it available for type clarity).

- [ ] **Step 5: Persist candidates during the drain**

In `backend/app/services/scan_inbox_service.py` `_process_one`, alongside `item.fields = decision.fields or {}` (line 139), add:

```python
    item.candidates = decision.candidates or []
```

- [ ] **Step 6: Run the exposure test + N+1 guard**

Run: `venv\Scripts\python.exe -m pytest tests/test_scan_inbox_document.py::test_list_exposes_fields_and_candidates tests/test_scan_inbox_nplus1.py -v`
Expected: PASS (2 passed) — the new fields read straight off the row, adding no queries.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/scan_inbox_service.py backend/app/schemas/scan_inbox.py backend/app/api/v1/scan_inbox.py backend/tests/test_scan_inbox_document.py
git commit -m "feat(scan-inbox): persist + expose candidates and OCR fields"
```

---

## Task 5: Document-serve endpoint

**Files:**
- Modify: `backend/app/services/scan_inbox_service.py` (add `get_item`, `abs_file_path`)
- Modify: `backend/app/api/v1/scan_inbox.py` (add `GET /{item_id}/document`)
- Test: `backend/tests/test_scan_inbox_document.py` (part 2)

**Interfaces:**
- Consumes: `_get`, `_check_owner`, `_abs` (existing private helpers).
- Produces: `scan_inbox_service.get_item(db, item_id, *, user) -> ScanInbox`; `scan_inbox_service.abs_file_path(item) -> Path`; `GET /api/v1/scan-inbox/{item_id}/document` (inline `FileResponse`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_scan_inbox_document.py`:

```python
def test_get_scan_document_serves_inline(db_session, tmp_path, monkeypatch):
    from app.api.v1 import scan_inbox as api_mod
    from app.services import scan_inbox_service as svc

    user = _user(db_session, "owner@x.ae")
    f = tmp_path / "scan.pdf"
    f.write_bytes(b"%PDF-1.4 hello")
    monkeypatch.setattr(svc, "_abs", lambda rel: f)
    row = ScanInbox(source="email", file_path="/s/x.pdf", filename="scan.pdf",
                    state="unrouted", owner_user_id=user.id)
    db_session.add(row)
    db_session.flush()

    resp = api_mod.get_scan_document(item_id=row.id, db=db_session, user=user)
    assert resp.media_type == "application/pdf"
    assert resp.headers["content-disposition"].startswith("inline")


def test_get_scan_document_foreign_item_404(db_session, tmp_path, monkeypatch):
    from app.api.v1 import scan_inbox as api_mod

    owner = _user(db_session, "owner2@x.ae")
    other = _user(db_session, "other@x.ae")
    row = ScanInbox(source="email", file_path="/s/x.pdf", filename="scan.pdf",
                    state="unrouted", owner_user_id=owner.id)
    db_session.add(row)
    db_session.flush()

    with pytest.raises(NotFoundError):
        api_mod.get_scan_document(item_id=row.id, db=db_session, user=other)


def test_get_scan_document_missing_file_404(db_session, tmp_path, monkeypatch):
    from fastapi import HTTPException

    from app.api.v1 import scan_inbox as api_mod
    from app.services import scan_inbox_service as svc

    user = _user(db_session, "owner3@x.ae")
    monkeypatch.setattr(svc, "_abs", lambda rel: tmp_path / "does-not-exist.pdf")
    row = ScanInbox(source="email", file_path="/s/x.pdf", filename="scan.pdf",
                    state="unrouted", owner_user_id=user.id)
    db_session.add(row)
    db_session.flush()

    with pytest.raises(HTTPException) as ei:
        api_mod.get_scan_document(item_id=row.id, db=db_session, user=user)
    assert ei.value.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest tests/test_scan_inbox_document.py -k get_scan_document -v`
Expected: FAIL — `AttributeError: module 'app.api.v1.scan_inbox' has no attribute 'get_scan_document'`.

- [ ] **Step 3: Add service accessors**

In `backend/app/services/scan_inbox_service.py`, in the `helpers` section (near `_get`, line 344), add:

```python
def get_item(db: Session, item_id: int, *, user: User | None) -> ScanInbox:
    """Owner-checked fetch for read endpoints (raises NotFoundError on foreign item)."""
    item = _get(db, item_id)
    _check_owner(item, user)
    return item


def abs_file_path(item: ScanInbox) -> Path:
    """Absolute on-disk path of the scanned file."""
    return _abs(item.file_path)
```

Add `"abs_file_path"` and `"get_item"` to `__all__`.

- [ ] **Step 4: Add the endpoint**

In `backend/app/api/v1/scan_inbox.py`, add imports at the top:

```python
import mimetypes

from fastapi import HTTPException
from fastapi.responses import FileResponse
```

Add the route (after `list_scan_inbox`, before `scan_inbox_count`):

```python
@router.get("/{item_id}/document")
def get_scan_document(
    item_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("documents.scan"))],
) -> FileResponse:
    """Stream the scanned file inline so the triage card can preview it."""
    item = scan_inbox_service.get_item(db, item_id, user=user)
    abs_path = scan_inbox_service.abs_file_path(item)
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="scan file missing")
    media_type = mimetypes.guess_type(item.filename)[0] or "application/octet-stream"
    return FileResponse(
        abs_path,
        filename=item.filename,
        media_type=media_type,
        content_disposition_type="inline",
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest tests/test_scan_inbox_document.py -v`
Expected: PASS (4 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/scan_inbox_service.py backend/app/api/v1/scan_inbox.py backend/tests/test_scan_inbox_document.py
git commit -m "feat(scan-inbox): inline document-serve endpoint for triage preview"
```

---

## Task 6: Frontend API surface

**Files:**
- Modify: `frontend/src/lib/api.ts` (`ScanInboxItem` interface line ~453; helpers block line ~1152)
- Test: `frontend/src/lib/scanApi.test.ts` (new)

**Interfaces:**
- Produces: `EmployeeCandidate` type; `ScanInboxItem.fields: Record<string,string>`; `ScanInboxItem.candidates: EmployeeCandidate[]`; `api.scanDocumentUrl(id: number): string`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/scanApi.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { api } from './api'

describe('scanDocumentUrl', () => {
  it('builds the inline document URL for a scan item', () => {
    expect(api.scanDocumentUrl(42)).toMatch(/\/scan-inbox\/42\/document$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `pnpm vitest run src/lib/scanApi.test.ts`
Expected: FAIL — `api.scanDocumentUrl is not a function`.

- [ ] **Step 3: Extend the types and add the helper**

In `frontend/src/lib/api.ts`, add near `ScanInboxItem` (line ~453):

```typescript
export interface EmployeeCandidate {
  employee_id: string
  name_en: string
  name_ar: string | null
  score: number
}
```

Add to the `ScanInboxItem` interface (end of its body):

```typescript
  fields: Record<string, string>
  candidates: EmployeeCandidate[]
```

In the API methods block, next to `listScanInbox` (line ~1152), add:

```typescript
  scanDocumentUrl: (id: number) => `${BASE}/scan-inbox/${id}/document`,
```

(`BASE` is the same constant `documentDownloadUrl` uses at line 1487.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/scanApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors (existing `ScanInboxCard` still compiles; new fields are additive).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/scanApi.test.ts
git commit -m "feat(scan-inbox): api types for candidates/fields + scanDocumentUrl"
```

---

## Task 7: `ScanMatchDialog` — doc-alongside search + file

**Files:**
- Create: `frontend/src/pages/scanInbox/ScanMatchDialog.tsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (add `scanInbox.match.*`)
- Test: `frontend/src/pages/scanInbox/ScanMatchDialog.test.tsx`

**Interfaces:**
- Consumes: `api.listEmployees({q, limit})`, `api.listBooks({q, limit})`, `api.routeScanItem(id, {employee_id?|book_id?})`, `api.scanDocumentUrl(id)`, `pickEmployeeName`.
- Produces: `ScanMatchDialog({ item, onClose }: { item: ScanInboxItem; onClose: () => void })` — on a successful route it invalidates `['scan-inbox']`, toasts, and calls `onClose`.

- [ ] **Step 1: Add i18n keys**

In `frontend/src/locales/en.json` under `scanInbox`, add:

```json
    "match": {
      "title": "Match this document",
      "searchPlaceholder": "Search employees or records…",
      "employees": "Employees",
      "records": "Records",
      "fileHere": "File here",
      "noResults": "No results",
      "cancel": "Cancel"
    }
```

In `frontend/src/locales/ar.json` under `scanInbox`, add the parallel keys:

```json
    "match": {
      "title": "طابق هذا المستند",
      "searchPlaceholder": "ابحث عن موظفين أو سجلات…",
      "employees": "الموظفون",
      "records": "السجلات",
      "fileHere": "احفظ هنا",
      "noResults": "لا نتائج",
      "cancel": "إلغاء"
    }
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/pages/scanInbox/ScanMatchDialog.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ScanMatchDialog } from './ScanMatchDialog'
import type { ScanInboxItem } from '../../lib/api'
import * as apiMod from '../../lib/api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

const item = { id: 7, filename: 'scan.pdf', state: 'unrouted' } as unknown as ScanInboxItem

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ScanMatchDialog item={item} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('ScanMatchDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(apiMod.api, 'scanDocumentUrl').mockReturnValue('/api/v1/scan-inbox/7/document')
    vi.spyOn(apiMod.api, 'listBooks').mockResolvedValue({ items: [], total: 0 } as never)
    vi.spyOn(apiMod.api, 'listEmployees').mockResolvedValue({
      items: [{ id: 'G1', name_en: 'Ahmed Ali', name_ar: null }],
      total: 1,
    } as never)
  })

  it('searches employees and routes the item on pick', async () => {
    const route = vi.spyOn(apiMod.api, 'routeScanItem').mockResolvedValue({} as never)
    renderDialog()
    fireEvent.change(screen.getByPlaceholderText('scanInbox.match.searchPlaceholder'), {
      target: { value: 'ahmed' },
    })
    const row = await screen.findByText('Ahmed Ali')
    fireEvent.click(row)
    await waitFor(() => expect(route).toHaveBeenCalledWith(7, { employee_id: 'G1' }))
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/pages/scanInbox/ScanMatchDialog.test.tsx`
Expected: FAIL — cannot resolve `./ScanMatchDialog`.

- [ ] **Step 4: Implement the dialog**

Create `frontend/src/pages/scanInbox/ScanMatchDialog.tsx`:

```tsx
/**
 * ScanMatchDialog — match one scanned document to an employee or a record.
 *
 * Left: the incoming scan (inline preview). Right: a debounced search over
 * employees + books; picking a result files the scan there via
 * `POST /scan-inbox/{id}/route`. The load-bearing "couldn't match → route it"
 * action for unrouted / couldn't-read items.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import type { ScanInboxItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { isPdf } from './scanPreview'

export function ScanMatchDialog({
  item,
  onClose,
}: {
  item: ScanInboxItem
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [raw, setRaw] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    const id = window.setTimeout(() => setQ(raw.trim()), 200)
    return () => window.clearTimeout(id)
  }, [raw])

  const books = useQuery({
    queryKey: ['scan-match-books', q],
    queryFn: () => api.listBooks({ q, limit: 8 }),
    enabled: q.length > 0,
    staleTime: 30_000,
  })
  const employees = useQuery({
    queryKey: ['scan-match-employees', q],
    queryFn: () => api.listEmployees({ q, limit: 8 }),
    enabled: q.length > 0,
    staleTime: 30_000,
  })

  const route = useMutation({
    mutationFn: (body: { employee_id?: string; book_id?: number }) =>
      api.routeScanItem(item.id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scan-inbox'] })
      toast.success(t('scanInbox.toast.filed'))
      onClose()
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('scanInbox.toast.error')),
  })

  const url = api.scanDocumentUrl(item.id)
  const bookRows = books.data?.items ?? []
  const empRows = employees.data?.items ?? []

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-[820px] overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
        {/* Scan preview */}
        <div className="hidden w-[45%] flex-none border-e border-hairline bg-surface-raised md:block">
          {isPdf(item.filename) ? (
            <object data={url} type="application/pdf" className="h-full w-full" aria-label={item.filename} />
          ) : (
            <img src={url} alt={item.filename} className="h-full w-full object-contain" />
          )}
        </div>

        {/* Search */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-hairline p-3">
            <div className="mb-2 text-sm font-semibold text-foreground">{t('scanInbox.match.title')}</div>
            <input
              autoFocus
              type="text"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && onClose()}
              placeholder={t('scanInbox.match.searchPlaceholder')}
              aria-label={t('scanInbox.match.searchPlaceholder')}
              className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {empRows.length > 0 && (
              <div>
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                  {t('scanInbox.match.employees')}
                </div>
                {empRows.map((e) => (
                  <button
                    key={`e-${e.id}`}
                    type="button"
                    disabled={route.isPending}
                    onClick={() => route.mutate({ employee_id: e.id })}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-start text-sm hover:bg-surface-tinted"
                  >
                    <span className="flex-none rounded-sm bg-primary-soft px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                      {e.id}
                    </span>
                    <span className="min-w-0 truncate" dir="auto">
                      {pickEmployeeName(e, i18n.language)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {bookRows.length > 0 && (
              <div>
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                  {t('scanInbox.match.records')}
                </div>
                {bookRows.map((b) => (
                  <button
                    key={`b-${b.id}`}
                    type="button"
                    disabled={route.isPending}
                    onClick={() => route.mutate({ book_id: b.id })}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-start text-sm hover:bg-surface-tinted"
                  >
                    <span className="flex-none rounded-sm bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent">
                      {b.ref_number}
                    </span>
                    <span className="min-w-0 truncate" dir="auto">
                      {b.subject ?? ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {q.length > 0 && empRows.length === 0 && bookRows.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-faint">{t('scanInbox.match.noResults')}</p>
            )}
          </div>

          <div className="flex justify-end border-t border-hairline p-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-tinted"
            >
              {t('scanInbox.match.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
```

- [ ] **Step 5: Add the shared preview helper**

Create `frontend/src/pages/scanInbox/scanPreview.ts`:

```typescript
/** True when a scanned filename should render as an embedded PDF (vs an image). */
export function isPdf(filename: string): boolean {
  return /\.pdf$/i.test(filename)
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/pages/scanInbox/ScanMatchDialog.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/scanInbox/ScanMatchDialog.tsx frontend/src/pages/scanInbox/scanPreview.ts frontend/src/pages/scanInbox/ScanMatchDialog.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(scan-inbox): ScanMatchDialog — preview + search-and-file"
```

---

## Task 8: Rework `ScanInboxCard` — expand, verify, chips, re-match

**Files:**
- Modify: `frontend/src/pages/scanInbox/ScanInboxCard.tsx` (full rewrite)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (add keys below; remove now-unused `actions.openEmail`, `actions.pickEmployee`, `actions.pickRecord`, `actions.notForm`)
- Test: `frontend/src/pages/scanInbox/ScanInboxCard.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 6–7 plus existing `api.confirmScanItem/dismissScanItem/undoScanItem`, `useNavigate`.
- Produces: reworked `ScanInboxCard({ item })`.

- [ ] **Step 1: Add i18n keys**

In `frontend/src/locales/en.json` under `scanInbox`, add:

```json
    "showDetails": "Show details",
    "hideDetails": "Hide details",
    "ocrRead": "What we read",
    "openFullDoc": "Open full document",
    "bestGuesses": "Best guesses",
    "filedTo": "Filed to {{dest}}",
    "openInFile": "Open in file",
    "reMatch": "Wrong? Re-match",
    "fileTo": "File to {{dest}}",
    "ocrField": {
      "name_en": "Name",
      "name_ar": "Name (Arabic)",
      "uae_id_no": "Emirates ID",
      "passport_no": "Passport #",
      "expiry": "Expiry",
      "iban": "IBAN"
    }
```

In `frontend/src/locales/ar.json` under `scanInbox`, add the parallel keys:

```json
    "showDetails": "عرض التفاصيل",
    "hideDetails": "إخفاء التفاصيل",
    "ocrRead": "ما تمت قراءته",
    "openFullDoc": "فتح المستند كاملاً",
    "bestGuesses": "أفضل التطابقات",
    "filedTo": "تم الحفظ في {{dest}}",
    "openInFile": "فتح في الملف",
    "reMatch": "خطأ؟ إعادة المطابقة",
    "fileTo": "احفظ لدى {{dest}}",
    "ocrField": {
      "name_en": "الاسم",
      "name_ar": "الاسم (عربي)",
      "uae_id_no": "الهوية الإماراتية",
      "passport_no": "رقم الجواز",
      "expiry": "الانتهاء",
      "iban": "الآيبان"
    }
```

Delete `actions.openEmail`, `actions.pickEmployee`, `actions.pickRecord`, `actions.notForm` from both files.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/pages/scanInbox/ScanInboxCard.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ScanInboxCard } from './ScanInboxCard'
import type { ScanInboxItem } from '../../lib/api'
import * as apiMod from '../../lib/api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.dest ? `${k}:${o.dest}` : k),
    i18n: { language: 'en' },
  }),
}))

function base(overrides: Partial<ScanInboxItem>): ScanInboxItem {
  return {
    id: 1, filename: 'scan.pdf', state: 'unrouted', fields: {}, candidates: [],
    proposed_route: null, proposed_ref: null, proposed_employee_id: null,
    proposed_employee_name_en: null, proposed_employee_name_ar: null,
    proposed_book_id: null, confidence_tier: 'manual', document_type: null,
    email_sender: null, email_subject: null, ledger_entry_id: null,
    ...overrides,
  } as ScanInboxItem
}

function renderCard(item: ScanInboxItem) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ScanInboxCard item={item} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ScanInboxCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(apiMod.api, 'scanDocumentUrl').mockReturnValue('/x')
  })

  it('files an unrouted item via a candidate chip', async () => {
    const route = vi.spyOn(apiMod.api, 'routeScanItem').mockResolvedValue({} as never)
    renderCard(base({
      candidates: [{ employee_id: 'G1', name_en: 'Ahmed Ali', name_ar: null, score: 0.82 }],
    }))
    fireEvent.click(screen.getByText(/scanInbox.fileTo:Ahmed Ali/))
    await waitFor(() => expect(route).toHaveBeenCalledWith(1, { employee_id: 'G1' }))
  })

  it('shows a destination deep-link for an auto-filed item', () => {
    renderCard(base({
      state: 'auto_filed', proposed_route: 'employee_doc',
      proposed_employee_id: 'G5', proposed_employee_name_en: 'Sara Omar',
    }))
    const link = screen.getByText('scanInbox.openInFile').closest('a')
    expect(link).toHaveAttribute('href', '/employees/G5')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/pages/scanInbox/ScanInboxCard.test.tsx`
Expected: FAIL — chip text / deep-link not present (old card).

- [ ] **Step 4: Rewrite the card**

Replace the entire contents of `frontend/src/pages/scanInbox/ScanInboxCard.tsx`:

```tsx
/**
 * ScanInboxCard — one triage card for a ScanInboxItem.
 *
 * Expands in place to show the scanned document + what the OCR read, so the
 * operator can verify before acting. Actions scale to state:
 *  - awaiting_confirmation → File-to-proposal chip + Match… + Dismiss
 *  - unrouted / error      → candidate chips (if any) + Match… + Dismiss
 *  - auto_filed            → destination deep-link + Undo + Wrong? Re-match
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type { ScanInboxItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { Button } from '@/components/ui/button'
import { ScanMatchDialog } from './ScanMatchDialog'
import { isPdf } from './scanPreview'

export function ScanInboxCard({ item }: { item: ScanInboxItem }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [matchOpen, setMatchOpen] = useState(false)

  const empName =
    item.proposed_employee_name_en !== null
      ? pickEmployeeName(
          { name_en: item.proposed_employee_name_en, name_ar: item.proposed_employee_name_ar },
          i18n.language,
        )
      : ''

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['scan-inbox'] })
  const onErr = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : t('scanInbox.toast.error'))

  const confirm = useMutation({
    mutationFn: () => api.confirmScanItem(item.id),
    onSuccess: () => { invalidate(); toast.success(t('scanInbox.toast.filed')) },
    onError: onErr,
  })
  const dismiss = useMutation({
    mutationFn: () => api.dismissScanItem(item.id),
    onSuccess: () => { invalidate(); toast.success(t('scanInbox.toast.dismissed')) },
    onError: onErr,
  })
  const undo = useMutation({
    mutationFn: () => api.undoScanItem(item.id),
    onSuccess: () => { invalidate(); toast.success(t('scanInbox.toast.undone')) },
    onError: onErr,
  })
  const chipRoute = useMutation({
    mutationFn: (employeeId: string) => api.routeScanItem(item.id, { employee_id: employeeId }),
    onSuccess: () => { invalidate(); toast.success(t('scanInbox.toast.filed')) },
    onError: onErr,
  })

  const destLabel =
    item.proposed_route === 'book_attach' ? item.proposed_ref ?? '' : empName
  const destHref =
    item.proposed_route === 'book_attach' && item.proposed_book_id !== null
      ? `/books/${item.proposed_book_id}`
      : item.proposed_employee_id !== null
        ? `/employees/${encodeURIComponent(item.proposed_employee_id)}`
        : null

  const headline = (() => {
    if (item.state === 'error') return t('scanInbox.errorRead')
    if (item.state === 'auto_filed') return t('scanInbox.filedTo', { dest: destLabel })
    if (item.proposed_route === 'book_attach' && item.proposed_ref)
      return t('scanInbox.confirmBook', { ref: item.proposed_ref })
    if (item.proposed_route === 'employee_doc' && empName)
      return t('scanInbox.confirmEmployee', { type: item.document_type ?? '', name: empName })
    return t('scanInbox.manual')
  })()

  const canConfirm =
    (item.state === 'awaiting_confirmation' || item.state === 'unrouted') &&
    item.confidence_tier !== 'manual' &&
    (item.proposed_route === 'book_attach' || item.proposed_route === 'employee_doc')

  const fieldEntries = Object.entries(item.fields ?? {}).filter(([, v]) => v)

  const url = api.scanDocumentUrl(item.id)

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[0.78em] text-muted-foreground" dir="auto">
            {item.email_sender ? t('scanInbox.fromEmail', { sender: item.email_sender }) : item.filename}
          </div>
          {item.email_subject && (
            <div className="truncate text-[0.86em] font-medium text-foreground" dir="auto">
              {item.email_subject}
            </div>
          )}
          <p className="mt-2 text-[0.95em] text-foreground" dir="auto">{headline}</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={t(expanded ? 'scanInbox.hideDetails' : 'scanInbox.showDetails')}
          className="flex-none rounded-md p-1 text-muted-foreground hover:bg-surface-tinted"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 grid gap-3 rounded-lg border border-hairline bg-surface-raised p-3 sm:grid-cols-[minmax(0,180px)_1fr]">
          <div className="h-[180px] overflow-hidden rounded-md border border-border bg-surface">
            {isPdf(item.filename) ? (
              <object data={url} type="application/pdf" className="h-full w-full" aria-label={item.filename} />
            ) : (
              <img src={url} alt={item.filename} className="h-full w-full object-contain" />
            )}
          </div>
          <div className="min-w-0 text-[0.82em]">
            {item.state !== 'error' && fieldEntries.length > 0 && (
              <>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
                  {t('scanInbox.ocrRead')}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  {fieldEntries.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">
                        {t(`scanInbox.ocrField.${k}`, { defaultValue: k })}
                      </dt>
                      <dd className="truncate text-foreground" dir="auto">{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[0.9em] text-muted-foreground hover:text-foreground">
              {t('scanInbox.openFullDoc')}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        </div>
      )}

      {/* Candidate chips (unrouted / couldn't-read) */}
      {item.state !== 'auto_filed' && item.candidates.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
            {t('scanInbox.bestGuesses')}
          </div>
          <div className="flex flex-wrap gap-2">
            {item.candidates.map((c) => (
              <button
                key={c.employee_id}
                type="button"
                disabled={chipRoute.isPending}
                onClick={() => chipRoute.mutate(c.employee_id)}
                className="rounded-full border border-primary/40 bg-primary-soft px-3 py-1 text-[0.8em] font-medium text-primary hover:bg-primary/10"
              >
                {t('scanInbox.fileTo', { dest: pickEmployeeName({ name_en: c.name_en, name_ar: c.name_ar }, i18n.language) })}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action row */}
      <div className="mt-3 flex flex-wrap gap-2">
        {item.state === 'auto_filed' ? (
          <>
            {destHref && (
              <a
                href={destHref}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[0.8em] font-medium text-primary hover:bg-surface-tinted"
              >
                {t('scanInbox.openInFile')}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
            <Button variant="outline" size="sm" onClick={() => undo.mutate()} disabled={undo.isPending}>
              {t('scanInbox.actions.undo')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={undo.isPending}
              onClick={async () => {
                try {
                  await undo.mutateAsync()
                  setMatchOpen(true)
                } catch { /* toast already shown */ }
              }}
            >
              {t('scanInbox.reMatch')}
            </Button>
          </>
        ) : (
          <>
            {canConfirm && (
              <Button size="sm" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
                {t('scanInbox.fileTo', { dest: destLabel })}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setMatchOpen(true)}>
              {t('scanInbox.actions.match')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>
              {t('scanInbox.actions.dismiss')}
            </Button>
          </>
        )}
      </div>

      {matchOpen && <ScanMatchDialog item={item} onClose={() => setMatchOpen(false)} />}
    </div>
  )
}
```

Also add the `actions.match` key used by the Match… button: in `en.json` `scanInbox.actions.match` = `"Match…"`, in `ar.json` = `"طابق…"`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/pages/scanInbox/ScanInboxCard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + full frontend test run**

Run: `pnpm tsc --noEmit` then `pnpm vitest run src/pages/scanInbox`
Expected: no type errors; all scanInbox tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/scanInbox/ScanInboxCard.tsx frontend/src/pages/scanInbox/ScanInboxCard.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(scan-inbox): actionable cards — preview, verify, chips, re-match"
```

---

## Task 9: i18n/RTL audit + full verification

**Files:** none new — verification pass over the whole change.

- [ ] **Step 1: Run the i18n-rtl reviewer**

Dispatch the `i18n-rtl-reviewer` agent over the diff (`git diff main -- frontend/src/locales frontend/src/pages/scanInbox`). Confirm: EN↔AR key parity under `scanInbox` (incl. nested `match.*`, `ocrField.*`), no English leaking into `ar.json`, and `dir="auto"` on user-content spans. Fix any finding it reports.

- [ ] **Step 2: Full backend suite**

Run: `venv\Scripts\python.exe -m pytest tests/ -q`
Expected: PASS (no regressions).

- [ ] **Step 3: Full frontend suite + lint + typecheck**

Run (from `frontend/`): `pnpm vitest run && pnpm tsc --noEmit && pnpm lint`
Expected: all green.

- [ ] **Step 4: Manual smoke (optional but recommended)**

`mng deploy` (or `pnpm dev`), open `/scan-inbox`, and confirm: a card expands to show the preview + OCR panel; an unrouted item shows candidate chips that file on click; `Match…` opens the dialog and search-picks file; an auto-filed item links to `/employees/:id` or `/books/:id` and `Wrong? Re-match` reopens the dialog.

- [ ] **Step 5: Commit any audit fixes**

```bash
git add -A
git commit -m "fix(scan-inbox): i18n parity + RTL audit fixes"
```

---

## Self-review notes (spec coverage)

- Preview (expand-in-place) → Tasks 5 (serve), 8 (card embed). OCR-read panel → Tasks 4 (expose `fields`), 8 (render).
- Manual match (doc-alongside search) → Task 7 (`ScanMatchDialog`), reusing existing `routeScanItem`.
- Candidate chips (top-N near-misses) → Tasks 1 (matcher), 2 (triage), 3 (column), 4 (expose), 8 (render).
- Auto-filed: destination line + deep-link + OCR verify + `Wrong? Re-match` → Task 8.
- Backend additions (serve endpoint, `fields`+`candidates`) → Tasks 4–5. Migration 0047 → Task 3.
- i18n parity / RTL → keys added in Tasks 7–8, audited in Task 9.
- Security (capability gate + owner 404) → Task 5 tests.
- Book near-miss chips intentionally excluded (spec non-goal) — routing to a book still available via the search dialog.
