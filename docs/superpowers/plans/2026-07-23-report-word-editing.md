# Report Authored in Word (remove HugeRTE) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Report (تقرير) body authored in real Word (like the General Book) instead of the in-browser HugeRTE editor.

**Architecture:** Report rides the existing General Book Word-session rails — the same `POST /books/word-sessions` (create), `/finish`, `DELETE` (discard), and `/preview` endpoints and the same `WordHandoffDialog` — extended with a Report branch. Create renders the report paper with an empty body and opens a WebDAV `BookEditSession`; the operator writes the body in Word; Finish reads it back into a `BookVersion` (`template_id="Report"`) and, if requested, stamps the signer's signature via the existing `render_signed_pdf`.

**Tech Stack:** FastAPI + SQLAlchemy (SQLite) + Alembic; React 19 / Vite / TS; Word COM for DOCX→PDF; WebDAV for Word editing.

## Global Constraints

- Branch: `feature/report-word-editing` (stacked on `fix/report-template-qa`, which is stacked on `main`). Do NOT branch off plain `main` — the Report form needs the QA Literal fix to load.
- Backend runs through the repo venv: `venv\Scripts\python.exe`. Frontend uses `pnpm -C frontend`.
- Strict gates are real: `venv\Scripts\mypy.exe` is `strict`; `pytest` runs with `filterwarnings=error`; `ruff check` + `ruff format --check` must pass. A ruff-on-edit + mypy-on-edit hook runs after every edit.
- Migrations: hand-numbered `NNNN_<slug>`, single linear head. New revision `0064`, down_revision `0063`. Use the `/new-migration` skill to scaffold; nullable ADD COLUMN needs no `server_default`.
- Naive **local** time (`datetime.now()`) for every Report `created_at` (Book, BookVersion, Document) — matches all other book paths; UTC buries the record in the Records list (the 2026-07-23 QA fix).
- After any backend Pydantic/route change, resync `openapi.json` → `frontend/src/lib/api.types.ts` via the `/sync-api-types` flow before committing frontend code.
- Bilingual: no new user-facing strings needed (reuse `books.word.*` keys). Report field labels already exist in `_fields.json`.
- Commit after each task. Do NOT push or deploy (operator does that).

---

### Task 1: Persist signer + sign-on-finish on the edit session

**Files:**
- Modify: `backend/app/db/models.py` (BookEditSession, after line 158 `last_put_at`)
- Create: `backend/app/db/migrations/versions/0064_book_edit_session_report_signer.py`
- Test: `backend/tests/test_word_report_session.py` (new)

**Interfaces:**
- Produces: `BookEditSession.signer_employee_id: str | None`, `BookEditSession.sign_on_finish: bool | None`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_word_report_session.py`:
```python
"""Report authored in Word — session persistence, create, finish."""
from __future__ import annotations

from app.db.models import BookCategory, BookEditSession, User


def _seed_gs(db) -> None:
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.flush()


def test_edit_session_carries_signer_and_sign(db_session):
    _seed_gs(db_session)
    s = BookEditSession(
        book_id=1, user_id=1, token="t", working_path="w", state="active",
        signer_employee_id="G3019", sign_on_finish=True,
    )
    db_session.add(s)
    db_session.commit()
    db_session.refresh(s)
    assert s.signer_employee_id == "G3019"
    assert s.sign_on_finish is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_report_session.py::test_edit_session_carries_signer_and_sign -v`
Expected: FAIL — `TypeError: 'signer_employee_id' is an invalid keyword argument for BookEditSession`.

- [ ] **Step 3: Add the columns to the model**

In `backend/app/db/models.py`, in `class BookEditSession`, immediately after the `last_put_at` line:
```python
    # Report-only: the picked signer employee + whether to embed their signature
    # at Finish. Set by create_report_word_book; read by finish_word_session.
    signer_employee_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    sign_on_finish: Mapped[bool | None] = mapped_column(nullable=True)
