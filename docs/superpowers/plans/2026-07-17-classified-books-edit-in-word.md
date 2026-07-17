# Classified Books + Edit-in-Word Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-17-classified-books-edit-in-word-design.md` — read it before starting any task.

**Goal:** Government-classified General Book sub-templates whose body is written in real desktop Word via a token-authed WebDAV endpoint + `ms-word:` links, with the classified ref counter, drafts/voided states, records integration, per-session versions, and FTS5 body search.

**Architecture:** The docx is the source of truth — no HTML↔DOCX conversion on this path. A small FastAPI WebDAV router (token-in-URL auth, mounted WITHOUT the session-cookie auth gate) serves a per-session working docx that desktop Word opens via `ms-word:ofe|u|https://gssg.lan/dav/...`. "Finish" turns the working file into the next `BookVersion` + PDF via the existing Word-COM chain. Classified refs come from a new single-row counter mirroring `BookRefSequence`. Body search extends the proven `0014_ledger_fts5` FTS5 pattern to books.

**Tech Stack:** FastAPI, SQLAlchemy/Alembic (SQLite, FTS5), docxtpl via `core/docx_render.py`, python-docx, React 19 + React Query + react-hook-form, i18next.

## Global Constraints

- **This checkout is live production.** Work on branch `feature/word-books`; merge to `main` only when the milestone gates pass. Never push broken `main`.
- All Python via `venv\Scripts\python.exe`; frontend via `pnpm -C frontend`.
- Gates are strict: `venv\Scripts\mypy.exe` (strict), `venv\Scripts\ruff.exe check .`, pytest runs with `filterwarnings=error`; `pnpm -C frontend exec tsc -b --noEmit`, `pnpm -C frontend run lint`.
- **Single linear Alembic head.** New revisions: `0056_word_books.py` (down_revision="0055"), `0057_books_fts.py` (down_revision="0056"). Use `op.batch_alter_table` for column adds; run the `alembic-migration-reviewer` agent after each migration task.
- **i18n:** every new string in BOTH `frontend/src/locales/en.json` and `ar.json`; tests assert the **Arabic** string under `lng=ar`. Logical CSS only (`ms-`/`me-`, `text-start`). Refs render inside `<bdi dir="ltr">`.
- **Ref format (canonical, user-locked):** bare stored ref `1/{tab}/GSSG/{serial}` (e.g. `1/5/GSSG/141`); templates render the label as `الرقم: {{ ref }}` at 13pt bold. One shared serial across all classifications, no yearly reset.
- **Word-brand blue (`#185abd`) is reserved for open-in-Word actions only** (mockup: `docs/classified-books-edit-in-word-mockup.html`).
- After any backend schema/route change: `/sync-api-types` (dump openapi → `pnpm gen:api` → typecheck) and commit `api.types.ts` together with the backend change (final resync in Task 13 covers drift).
- `backend/templates/*.docx` churn: only commit intentional template additions; revert incidental churn.
- **After frontend/backend contract tasks**, the executor sees only their task — the **Interfaces** block in each task is the contract; do not rename without updating dependents.

---

## Milestone M0 — data foundations + Word↔WebDAV proof

### Task 1: Migration 0056 + models (classification, sessions, classified counter)

**Files:**
- Modify: `backend/app/db/models.py` (Book class ~line 135; add two new classes near `BookRefSequence` ~line 124)
- Create: `backend/app/db/migrations/versions/0056_word_books.py`
- Test: `backend/tests/test_word_books_models.py`

**Interfaces:**
- Produces: `Book.classification_code: str | None`, `Book.voided_at: datetime | None`, class `ClassifiedRefSequence(id, next_value)`, class `BookEditSession(id, book_id, user_id, token, working_path, state, created_at, last_put_at)` with partial unique index `uq_book_edit_sessions_active` (one `state='active'` row per book).

- [ ] **Step 1: Add model changes**

In `backend/app/db/models.py` — add to `Book` (after `approval_state`):

```python
    # Government classification (التبويب) code, e.g. "5/1"; NULL = plain book.
    classification_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Discarded draft: the reserved ref stays in the register, struck through.
    voided_at: Mapped[datetime | None] = mapped_column(nullable=True)
```

New classes (mirror `BookRefSequence` style):

```python
class ClassifiedRefSequence(Base):
    """Single-row counter for classified refs (1/{tab}/GSSG/{serial}); id always 1."""

    __tablename__ = "classified_ref_sequence"

    id: Mapped[int] = mapped_column(primary_key=True)
    next_value: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1
    )

    __table_args__ = (CheckConstraint("next_value >= 1", name="ck_classified_ref_min"),)


class BookEditSession(Base):
    """One Word-editing session over a book's working docx (WebDAV target)."""

    __tablename__ = "book_edit_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(
        ForeignKey("books.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    working_path: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(String(16), default="active")  # active|finished|discarded
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    last_put_at: Mapped[datetime | None] = mapped_column(nullable=True)

    __table_args__ = (
        Index(
            "uq_book_edit_sessions_active",
            "book_id",
            unique=True,
            sqlite_where=text("state = 'active'"),
        ),
    )
```

(Import `Index`/`text` if not already imported in models.py.)

- [ ] **Step 2: Write the migration** — scaffold with the `/new-migration` skill if available, else by hand:

```python
"""Word-books: classification + voided on books; edit sessions; classified counter.

Revision ID: 0056
Revises: 0055
"""

import sqlalchemy as sa
from alembic import op

revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("books") as batch:
        batch.add_column(sa.Column("classification_code", sa.String(16), nullable=True))
        batch.add_column(sa.Column("voided_at", sa.DateTime(), nullable=True))

    op.create_table(
        "classified_ref_sequence",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("next_value", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("next_value >= 1", name="ck_classified_ref_min"),
    )

    op.create_table(
        "book_edit_sessions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("book_id", sa.Integer(), nullable=False),  # FK enforced app-side (SQLite)
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("working_path", sa.Text(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_put_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "uq_book_edit_sessions_active",
        "book_edit_sessions",
        ["book_id"],
        unique=True,
        sqlite_where=sa.text("state = 'active'"),
    )


def downgrade() -> None:
    op.drop_index("uq_book_edit_sessions_active", table_name="book_edit_sessions")
    op.drop_table("book_edit_sessions")
    op.drop_table("classified_ref_sequence")
    with op.batch_alter_table("books") as batch:
        batch.drop_column("voided_at")
        batch.drop_column("classification_code")
```

- [ ] **Step 3: Write failing tests** (`backend/tests/test_word_books_models.py`; use the `db_session` fixture from conftest — it creates the schema from `Base.metadata`, so model changes are live without running alembic):

```python
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.db.models import Book, BookEditSession


def _book(db, ref="1/5/GSSG/900"):
    b = Book(category_id="GS", ref_number=ref, subject="t", classification_code="5/1")
    db.add(b)
    db.commit()
    return b


def test_book_classification_and_voided_roundtrip(db_session):
    b = _book(db_session)
    assert b.classification_code == "5/1"
    assert b.voided_at is None
    b.voided_at = datetime.now(timezone.utc)
    db_session.commit()
    assert db_session.get(Book, b.id).voided_at is not None


def test_only_one_active_session_per_book(db_session):
    b = _book(db_session)
    db_session.add(BookEditSession(book_id=b.id, user_id=1, token="t1", working_path="x"))
    db_session.commit()
    db_session.add(BookEditSession(book_id=b.id, user_id=1, token="t2", working_path="y"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
    # a finished session frees the slot
    s = db_session.query(BookEditSession).filter_by(book_id=b.id).one()
    s.state = "finished"
    db_session.commit()
    db_session.add(BookEditSession(book_id=b.id, user_id=1, token="t3", working_path="z"))
    db_session.commit()
```

- [ ] **Step 4: Run tests — expect FAIL first** (`AttributeError` / missing table), then implement Step 1 fully and re-run:
`venv\Scripts\python.exe -m pytest backend/tests/test_word_books_models.py -v` → PASS
- [ ] **Step 5: Apply migration to a scratch copy** — verify `venv\Scripts\alembic.exe upgrade head` on a copy of the DB (or a temp empty DB) succeeds and `alembic heads` shows exactly one head.
- [ ] **Step 6: Run the `alembic-migration-reviewer` agent** on 0056; fix findings.
- [ ] **Step 7: Gates + commit**

```bash
venv\Scripts\ruff.exe check backend && venv\Scripts\mypy.exe
git add backend/app/db/models.py backend/app/db/migrations/versions/0056_word_books.py backend/tests/test_word_books_models.py
git commit -m "feat(word-books): classification/voided columns, edit sessions, classified counter (0056)"
```

---

### Task 2: Classification registry + classified ref allocator

**Files:**
- Create: `backend/app/core/classifications.py`
- Create: `backend/app/db/repos/classified_refs_repo.py`
- Test: `backend/tests/test_classifications.py`

**Interfaces:**
- Produces:
  - `Classification(NamedTuple)` — `code: str` ("5/1"), `tab: int` (5), `name_ar: str`, `name_en: str`, `unit_ar: str`, `template: str` (docx filename in templates dir)
  - `CLASSIFICATIONS: tuple[Classification, ...]` (all 15)
  - `get_classification(code: str) -> Classification | None`
  - `classified_ref(tab: int, serial: int) -> str` → `"1/{tab}/GSSG/{serial}"`
  - `allocate_classified_serial(session: Session) -> int` — atomic, BEGIN-IMMEDIATE + retry, mirrors `refs_repo.allocate_ref_with_retry`; caller owns the commit.

- [ ] **Step 1: Failing tests**

```python
from app.core.classifications import CLASSIFICATIONS, classified_ref, get_classification
from app.db.repos.classified_refs_repo import allocate_classified_serial


def test_registry_has_all_15_codes():
    codes = [c.code for c in CLASSIFICATIONS]
    assert len(codes) == 15 and len(set(codes)) == 15
    assert "5/1" in codes and "15/1" in codes
    c = get_classification("5/1")
    assert c is not None and c.tab == 5 and c.name_ar == "التصاريح الأمنية"


def test_classified_ref_format():
    assert classified_ref(5, 141) == "1/5/GSSG/141"


def test_serial_is_shared_and_monotonic(db_session):
    a = allocate_classified_serial(db_session)
    db_session.commit()
    b = allocate_classified_serial(db_session)
    db_session.commit()
    assert b == a + 1
```

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_classifications.py -v` → FAIL (module not found).

- [ ] **Step 2: Implement `core/classifications.py`** — the 15 entries verbatim from the government index photo (names below are canonical; unit values: `الشؤون الإدارية والمالية`, `الصيانة`, `شؤون النزلاء`). All map to the standard template until the user authors specials:

```python
"""Government classification index (التبويب) for classified General Books."""

from typing import NamedTuple

STANDARD_TEMPLATE = "GSSG-GS_301-001_Classified_Standard.docx"