```

- [ ] **Step 4: Scaffold + write the migration**

Use `/new-migration` to scaffold `0064_book_edit_session_report_signer`, then set its body:
```python
"""book_edit_sessions: report signer + sign-on-finish

Revision ID: 0064
Revises: 0063
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0064"
down_revision: str | Sequence[str] | None = "0063"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("book_edit_sessions", sa.Column("signer_employee_id", sa.String(length=16), nullable=True))
    op.add_column("book_edit_sessions", sa.Column("sign_on_finish", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("book_edit_sessions", "sign_on_finish")
    op.drop_column("book_edit_sessions", "signer_employee_id")
```

- [ ] **Step 5: Apply migration + run tests**

Run: `venv\Scripts\alembic.exe upgrade head` then `venv\Scripts\python.exe -m pytest backend/tests/test_word_report_session.py -v`
Expected: upgrade succeeds (single head); test PASSES. Also run `venv\Scripts\alembic.exe heads` — expect exactly one head `0064`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/db/models.py backend/app/db/migrations/versions/0064_book_edit_session_report_signer.py backend/tests/test_word_report_session.py
git commit -m "feat(report): carry signer + sign-on-finish on book_edit_sessions (0064)"
```

---

### Task 2: Extend WordBookCreate with signer/sign/date

**Files:**
- Modify: `backend/app/schemas/book.py` (class `WordBookCreate`)
- Test: `backend/tests/test_word_report_session.py`

**Interfaces:**
- Produces: `WordBookCreate.signer_employee_id: str | None`, `.sign: bool` (default True), `.date: str | None`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_word_report_session.py`:
```python
def test_wordbookcreate_accepts_report_fields():
    from app.schemas.book import WordBookCreate

    m = WordBookCreate(subject="s", signer_employee_id="G3019", sign=False, date="2026-07-23")
    assert m.signer_employee_id == "G3019"
    assert m.sign is False
    assert m.date == "2026-07-23"
    # General Book payload unaffected — the new fields default cleanly.
    gb = WordBookCreate(subject="s", classification_code="1")
    assert gb.signer_employee_id is None
    assert gb.sign is True
    assert gb.date is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_report_session.py::test_wordbookcreate_accepts_report_fields -v`
Expected: FAIL — `WordBookCreate` has no field `signer_employee_id`.

- [ ] **Step 3: Add the fields**

In `backend/app/schemas/book.py`, in `class WordBookCreate`, after `table_rows`:
```python
    # Report path only: present ⇒ create a Report (no classification/ref). `sign`
    # embeds the signer's signature at Finish; `date` is the report's document date.
    signer_employee_id: str | None = None
    sign: bool = True
    date: str | None = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_report_session.py::test_wordbookcreate_accepts_report_fields -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/book.py backend/tests/test_word_report_session.py
git commit -m "feat(report): add signer_employee_id/sign/date to WordBookCreate"
```

---

### Task 3: `create_report_word_book` service

**Files:**
- Modify: `backend/app/services/word_book_service.py` (add function)
- Test: `backend/tests/test_word_report_session.py`

**Interfaces:**
- Consumes: `report_service._resolve_signer(db, employee_id) -> (name, title, sig|None)`, `word_book_service._resolve_recipient`, `WordSessionInfo`.
- Produces: `word_book_service.create_report_word_book(db, *, user, signer_employee_id, recipient_id, subject, date, sign) -> WordSessionInfo`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_word_report_session.py`:
```python
from pathlib import Path

from app.db.models import BookEditSession as _BES  # noqa: F401


def _user(db, employee_id=None):
    u = User(email="op@test.ae", password_hash="x", status="active")
    u.employee_id = employee_id
    db.add(u)
    db.flush()
    db.refresh(u)
    return u


def test_create_report_word_book(db_session):
    from app.db.models import Book, BookEditSession, Employee
    from app.services import word_book_service

    _seed_gs(db_session)
    db_session.add(Employee(id="G1042", name_en="Muhannad", name_ar="مهند", position="Head"))
    op = _user(db_session, employee_id="G3082")
    db_session.commit()

    info = word_book_service.create_report_word_book(
        db_session, user=op, signer_employee_id="G1042", recipient_id=None,
        subject="تقرير", date="2026-07-23", sign=True,
    )
    assert info.ref_number.startswith("REPORT-")
    assert info.word_url.startswith("ms-word:ofe|u|")

    book = db_session.get(Book, info.book_id)
    assert book.classification_code is None
    assert book.approval_state == "approved"
    sess = db_session.query(BookEditSession).filter_by(book_id=book.id, state="active").one()
    assert sess.signer_employee_id == "G1042"
    assert sess.sign_on_finish is True
    assert Path(sess.working_path).is_file()  # working docx rendered
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_report_session.py::test_create_report_word_book -v`
Expected: FAIL — `word_book_service has no attribute 'create_report_word_book'`.

- [ ] **Step 3: Implement the function**

In `backend/app/services/word_book_service.py`, add after `create_word_book` (before the `# Private helpers` divider). Note the existing module imports already cover `Any`, `datetime`, `secrets`, `uuid`, `Book`, `BookCategory`, `BookEditSession`, `DocxEngine`, `_postprocess_general_book_footer`, `manager_override`, `GENERAL_BOOK_BODY_SENTINEL`, `get_settings`:
```python
def create_report_word_book(
    db: Session,
    *,
    user: User,
    signer_employee_id: str,
    recipient_id: int | None,
    subject: str,
    date: str | None,
    sign: bool,
) -> WordSessionInfo:
    """Create a no-ref Report on the report paper with an empty, Word-editable body.

    Mirrors ``create_word_book`` MINUS classification/ref allocation and the Aztec
    ref stamp: the ref is the internal ``REPORT-{id}``, the paper is ``report.docx``,
    and the author block is the picked employee (name/title only — the signature is
    embedded at Finish). The signer + sign choice ride the session to Finish.
    """
    from app.services import report_service  # local import: avoid import cycle

    settings = get_settings()
    name, title, _sig = report_service._resolve_signer(db, signer_employee_id)

    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.flush()

    now = datetime.now()  # naive LOCAL — must match every other book path (QA fix)
    book = Book(
        category_id="GS",
        ref_number=f"__pending_{uuid.uuid4().hex}__",
        subject=subject,
        classification_code=None,
        approval_state="approved",
        submitted_by_user_id=user.id,
        created_at=now,
    )
    db.add(book)
    db.flush()  # assigns book.id
    book.ref_number = f"REPORT-{book.id}"
    db.flush()

    filename = book.ref_number + ".docx"  # REPORT-N has no slashes
    output_path = settings.data_dir / "editing" / f"book-{book.id}" / filename

    data: dict[str, Any] = {
        "date": date or now.strftime("%d-%m-%Y"),
        "subject": subject,
        "body": GENERAL_BOOK_BODY_SENTINEL,
        "body_html": "",  # empty → {{ body }} anchor clears; body written in Word
        "recipient_name": _resolve_recipient(db, recipient_id),
        "cc": "",
        "submitter_g": user.employee_id or "",  # footer = signed-in account
    }
    manager_override.apply(
        data,
        {"name_ar": name, "name_en": name, "title": title, "sig_path": None},
        embed=False,  # no signature at create — embedded at Finish
        prefer_arabic=True,
    )
    DocxEngine(settings.templates_dir).fill("Report", data, output_path)
    _postprocess_general_book_footer(output_path)
    # NO Aztec / ref stamp — Report is no-ref.

    token = secrets.token_urlsafe(32)
    session = BookEditSession(
        book_id=book.id,
        user_id=user.id,
        token=token,
        working_path=str(output_path),
        state="active",
        signer_employee_id=signer_employee_id,
        sign_on_finish=sign,
    )
    db.add(session)
    db.commit()

    base_url = settings.public_base_url.rstrip("/")
    dav_url = f"{base_url}/dav/{token}/{filename}"
    return WordSessionInfo(
        book_id=book.id,
        ref_number=book.ref_number,
        token=token,
        filename=filename,
        word_url=f"ms-word:ofe|u|{dav_url}",
        dav_url=dav_url,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_report_session.py::test_create_report_word_book -v`
Expected: PASS (Word COM not needed at create — only DOCX fill).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/word_book_service.py backend/tests/test_word_report_session.py
git commit -m "feat(report): create_report_word_book — no-ref Word session on report paper"
```

---

### Task 4: Dispatch `POST /books/word-sessions` to the Report path

**Files:**
- Modify: `backend/app/api/v1/books.py` (`create_word_session`, lines 163-188)
- Test: `backend/tests/test_word_report_session.py`

**Interfaces:**
- Consumes: `word_book_service.create_report_word_book`, `word_book_service.create_word_book`.

- [ ] **Step 1: Write the failing test**

There are no shared `client`/`auth_headers` fixtures — build a TestClient locally with dependency overrides, exactly like `_make_client` in `test_reports_api.py` (copy its import lines for `create_app`, `get_db`, `get_current_user`). The `db_session` fixture is in-memory but does NOT isolate `data_dir`, so the create writes the working docx under the real `data/editing/` (a harmless test artifact — the same approach `test_report_service.py` uses). Append to `backend/tests/test_word_report_session.py`:
```python
def test_create_word_session_dispatches_report(db_session):
    from fastapi.testclient import TestClient

    from app.api.deps import get_current_user, get_db  # mirror test_reports_api.py's imports
    from app.db.models import Employee, User
    from app.main import create_app

    u = User(email="op2@test.ae", password_hash="x", role="admin", status="active")
    db_session.add(u)
    db_session.add(Employee(id="G1042", name_en="Muhannad", name_ar="مهند", position="Head"))
    db_session.commit()
    db_session.refresh(u)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: u
    client = TestClient(app, raise_server_exceptions=True)

    r = client.post(
        "/api/v1/books/word-sessions",
        json={"subject": "تقرير", "signer_employee_id": "G1042", "sign": True, "date": "2026-07-23"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["ref_number"].startswith("REPORT-")
```
> `role="admin"` gets `books.manage` from the role defaults `db_session` seeds. Confirm the `get_db` import path against `test_reports_api.py` (it exists until Task 6).

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_report_session.py::test_create_word_session_dispatches_report -v`
Expected: FAIL — the endpoint always calls `create_word_book`, which raises `CLASSIFICATION_REQUIRED` (422).

- [ ] **Step 3: Add the dispatch**

Replace the body of `create_word_session` in `backend/app/api/v1/books.py` (lines 169-180) with:
```python
    """Create a General Book, or a no-ref Report when a signer is given, with a
    Word-editable working docx."""
    if payload.signer_employee_id is not None:
        info = word_book_service.create_report_word_book(
            db,
            user=user,
            signer_employee_id=payload.signer_employee_id,
            recipient_id=payload.recipient_id,
            subject=payload.subject,
            date=payload.date,
            sign=payload.sign,
        )
    else:
        info = word_book_service.create_word_book(
            db,
            user=user,
            classification_code=payload.classification_code,
            recipient_id=payload.recipient_id,
            subject=payload.subject,
            cc=payload.cc,
            manager_id=payload.manager_id,
            template_name=payload.template_name,
            table_rows=payload.table_rows,
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_report_session.py backend/tests/test_word_book_service.py -v`
Expected: the new dispatch test PASSES and the existing General Book word tests still PASS (regression: no `signer_employee_id` ⇒ General Book unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/books.py backend/tests/test_word_report_session.py
git commit -m "feat(report): dispatch /books/word-sessions to the Report path on signer_employee_id"
```

---

### Task 5: Finish a Report session (template_id + signature embed)

**Files:**
- Modify: `backend/app/services/word_book_service.py` (`finish_word_session`)
- Test: `backend/tests/test_word_report_session.py`

**Interfaces:**
- Consumes: `document_service.render_signed_pdf(db, version=..., signer_signature_path=..., signer_names=[...]) -> str`, `report_service._resolve_signer`.

- [ ] **Step 1: Write the failing test** (real render + Word COM — Word must be available)

Append to `backend/tests/test_word_report_session.py`. Reuse the PNG helper + Submitter seeding pattern from `test_report_service.py`:
```python
import struct
import zlib


def _png(path: Path) -> None:
    def ch(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + ch(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + ch(b"IDAT", zlib.compress(b"\x00\xff\xff\xff"))
        + ch(b"IEND", b"")
    )


def test_finish_report_session_embeds_signature(db_session, tmp_path):
    from datetime import datetime

    from app.db.models import BookEditSession, BookVersion, Document, Employee, Submitter
    from app.services import word_book_service

    _seed_gs(db_session)
    sig = tmp_path / "sig.png"
    _png(sig)
    db_session.add(Employee(id="G1042", name_en="Muhannad", name_ar="مهند", position="Head"))
    db_session.add(Submitter(employee_id="G1042", name="مهند", stored_sig_path=str(sig)))
    op = _user(db_session, employee_id="G3082")
    db_session.commit()

    info = word_book_service.create_report_word_book(
        db_session, user=op, signer_employee_id="G1042", recipient_id=None,
        subject="تقرير", date="2026-07-23", sign=True,
    )
    # Simulate Word having PUT to the working file.
    sess = db_session.query(BookEditSession).filter_by(book_id=info.book_id, state="active").one()
    sess.last_put_at = datetime.now()
    db_session.commit()

    book = word_book_service.finish_word_session(db_session, user=op, book_id=info.book_id)
    ver = db_session.query(BookVersion).filter_by(book_id=book.id).one()
    assert ver.template_id == "Report"
    assert ver.manager_sig_embedded is True
    assert ver.signed_pdf_path is not None
    assert ver.fields["signed"] is True
    doc = db_session.get(Document, ver.document_id)
    assert doc.template_id == "Report"
    assert abs((datetime.now() - ver.created_at).total_seconds()) < 300  # local time
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_report_session.py::test_finish_report_session_embeds_signature -v`
Expected: FAIL — `ver.template_id` is `"General Book"` (and no signature).

- [ ] **Step 3: Branch `finish_word_session` for Reports**

In `backend/app/services/word_book_service.py`, in `finish_word_session`, after the `NO_SAVES_YET` guard and before the "1. Move working docx" block, add:
```python
    is_report = book.ref_number.startswith("REPORT-")
    template_id = "Report" if is_report else _TEMPLATE_ID
    now = datetime.now() if is_report else datetime.now(UTC).replace(tzinfo=None)
```
Then, in the same function:
- Replace the hardcoded `template_id = _TEMPLATE_ID` line (currently just before `now = ...`) — remove it (the two lines above now define both), and remove the existing `now = datetime.now(UTC).replace(tzinfo=None)` line (replaced above).
- On the `Document(...)` constructor, add `created_at=now,`.
- On the `BookVersion(...)` constructor, add `created_at=now,` and replace `fields={}` with:
```python
        fields=(
            {"signer_employee_id": session.signer_employee_id, "signed": False}
            if is_report
            else {}
        ),
```
- Immediately after `db.add(version)` (before the search_text block), insert the signature-embed block:
```python
    if is_report and session.sign_on_finish and session.signer_employee_id:
        from app.services import document_service, report_service
        from app.db.models import Employee

        _n, _t, sig = report_service._resolve_signer(db, session.signer_employee_id)
        if sig is not None:
            db.flush()  # version needs a document_id for render_signed_pdf
            emp = db.get(Employee, session.signer_employee_id)
            names = [n for n in (emp.name_ar, emp.name_en) if emp and n]
            signed_rel = document_service.render_signed_pdf(
                db, version=version, signer_signature_path=sig, signer_names=names
            )
            version.signed_pdf_path = signed_rel
            version.signed_by_user_id = user.id
            version.signed_at = now
            version.manager_sig_embedded = True
            version.fields = {**version.fields, "signed": True}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_report_session.py backend/tests/test_word_book_service.py -v`
Expected: the Report finish test PASSES; existing General Book finish tests still PASS (General Book: `is_report=False` ⇒ `template_id="General Book"`, `fields={}`, UTC `now` — unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/word_book_service.py backend/tests/test_word_report_session.py
git commit -m "feat(report): finish Report session as template_id=Report + embed signer signature"
```

---

### Task 6: Remove the one-shot Report path

**Files:**
- Modify: `backend/app/api/v1/books.py` (remove `create_report` route + its imports)
- Modify: `backend/app/services/report_service.py` (remove `create_report`; keep `_resolve_signer`, `_resolve_recipient`)
- Modify: `backend/app/schemas/report.py` (remove `ReportCreate` if unused elsewhere)
- Delete: `backend/tests/test_reports_api.py`
- Modify: `backend/tests/test_report_service.py` (drop the create_report test; keep helpers if reused) — or delete if it only tested `create_report`

- [ ] **Step 1: Confirm the blast radius**

Run: `grep -rn "create_report\b\|ReportCreate\|/books/reports" backend/app`
Expected references: the `books.py` route (254-274), `report_service.create_report`, `schemas/report.py::ReportCreate`, and the router import of `ReportCreate`. Note each for removal. (Task 4's test copied the `_make_client`/import pattern out of `test_reports_api.py`, so deleting that file here doesn't break it.)

- [ ] **Step 2: Remove the route + service + schema**

- In `backend/app/api/v1/books.py`: delete the `@router.post("/reports", ...)` function (lines ~254-274) and drop `ReportCreate`, `report_service` from imports **only if now unused in the file** (keep `report_service` import if still referenced).
- In `backend/app/services/report_service.py`: delete `create_report`. Keep `_resolve_signer` and `_resolve_recipient` (reused by `word_book_service`). If the file's remaining imports (`manager_override`, `DocxEngine`, `convert_docx_to_pdf`, etc.) become unused after removal, delete those import lines too (ruff will flag them).
- In `backend/app/schemas/report.py`: remove `ReportCreate` if nothing else references it (`grep -rn ReportCreate backend/app`). If the file becomes empty, leave a module docstring or delete the file and its import.

- [ ] **Step 3: Remove/trim the dead tests**

- Delete `backend/tests/test_reports_api.py`.
- In `backend/tests/test_report_service.py`: remove `test_create_report_no_ref_signer_and_footer` (it tested the removed one-shot). If that was the only test, delete the file. The Word-path equivalents live in `test_word_report_session.py` (Task 5).

- [ ] **Step 4: Run the full backend suite + gates**

Run: `venv\Scripts\python.exe -m pytest backend/tests -q` then `venv\Scripts\ruff.exe check backend` and `venv\Scripts\mypy.exe`
Expected: green (a pre-existing flaky `test_dav` may fail under parallel cleanup — re-run it alone to confirm; and `settings_service.py`/`perm_service.py` mypy lines are the known main baseline, not from this change).

- [ ] **Step 5: Commit**

```bash
git add -A backend
git commit -m "refactor(report): remove one-shot POST /books/reports (Word path replaces it)"
```

---

### Task 7: Drop the HugeRTE body field from the Report form schema

**Files:**
- Modify: `backend/templates/_fields.json` (the `Report` entry)
- Test: `backend/tests/test_templates_catalog.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_templates_catalog.py`:
```python
def test_report_form_has_no_rich_body_field():
    detail = template_service.get_template_fields("Report")
    types = {f.type for f in detail.fields}
    assert "arabic_rich_full" not in types  # body is written in Word, not the form
    keys = {f.key for f in detail.fields}
    assert keys == {"signer_id", "recipient_id", "subject", "report_date", "sign"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_templates_catalog.py::test_report_form_has_no_rich_body_field -v`
Expected: FAIL — `arabic_rich_full` (the `body` field) is still present.

- [ ] **Step 3: Remove the body field**

In `backend/templates/_fields.json`, in the `"Report"` → `"fields"` array, delete the object with `"key": "body"` (`"type": "arabic_rich_full"`). Leave `signer_id`, `recipient_id`, `subject`, `report_date`, `sign`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_templates_catalog.py -v`
Expected: PASS (including the existing "every template fields endpoint loads" + signer-picker guards).

- [ ] **Step 5: Commit**

```bash
git add backend/templates/_fields.json backend/tests/test_templates_catalog.py
git commit -m "feat(report): drop the in-form rich body field (body now written in Word)"
```

---

### Task 8: Frontend — Report uses the Word handoff; resync types

**Files:**
- Modify: `frontend/src/pages/application/ApplicationPage.tsx`
- Modify: `frontend/src/lib/api.ts` (remove `createReport` + `ReportCreate`)
- Regenerate: `backend/openapi.json` (gitignored) → `frontend/src/lib/api.types.ts`
- Test: `frontend/src/pages/application/*` (update the existing Report test)

**Interfaces:**
- Consumes: `api.createWordBook(body: WordBookCreate) -> WordSessionRead`, `WordHandoffDialog` (already imported), the `wordSessionMutation` + `pendingWordSession` state (already present).

- [ ] **Step 1: Resync the generated types**

Run:
```
venv\Scripts\python.exe -X utf8 scripts\dump_openapi.py
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd frontend; pnpm run gen:api"
```
Expected: `api.types.ts` now has `WordBookCreate.signer_employee_id?/sign?/date?` and no `ReportCreate`. `tsc` will now FAIL where `api.ts` still references `ReportCreate` — that's Step 2.

- [ ] **Step 2: Remove `createReport` from the API client**

In `frontend/src/lib/api.ts`: delete the `export type ReportCreate = ...` line (781) and the `createReport: ...` method (1462).

- [ ] **Step 3: Rewire the Report submit in ApplicationPage**

In `frontend/src/pages/application/ApplicationPage.tsx`:
- Delete the `reportMutation` block (the `useMutation` calling `api.createReport`) and the `ReportCreate`/`createReport`-related imports.
- In `submitWithCommit`, replace the `if (isReportForm) { ... }` branch so Report submits through the Word handoff:
```tsx
    if (isReportForm) {
      return form.handleSubmit((values) => {
        wordSessionMutation.mutate({
          subject: String(values.subject ?? '').trim(),
          recipient_id: (values.recipient_id as number | null | undefined) ?? null,
          signer_employee_id: String(values.signer_id ?? ''),
          sign: values.sign !== false,
          date: (values.report_date as string | undefined) ?? null,
          cc: [],
        })
      })
    }
```
- In the action-row JSX, change the `isReportForm` button branch to the Word-create button (mirror the General Book Word button — Word-blue, label `books.word.createAndOpen`, disabled while `wordSessionMutation.isPending`), submitting the form (`type="submit"`, since `handleSave`/`handlePreview` route to the report branch above). The `WordHandoffDialog` is already mounted at the top of the component and opens when `pendingWordSession` is set by `wordSessionMutation.onSuccess`.
- Remove now-dead report-only helpers (the `isReportForm` one-shot Save button, any `arabic_rich_full`-width special-casing that only served Report).

- [ ] **Step 4: Typecheck + update the frontend test**

Run: `pnpm -C frontend exec tsc -b --noEmit`
Expected: PASS. Then update `frontend/src/components/application/TemplateForm.reportDiscriminator.test.tsx` (and any `ApplicationPage` test): assert the Report form renders **no** rich editor and that submitting calls `createWordBook` with `signer_employee_id` (not `createReport`). Run:
`pnpm -C frontend exec vitest run src/components/application/TemplateForm.reportDiscriminator.test.tsx src/pages/application`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

Run: `pnpm -C frontend run lint`. Then:
```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.types.ts frontend/src/pages/application/ApplicationPage.tsx frontend/src/components/application/TemplateForm.reportDiscriminator.test.tsx
git commit -m "feat(report): author body in Word — remove HugeRTE from the Report form"
```

---

### Task 9: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite + gates**

Run: `venv\Scripts\python.exe -m pytest backend/tests -q`, `venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .`, `venv\Scripts\mypy.exe`
Expected: green (known pre-existing `test_dav` flake / main mypy baseline aside).

- [ ] **Step 2: Frontend gates**

Run: `pnpm -C frontend exec tsc -b --noEmit`, `pnpm -C frontend run lint`, `pnpm -C frontend test`
Expected: green.

- [ ] **Step 3: Live smoke against a copy-DB instance (no prod touch)**

Build the frontend (`pnpm -C frontend run build`), launch a throwaway backend on a spare port against a COPY of `data/gssg.db` (`GSSG_DATA_DIR=<copy> GSSG_PORT=8799 GSSG_HOST=127.0.0.1 GSSG_SECURE_COOKIES=0 venv\Scripts\python.exe backend\serve.py`), and in a browser (mint an admin session cookie) verify:
  - Report tile → form shows Signer / To / Subject / Date / Sign now and **no** rich editor.
  - "Create & open in Word →" creates a `REPORT-N` book + opens the `WordHandoffDialog`; the working docx is served over `/dav/...`.
  - Simulate a Word save (PUT to the working file, or edit + save in Word), then Finish → record appears at the **top** of Records (local `created_at`) with the 📊 "Report" badge; the PDF renders; with a seeded signer signature the signature is present.
  - Discard on an unfinished Report voids it.

- [ ] **Step 4: Resync check + finish-branch note**

Confirm `backend/openapi.json` + `frontend/src/lib/api.types.ts` are in sync (re-run the dump + gen; `git diff` should be empty). Confirm `venv\Scripts\alembic.exe heads` shows the single head `0064`.

- [ ] **Step 5: Final commit (if any verification fixups)**

```bash
git add -A
git commit -m "test(report): verify Word-authored Report end to end"
```

---

## Notes & out of scope

- **General Book behavior is unchanged** — the dispatch only diverges when `signer_employee_id` is present; `finish_word_session` only diverges on a `REPORT-` ref. (Aside: General Book Word books also stamp `created_at` from the UTC model default — a latent sort quirk shared with the old Report bug — but fixing GB is out of scope here.)
- **No revise flow for Report.** The shared reopen endpoint still exists; a reopened Report's re-finish keeps `template_id="Report"` but won't re-embed the signature (new session has no `signer_employee_id`). Accepted.
- **Deploy:** backend + frontend + migration `0064`. Ship via `/sync-api-types` (already done in Task 8) → commit → push → `mng update` (runs `alembic upgrade head` + rebuild). This branch stacks on `fix/report-template-qa`; land that first (or together).