class Classification(NamedTuple):
    code: str
    tab: int
    name_ar: str
    name_en: str
    unit_ar: str
    template: str


_ADMIN = "الشؤون الإدارية والمالية"

CLASSIFICATIONS: tuple[Classification, ...] = (
    Classification("1/1", 1, "الغيابات دون عذر رسمي", "Unexcused absences", _ADMIN, STANDARD_TEMPLATE),
    Classification("2/1", 2, "محاضر الإجتماع وجدول الإجتماع الشهري", "Meeting minutes & monthly schedule", _ADMIN, STANDARD_TEMPLATE),
    Classification("3/1", 3, "الإجازات السنوية", "Annual leaves", _ADMIN, STANDARD_TEMPLATE),
    Classification("4/1", 4, "الإجازات المرضية", "Sick leaves", _ADMIN, STANDARD_TEMPLATE),
    Classification("5/1", 5, "التصاريح الأمنية", "Security permits", _ADMIN, STANDARD_TEMPLATE),
    Classification("6/1", 6, "الإحصائيات والتقارير الشهرية", "Statistics & monthly reports", _ADMIN, STANDARD_TEMPLATE),
    Classification("7/1", 7, "الشؤون المالية بشكل عام", "Financial affairs", _ADMIN, STANDARD_TEMPLATE),
    Classification("8/1", 8, "شهادات الرواتب وطلبات جواز السفر", "Salary certificates & passport requests", _ADMIN, STANDARD_TEMPLATE),
    Classification("9/1", 9, "العهدة والملابس والبطاقات التعريفية", "Custody, clothing & ID cards", _ADMIN, STANDARD_TEMPLATE),
    Classification("10/1", 10, "جرد المواد الإستهلاكية", "Consumables inventory", _ADMIN, STANDARD_TEMPLATE),
    Classification("11/1", 11, "أعمال الصيانة", "Maintenance works", "الصيانة", STANDARD_TEMPLATE),
    Classification("12/1", 12, "شؤون القوة", "Force affairs", _ADMIN, STANDARD_TEMPLATE),
    Classification("13/1", 13, "شؤون النزلاء والأمانات", "Inmates affairs & deposits", "شؤون النزلاء", STANDARD_TEMPLATE),
    Classification("14/1", 14, "العيادة", "Clinic", "شؤون النزلاء", STANDARD_TEMPLATE),
    Classification("15/1", 15, "( متنوعة )", "(Miscellaneous)", _ADMIN, STANDARD_TEMPLATE),
)

_BY_CODE = {c.code: c for c in CLASSIFICATIONS}


def get_classification(code: str) -> Classification | None:
    return _BY_CODE.get(code)


def classified_ref(tab: int, serial: int) -> str:
    return f"1/{tab}/GSSG/{serial}"
```

- [ ] **Step 3: Implement `db/repos/classified_refs_repo.py`** — open `backend/app/db/repos/refs_repo.py` first and mirror its BEGIN-IMMEDIATE/retry structure exactly (same retry counts and exception handling), operating on `ClassifiedRefSequence` with id=1: read row (create with `next_value=1` if missing), return current value, increment. Caller commits (atomic with the Book insert).
- [ ] **Step 4: Run tests** → PASS. Gates (`ruff`, `mypy`).
- [ ] **Step 5: Commit** `feat(word-books): classification registry + shared classified serial allocator`

---

### Task 3: `public_base_url` setting + WebDAV router

**Files:**
- Modify: `backend/app/config.py` (Settings class, ~line 55)
- Create: `backend/app/api/dav.py`
- Modify: `backend/app/main.py` (mount WITHOUT `auth_gate`, no `/api/v1` prefix)
- Create: `backend/app/services/word_session_repo.py` (tiny token lookup used by dav.py; the full service comes in Task 5)
- Test: `backend/tests/test_dav.py`

**Interfaces:**
- Consumes: `BookEditSession` (Task 1).
- Produces:
  - Setting `public_base_url: str = "https://gssg.lan"` (env `GSSG_PUBLIC_BASE_URL`)
  - `word_session_repo.get_active_session_by_token(db, token) -> BookEditSession | None`
  - `word_session_repo.record_put(db, session_id: int) -> None` (sets `last_put_at`, commits)
  - Routes under `/dav/{token}/{filename}`: `OPTIONS, HEAD, GET, PUT, LOCK, UNLOCK, PROPFIND` — Word's exact needs:
    - `OPTIONS` → 200 with headers `DAV: 1,2`, `MS-Author-Via: DAV`, `Allow: OPTIONS, GET, HEAD, PUT, LOCK, UNLOCK, PROPFIND`
    - `GET/HEAD` → `FileResponse` of `working_path` (404 if token unknown/closed)
    - `PUT` → write to `working_path + ".tmp"` then `os.replace`; update `last_put_at`; 204
    - `LOCK` → 200, XML `lockdiscovery` body + `Lock-Token: <opaquelocktoken:{token}>` header (we enforce single-editor at the session layer; this is a formality Word requires)
    - `UNLOCK` → 204
    - `PROPFIND` → 207 multistatus XML for the single file (displayname, getcontentlength, getlastmodified in RFC1123, empty resourcetype)

- [ ] **Step 1: Failing tests** — simulate Word's verb sequence with the FastAPI TestClient (find how existing route tests build a client in `backend/tests/` — e.g. the pattern used by books route tests — and reuse it; the DAV router must be reachable WITHOUT login cookies):

```python
def test_word_dav_roundtrip(client, db_session, tmp_path):
    # seed a book + active session pointing at a real file
    p = tmp_path / "letter.docx"
    p.write_bytes(b"PK-original")
    sess = _make_session(db_session, working_path=str(p), token="tok123")

    r = client.options("/dav/tok123/letter.docx")
    assert r.status_code == 200
    assert r.headers["dav"] == "1,2"
    assert r.headers["ms-author-via"] == "DAV"

    r = client.request("LOCK", "/dav/tok123/letter.docx", content=b"<lockinfo/>")
    assert r.status_code == 200 and "opaquelocktoken" in r.headers["lock-token"]

    r = client.get("/dav/tok123/letter.docx")
    assert r.status_code == 200 and r.content == b"PK-original"

    r = client.put("/dav/tok123/letter.docx", content=b"PK-edited")
    assert r.status_code == 204
    assert p.read_bytes() == b"PK-edited"

    r = client.request("PROPFIND", "/dav/tok123/letter.docx")
    assert r.status_code == 207 and b"getcontentlength" in r.content

    r = client.request("UNLOCK", "/dav/tok123/letter.docx")
    assert r.status_code == 204


def test_dav_rejects_bad_or_closed_token(client, db_session, tmp_path):
    assert client.get("/dav/nope/x.docx").status_code == 404
    p = tmp_path / "l.docx"; p.write_bytes(b"PK")
    sess = _make_session(db_session, working_path=str(p), token="tok9", state="finished")
    assert client.put("/dav/tok9/l.docx", content=b"X").status_code == 404
```

Run → FAIL (404 everywhere / router missing).

- [ ] **Step 2: Implement.** `dav.py` uses `APIRouter()` with `@router.api_route("/dav/{token}/{filename}", methods=[...])` (one handler dispatching on `request.method` is simplest and keeps the token check in one place). PUT reads `await request.body()` (30 MiB global cap is ample). PROPFIND body (fill size/mtime from `os.stat`):

```xml
<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
 <D:response>
  <D:href>/dav/{token}/{filename}</D:href>
  <D:propstat><D:prop>
    <D:displayname>{filename}</D:displayname>
    <D:getcontentlength>{size}</D:getcontentlength>
    <D:getlastmodified>{http_date}</D:getlastmodified>
    <D:resourcetype/>
  </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
 </D:response>
</D:multistatus>
```

In `main.py`: `app.include_router(dav.router)` — **no prefix, no `auth_gate`** (add a one-line comment: token-in-URL auth; Word's HTTP stack sends no cookies).
Config: add `public_base_url: str = "https://gssg.lan"` to `Settings`.

- [ ] **Step 3: Run tests** → PASS. Gates. 
- [ ] **Step 4: Commit** `feat(word-books): WebDAV endpoint for Word editing sessions + public_base_url setting`

---

### Task 4: M0 proof — real Word on a real office PC (**STOP / user checkpoint**)

**Files:**
- Create: `backend/scripts/word_dav_proof.py`

**Interfaces:** Consumes Task 1 models + Task 3 router. Produces a go/no-go decision.

- [ ] **Step 1: Write the proof script** — creates (against the REAL dev-run DB via `SessionLocal`) a scratch `Book` (`category_id="GS"`, `ref_number="PROOF-<timestamp>"`), copies any small real docx (e.g. from `backend/templates/`) into `settings.data_dir / "editing" / proof.docx`, inserts an active `BookEditSession` with `token=secrets.token_urlsafe(32)`, prints:
  - the raw URL `{public_base_url}/dav/{token}/proof.docx`
  - the launch URL `ms-word:ofe|u|{public_base_url}/dav/{token}/proof.docx`
  Guard with `if __name__ == "__main__":` (multiprocessing gotcha).
- [ ] **Step 2: Manual checklist (run with the operator on an office PC, service deployed on the branch or run locally on the LAN):**
  1. Paste the `ms-word:` URL in Run/browser → Word opens the file over HTTPS (cert already trusted via gssg.lan CA).
  2. Type a line, Ctrl+S → server file changes (check mtime/content), `last_put_at` set.
  3. Close Word, reopen via the same URL → edits persisted.
  4. Note any Word sign-in/trust prompts and whether save is instant or delayed.
- [ ] **Step 3: STOP.** Report results to the user. **If Word's DAV client fails after reasonable header tweaks → switch transport to the SMB fallback per spec (same session model; only dav.py's transport is replaced) — that is a plan revision, do not push on.** If it works: commit `chore(word-books): M0 word-dav proof script` and continue.

---

## Milestone M1 — classified creation pipeline

### Task 5: `word_book_service` — create classified book + working docx

**Files:**
- Create: `backend/app/services/word_book_service.py`
- Create: `backend/templates/GSSG-GS_301-001_Classified_Standard.docx` (placeholder: programmatically built minimal docx with the tokens; the user replaces it with the real government layout — mark it clearly)
- Test: `backend/tests/test_word_book_service.py`

**Interfaces:**
- Consumes: Task 2 registry/allocator; `core/docx_render.py::render` (**read its exact signature first** — it is the generic docxtpl engine; adjust calls to match), `document_service`'s recipient/manager resolution (**read `_build_template_data` lines ~610-802** — extract/reuse its recipient_id→name and manager block resolution; if private, lift the needed queries into this service rather than importing privates).
- Produces:

```python
@dataclass
class WordSessionInfo:
    book_id: int
    ref_number: str
    token: str
    filename: str        # ref slug: ref.replace("/", "-") + ".docx"
    word_url: str        # f"ms-word:ofe|u|{settings.public_base_url}/dav/{token}/{filename}"
    dav_url: str

def create_word_book(
    db: Session, *, user: User, classification_code: str | None,
    recipient_id: int | None, subject: str, cc: list[str] | str | None,
    manager_id: int | None,
) -> WordSessionInfo
```

Behavior:
1. If `classification_code`: registry lookup (unknown → `AppError("UNKNOWN_CLASSIFICATION", 422)`); template file must exist on disk (`AppError("TEMPLATE_MISSING", http_status=409)` naming the file). Ref = `classified_ref(tab, allocate_classified_serial(db))`. If `None`: ref via existing `refs_repo.allocate_ref_with_retry(db, "GS")`, template = the General Book docx (Task 12 wires the UI; service supports it now).
2. Insert `Book(category_id="GS", ref_number=ref, subject=subject, classification_code=..., approval_state="none", submitted_by_user_id=user.id, doc_manager_id=manager_id)`; flush.
3. Render the working docx with `docx_render.render` into `settings.data_dir / "editing" / f"book-{book.id}" / filename` — data dict: `ref`, `date` (today `dd/mm/yyyy`), `recipient_name` (resolved), `subject`, `cc` (same normalization as `_adapt_general_book` — read `docx_engine.py:280-337`), manager name/title (same tokens the General Book template uses — inspect the GB `_fields.json`/template tokens and reuse EXACT token names), `submitter_g` (author G-number, same as GB footer).
4. Insert `BookEditSession(token=secrets.token_urlsafe(32), working_path=..., state="active")`. Commit once (ref+book+session atomic).

- [ ] **Step 1: Failing tests** — create (a) success path: returns WordSessionInfo, Book row exists with classified ref `1/5/GSSG/1`, session active, working file exists and unzips as docx containing the ref string (`python-docx` open → any paragraph contains `1/5/GSSG/1`); (b) two creates → serials 1,2 across DIFFERENT classifications; (c) unknown code → 422; (d) template file missing (point `settings.templates_dir` at tmp) → 409; (e) second create while... (no conflict at create; new book each time).
- [ ] **Step 2: Build the placeholder standard template** in a tiny script inside the test (python-docx: paragraphs `الرقم: {{ ref }}`, `التاريخ: {{ date }}`, `السيد / {{ recipient_name }}`, `الموضوع: {{ subject }}`, guide paragraph, `{{ cc }}`) and ALSO commit a copy at `backend/templates/GSSG-GS_301-001_Classified_Standard.docx` (generated by `backend/scripts/make_classified_placeholder.py`, kept for the user to replace with the real letterhead layout).
- [ ] **Step 3: Implement; run tests** → PASS. Gates.
- [ ] **Step 4: Commit** `feat(word-books): create classified/word books with working docx + edit session`

### Task 6: Routes — classifications list, create word-session, BookRead additions

**Files:**
- Modify: `backend/app/api/v1/books.py`
- Test: `backend/tests/test_word_book_routes.py`

**Interfaces:**
- Consumes: Task 5 service; `require_capability("books.manage")` (deps.py).
- Produces (all under `/api/v1`):
  - `GET /books/classifications` → `{"items": [{"code","tab","name_ar","name_en","unit_ar"}]}` (any authenticated user)
  - `POST /books/word-sessions` body `WordBookCreate {classification_code: str | null, recipient_id: int | null, subject: str, cc: list[str] = [], manager_id: int | null}` → 201 `WordSessionRead {book_id, ref_number, token, filename, word_url, dav_url}` (books.manage)
  - `BookRead` gains: `classification_code: str | None`, `voided_at: datetime | None`, `edit_session: BookEditSessionRead | None` (`{user_id, user_name, state, last_put_at, created_at}` — active session only), `is_draft: bool` (computed: no versions AND not voided).
- **Pydantic schema changes ⇒ this task ends with `/sync-api-types`** (regenerate + commit `openapi.json` if tracked / `api.types.ts`).

- [ ] **Step 1: Failing route tests** (reuse books route-test client pattern + `make_user` with role="manager"): classifications returns 15; POST creates and returns `word_url` starting `ms-word:ofe|u|https://`; permission denied for plain operator without books.manage → 403; BookRead for the new book has `is_draft=True`, `classification_code="5/1"`, `edit_session.user_id` set.
- [ ] **Step 2: Implement** (routes thin — delegate to service; `edit_session`/`is_draft` filled in the existing Book→BookRead mapping site). 
- [ ] **Step 3: Tests PASS; gates; `/sync-api-types`; commit** `feat(word-books): word-session + classifications endpoints, BookRead draft/session fields`

### Task 7: Finish / discard — version, PDF, voided

**Files:**
- Modify: `backend/app/services/word_book_service.py`
- Modify: `backend/app/api/v1/books.py`
- Test: `backend/tests/test_word_book_finish.py`

**Interfaces:**
- Produces:

```python
def finish_word_session(db: Session, *, user: User, book_id: int) -> Book
def discard_word_session(db: Session, *, user: User, book_id: int) -> Book
```

  - Routes: `POST /books/{book_id}/word-sessions/finish` → 200 BookRead; `DELETE /books/{book_id}/word-sessions` → 200 BookRead (both `books.manage`).
- Behavior — finish: active session required (else 409 `NO_ACTIVE_SESSION`); `last_put_at` required (else 409 `NO_SAVES_YET`); move working docx → `data_dir/output/General_Book/` using the existing `_build_docx_filename` convention (read `document_service.py:360-373`); create `Document(template_id="Classified Book" | "General Book", ref_number=book.ref_number, docx_path=...)`; PDF via `services/_pdf_executor.convert_docx_to_pdf` (in tests monkeypatch it the way existing document tests do — find the existing monkeypatch pattern in backend/tests and copy it); create `BookVersion(version_no=max+1 or 1, trigger="initial" if first else "revision", status="none", document_id=..., created_by_user_id=user.id)`; session `state="finished"`; commit. Book stays `approval_state="none"` → normal records lifecycle (send for approval / signed-copy filing untouched).
- Discard: active session required; delete working file (lenient); `state="discarded"`; if book has zero versions → `voided_at=now` (draft becomes voided, ref preserved); commit.

- [ ] **Step 1: Failing tests:** finish without PUT → 409; simulate PUT (set `last_put_at`, write bytes) → finish creates version_no=1 + Document row with docx moved + session finished; second session→finish → version_no=2; discard draft → voided_at set, session discarded, working file gone; discard after versions exist → NOT voided; finish by non-owner WITH books.manage allowed.
- [ ] **Step 2: Implement; PASS; gates; `/sync-api-types`; commit** `feat(word-books): finish→version+PDF, discard→voided draft`

### Task 8: Frontend — api methods + classification picker + Word-mode create

**Files:**
- Modify: `frontend/src/lib/api.ts` (follow the `request<T>('POST', '/books', body)` pattern ~line 1199)
- Modify: `frontend/src/components/application/TemplateForm.tsx` + parent submit site (ApplicationPage — find where `api.generateDocument` is called and branch)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/components/application/ClassificationField.test.tsx`

**Interfaces:**
- Consumes: Task 6/7 endpoints via regenerated `api.types.ts`.
- Produces:
  - `api.listBookClassifications()`, `api.createWordBook(body)`, `api.finishWordSession(bookId)`, `api.discardWordSession(bookId)`
  - New `ClassificationField` component (Radix Select fed by `useQuery({queryKey: ['books','classifications'], queryFn: api.listBookClassifications, staleTime: Infinity})`; options `{code} — {name_ar}` with unit as secondary text; first option `بدون تبويب`).
  - TemplateForm General-Book branch: when a classification is selected → hide the `arabic_rich_full` body field and show the Word info panel; parent submit calls `api.createWordBook` instead of `generateDocument`, then `window.location.href = res.word_url` and opens the handoff dialog (Task 9).
- i18n keys (both files; Arabic wording from the approved mockup):
  - `books.word.classification` = "التبويب" / "Classification"
  - `books.word.noClassification` = "بدون تبويب" / "No classification"
  - `books.word.bodyInWord` = "نص الكتاب يُكتب في Word" / "The body is written in Word"
  - `books.word.createAndOpen` = "إنشاء وفتح في Word" / "Create & open in Word"

- [ ] **Step 1: Failing vitest** — render `ClassificationField` under `lng=ar` (use the SelectField.test.tsx provider pattern + `i18n.addResourceBundle('ar', ...)`): asserts the **Arabic** label "التبويب" and option "بدون تبويب" render; selecting a code calls `onChange("5/1")`. Mock the query with a QueryClient + mocked api module.
- [ ] **Step 2: Implement; test PASS; `pnpm -C frontend exec tsc -b --noEmit`; lint.**
- [ ] **Step 3: Commit** `feat(word-books): classification picker + create-and-open-in-Word flow`

### Task 9: Frontend — handoff ticket dialog

**Files:**
- Create: `frontend/src/pages/books/WordHandoffDialog.tsx`
- Modify: creation flow from Task 8 to open it; locales
- Test: `frontend/src/pages/books/WordHandoffDialog.test.tsx`

**Interfaces:**
- Produces: `<WordHandoffDialog book={...} sessionInfo={...} open onFinished={...} onDiscarded={...} />` — the mockup's "بطاقة الرقم المحجوز": letterhead strip, red rotated ref stamp (`<bdi dir="ltr">` around the ref), classification + date + author line, 3 steps, footer actions: **إنهاء التحرير** (primary; disabled until a poll of the book's `edit_session.last_put_at` is non-null — poll `['books', bookId]` every 5s while open, with the disabled-hint `books.word.noSavesYet` = "لم يصل أي حفظ من Word بعد"), **فتح Word مجدداً** (Word-blue ghost; re-navigates to `word_url`), **تجاهل** (ConfirmDialog → `api.discardWordSession`). Finish → `api.finishWordSession` → invalidate `['books']` → success toast with ref.
- i18n keys: `books.word.reserved` = "تم إنشاء الكتاب وحجز الرقم", `books.word.openAgain` = "فتح Word مجدداً", `books.word.finish` = "إنهاء التحرير", `books.word.discard` = "تجاهل", `books.word.discardConfirm` = "سيصبح الكتاب ملغياً ويبقى رقمه محفوظاً في السجل. متابعة؟", steps 1–3 strings per mockup (+ English counterparts).

- [ ] **Step 1: Failing vitest (lng=ar):** renders the Arabic ref inside a `bdi[dir=ltr]`; Finish disabled with hint when `last_put_at` null, enabled when set; discard confirm fires the api call (mock api + QueryClient).
- [ ] **Step 2: Implement (mirror mockup markup/classes with app components); PASS; tsc/lint; commit** `feat(word-books): reserved-ref handoff dialog`

### Task 10: Frontend — records surfaces (chips, drafts, actions on BOTH surfaces)

**Files:**
- Modify: `frontend/src/pages/books/BooksPage.tsx` (desktop rows + filters + drafts group)
- Modify: `frontend/src/pages/books/RecordPane.tsx` (desktop detail)
- Modify: `frontend/src/pages/books/BookRecordPage.tsx` (mobile detail — the standing two-surfaces rule)
- Modify: locales
- Test: `frontend/src/pages/books/BookWordActions.test.tsx`

**Interfaces:**
- Consumes: `BookRead.is_draft / voided_at / classification_code / edit_session` from api.types; api methods from Task 8.
- Produces: shared `BookWordActions` component (buttons: فتح في Word [Word-blue, desktop-only — detect via existing mobile/desktop split the pages already use; on mobile render disabled with hint `books.word.needsPc` = "التحرير في Word يتطلب جهاز كمبيوتر مثبّت عليه Word"], إنهاء التحرير, تجاهل) used by BOTH RecordPane and BookRecordPage; BooksPage: drafts group card above the list (dashed, `bg-surface-raised`) listing `is_draft && !voided_at` books with continue/finish/discard; inline draft rows tinted with chips `مسودة — رقم محجوز` (amber) / `قيد التحرير` (info, when `edit_session`) ; voided rows struck-through + `ملغي` (red chip); classification chip `"{code} {name_ar}"` (navy) on classified rows; filter pill `المسودات`. Query invalidation: `qc.invalidateQueries({ queryKey: ['books'] })` after every action.
- i18n keys: `books.word.draft` = "مسودة — رقم محجوز", `books.word.editing` = "قيد التحرير", `books.word.editingBy` = "قيد التحرير في Word بواسطة {{name}}", `books.word.voided` = "ملغي", `books.word.openInWord` = "فتح في Word", `books.word.continueWriting` = "متابعة الكتابة", `books.filters.drafts` = "المسودات" (+ EN).

- [ ] **Step 1: Failing vitest (lng=ar):** `BookWordActions` renders the three Arabic actions for a draft with an active session; renders disabled Word button + hint on mobile prop; voided book renders no actions. Chips: a draft row shows "مسودة — رقم محجوز".
- [ ] **Step 2: Implement across the three files; PASS; tsc/lint; commit** `feat(word-books): drafts group, record chips, Word actions on both surfaces`

**Milestone M1 gate:** full `pytest`, `mypy`, `ruff`, vitest, tsc, eslint green; manual smoke on the branch: create classified book from the UI on an office PC → Word opens → write → Finish → PDF appears in the record; draft/discard/voided visible per mockup.

---

## Milestone M2 — re-edit + plain-GB Word option + polish

### Task 11: Re-edit sessions (version N+1)

**Files:**
- Modify: `backend/app/services/word_book_service.py`, `backend/app/api/v1/books.py`
- Modify: `frontend/src/pages/books/RecordPane.tsx`, `BookRecordPage.tsx` (add "تعديل في Word (ينشئ إصداراً جديداً)" for non-draft books via `BookWordActions`)
- Test: `backend/tests/test_word_book_reopen.py` + extend `BookWordActions.test.tsx`

**Interfaces:**
- Produces: `reopen_word_session(db, *, user, book_id) -> WordSessionInfo`; route `POST /books/{book_id}/word-sessions` → 201 WordSessionRead (409 `SESSION_ACTIVE` if one exists; 409 `NO_SOURCE_DOCX` if the latest version's document/docx is missing; copies the latest version's docx into a fresh working file).
- i18n: `books.word.editNewVersion` = "تعديل في Word (ينشئ إصداراً جديداً)".

- [ ] Steps: failing backend tests (reopen copies latest docx; finish → version_no=2 while v1's Document untouched; 409s) → implement → PASS → frontend button both surfaces + AR test → `/sync-api-types` → gates → commit `feat(word-books): re-edit in Word creates the next version`.

### Task 12: Plain General Book — body-mode toggle

**Files:**
- Modify: `frontend/src/components/application/TemplateForm.tsx` (+ parent submit branch)
- Modify: locales; Test: extend Task 8's test file

**Interfaces:** Consumes `create_word_book(classification_code=None)` (already live since Task 5/6). Produces: pill toggle on the General Book form body field — `اكتب هنا` (default; HugeRTE, existing generate path unchanged) / `اكتب في Word` (hides editor; submit → `api.createWordBook({classification_code: null, ...})` → handoff dialog). i18n: `books.word.writeHere` = "اكتب هنا", `books.word.writeInWord` = "اكتب في Word".

- [ ] Steps: failing vitest (toggle renders AR labels; Word mode hides the rich editor) → implement → PASS → gates → commit `feat(word-books): plain General Book optional write-in-Word`.

### Task 13: M2 polish gate

- [ ] Run `/sync-api-types` final pass; commit types with any drift.
- [ ] Dispatch the **i18n-rtl-reviewer** agent over the full branch diff; fix findings (Arabic-leak class bugs especially).
- [ ] Full gates: `venv\Scripts\python.exe -m pytest` • `mypy` • `ruff check` • `pnpm -C frontend test` • `tsc -b --noEmit` • `lint`.
- [ ] Verify no unintentional `backend/templates/*.docx` churn in `git status` (revert churn; keep only the new classified template).
- [ ] Commit `chore(word-books): M2 gate — types resync + i18n review fixes`.

---

## Milestone M3 — body search (FTS5)

### Task 14: Migration 0057 — `books.search_text` + `books_fts`

**Files:**
- Modify: `backend/app/db/models.py` (Book: `search_text: Mapped[str | None] = mapped_column(Text, nullable=True)`)
- Create: `backend/app/db/migrations/versions/0057_books_fts.py`
- Test: `backend/tests/test_books_fts_migration.py` (FTS virtual table + triggers behave on a raw sqlite connection)

**Interfaces:** Produces `books_fts` — copy the `0014_ledger_fts5.py` pattern EXACTLY (external content table, ai/ad/au triggers with the delete+insert update pattern, final `rebuild`):

```sql
CREATE VIRTUAL TABLE books_fts USING fts5(
  search_text,
  content='books',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
```

- [ ] Steps: write failing test (insert Book with search_text → `SELECT rowid FROM books_fts WHERE books_fts MATCH ?` finds it; update + delete stay in sync via triggers) → write migration + model column → PASS → `alembic-migration-reviewer` agent → gates → commit `feat(word-books): books_fts search index (0057)`.

### Task 15: Text extraction + wiring + backfill

**Files:**
- Create: `backend/app/core/book_text.py`
- Modify: `backend/app/services/word_book_service.py` (finish sets `book.search_text`)
- Modify: `backend/app/services/document_service.py` (Book-creation site ~line 1350: set `search_text` for HugeRTE books from subject+ref+HTML-stripped body)
- Create: `backend/scripts/backfill_book_search.py`
- Test: `backend/tests/test_book_text.py`

**Interfaces:**
- Produces:

```python
def normalize_ar(text: str) -> str   # strip tatweel ("ـ"), unify أإآ→ا, ى→ي, ة→ه, collapse whitespace
def docx_to_text(path: Path) -> str  # python-docx: paragraphs + table cells, joined by "\n"
def html_to_text(html: str) -> str   # lxml text_content()
def build_search_text(*, subject: str | None, ref: str, body: str) -> str  # normalized concat
```

- [ ] Steps: failing tests — `normalize_ar("الأَقْفال")` finds-equal to `normalize_ar("الاقفال")`; `docx_to_text` returns table-cell text; finish() populates `book.search_text` containing the normalized body; MATCH via `books_fts` with an alef-variant query returns the book → implement → PASS. Backfill script (`__main__`-guarded): iterate books, latest version → docx (or HugeRTE `fields["body"]` HTML), skip+log missing files, commit batches of 100 → run once on the dev DB → gates → commit `feat(word-books): body text extraction + FTS wiring + backfill`.

### Task 16: Search endpoint + snippet + frontend

**Files:**
- Modify: `backend/app/api/v1/books.py` (list endpoint `q` handling) + the books repo/service the list uses (locate the current `q` filter implementation and extend it there)
- Modify: `frontend/src/pages/books/BooksPage.tsx` (server-backed search + snippet line), locales
- Test: `backend/tests/test_books_search.py`, extend BooksPage tests

**Interfaces:**
- Backend: when `q` is present — normalize with `normalize_ar`, query `books_fts MATCH :q ORDER BY rank` (append `*` to the final token for prefix typing) for ids + `snippet(books_fts, 0, '[', ']', '…', 12)`; UNION with the existing ref/subject LIKE (full slashed refs like `1/5/GSSG/141` don't tokenize; LIKE covers them). `BookRead` gains `search_snippet: str | None` (set only on FTS body hits) ⇒ `/sync-api-types`.
- Frontend: desktop search box switches from client-side filtering to a debounced (300ms, mirror `BooksFilterBar`) server query `['books','search', q]` when `q.trim().length >= 2`; body-hit rows render the snippet (muted, `[`/`]` → `<mark>`) under the subject. i18n: `books.search.bodyMatch` = "تطابق في نص الكتاب".

- [ ] Steps: failing backend tests — Arabic body word with alef variant finds the book and returns a snippet; ref LIKE `1/5/GSSG/141` still matches; empty q unchanged → implement → PASS → frontend + AR vitest → `/sync-api-types` → gates → commit `feat(word-books): body search with snippets`.

### Task 17: Final gate + merge + deploy notes

- [ ] Full suite: backend pytest, mypy, ruff (+format --check), frontend vitest, tsc, eslint.
- [ ] Counter seed: ask the user for the CURRENT next paper serial; set it via one `UPDATE classified_ref_sequence SET next_value = <N>` on the production DB during deploy (document the exact command in the merge message; ≈141 as of 2026-07-17).
- [ ] Confirm with the user, then: merge `feature/word-books` → `main`, push `origin/main` (live-server rule), deploy via `scripts\mng.ps1 deploy`; verify `mng status` healthy; create one real classified book end-to-end on an office PC.
- [ ] Remind the user: author the REAL `GSSG-GS_301-001_Classified_Standard.docx` (replacing the placeholder) + any special layouts; template files are data — re-run nothing, they're picked up per creation.

---

## Self-review notes (done at authoring time)

- **Spec coverage:** registry/ref (T2,T5), templates+tokens+footer (T5), data model/drafts/voided (T1,T7), edit flow+DAV+auth (T3,T5,T7,T11), records integration + both surfaces + drafts-in-both-places (T6,T10), handoff UX (T9), plain-GB toggle (T12), i18n/RTL (T8-T10,T13), body search + backfill + snippet (T14-T16), M0 stop-gate (T4), counter seed + deploy (T17). No spec section uncovered.
- **Known intentional deferrals to executor judgment (verify-in-repo, not placeholders):** exact `docx_render.render` signature, existing PDF-executor monkeypatch pattern, the books list `q` filter site, the mobile/desktop split helper — each task names the exact file/lines to read first.
- **Type consistency:** `WordSessionInfo`/`WordSessionRead` field names match across T5/T6/T8/T9; `is_draft`/`voided_at`/`edit_session`/`classification_code`/`search_snippet` consistent across T6/T10/T16.
