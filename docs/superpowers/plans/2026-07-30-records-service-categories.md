# Records — A Category Per Service: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every paper-producing service its own category in the Records rail, filtered and counted on the server, and make the drafts card collapsible.

**Architecture:** A record's service is the template it was generated from (`template_id` on its version). One pure backend resolver (`app/core/form_kind.py`) defines the rule; version-less v3 imports fall back to an explicit 13-entry subject alias table. The rule is exposed three ways — as `BookRead.service_id` on every row, as a `service_id` filter on `GET /books`, and as a new `GET /books/facets` payload carrying per-service counts and per-service approval-state counts. The frontend deletes its client-side prefix guessing entirely and renders the rail, the status spine and the row badges from those.

**Tech Stack:** FastAPI + SQLAlchemy 2.x (SQLite), Pydantic v2, pytest; React 19 + React Query + Tailwind 4, vitest, react-i18next.

**Spec:** `docs/superpowers/specs/2026-07-30-records-service-categories-design.md`

## Global Constraints

- **Worktree:** all work happens in `C:\Users\Admin\sentinel\.claude\worktrees\records-service-categories` on branch `feature/records-service-categories`. Never touch the main checkout.
- **The worktree has no `venv/`.** Use the main checkout's interpreter by absolute path: `C:/Users/Admin/sentinel/venv/Scripts/python.exe`, `.../ruff.exe`, `.../mypy.exe`. Run all commands from the worktree root; `pyproject.toml` sets `pythonpath = ["backend"]` and `testpaths = ["backend/tests"]`, so imports resolve against the worktree copy.
- **Strict gates are real:** `mypy` runs in `strict` mode over `backend/app`; `pytest` runs with `filterwarnings = error`. No `Any` leaks, no bare `# type: ignore` without a code.
- **Never regenerate `api.types.ts` by hand.** Task 5 is the only place the contract changes, and it must run the full dump→generate→typecheck chain.
- **Arabic is first-class.** Every new user-visible string ships an `ar.json` entry, and every new i18n test asserts the **Arabic** string under `lng=ar` — an English-only assertion cannot catch an AR leak when the English label equals the key.
- **Service id key space:** the canonical `TEMPLATE_FILES` keys verbatim (e.g. `"Leave Application Form"`), plus the sentinel `"other"`.
- **Do not touch** `book_categories` / `Book.category_id` (the 12 ref-number buckets), `LIST_MAX_LIMIT`, or the `FORM_TYPE_SUBFOLDER` dead key. All out of scope.
- **Templates churn:** if `backend/templates/*.docx` show as modified at any commit, `git checkout -- backend/templates/` before staging. Never commit template churn.

### Ground truth measured from the live database (2026-07-30)

These numbers are load-bearing for the tests below.

- 629 live (non-deleted) books; 325 versions total.
- **No book currently has more than one distinct `template_id` across its
  versions — but this is a data coincidence, not a guarantee.** `service_clause`
  (Task 3) and `service_facets` (Task 4) both key off the book's NEWEST version
  (highest `version_no`), matching exactly what `resolve_service` /
  `BookRead.service_id` already consult. Do not read "no book has two today" as
  license to substitute `func.max(template_id)` — that is the lexicographic max
  across all versions, not the newest, and reintroduces an any-vs-newest
  divergence the moment a book acquires two differently-templated versions.
- 365 live books have **no version row at all** (v3 imports).
- 1 version row has a NULL `template_id`, but **no live book's newest version is NULL** — the resolver must still handle "has a version, template unknown".
- The 365 version-less books hold exactly 13 distinct subject heads; 10 are verbatim `TEMPLATE_FILES` keys, and these three are not:
  `Resignation Form` (8 rows) → `Resignation Letter`; `كتاب عام` (1) → `General Book`; `تصاريح الامنية` (1) → Other.

### Gate drift measured on `main` before this branch started (2026-07-30)

**`main` was NOT clean when this branch started — measured directly, not
assumed.** Every "Expected: all pass" / "Expected: all green" in the steps
below means *no new failure versus this table*, not a literal zero. Do not
try to fix any of this; it would bury the review diff in unrelated churn.

```
pytest                 : 815 passed, 1 FAILED (backend/tests/test_dav.py::
                          test_dav_diagnostic_event_is_structured_and_redacted)  <- pre-existing
ruff check .            : 13 errors in 9 unrelated files
ruff format --check .   : 97 files would reformat (none of ours)
mypy                    : 28 errors in 11 unrelated files
pnpm -C frontend test   : 437 passed, 1 FAILED (src/components/application/
                          TemplateForm.bodyMode.test.tsx, "picker renders base
                          and custom options as separate groups")               <- pre-existing
pnpm run lint           : exits 1 with 8 findings (3 errors, 5 warnings) in
                          unrelated files
```

Every later task's gate check compares against this table: the two named
pre-existing failures (`test_dav.py`, `TemplateForm.bodyMode.test.tsx`) are
expected to keep failing throughout; ruff/format/mypy/lint counts should stay
in files this plan never touches. A regression is a NEW failure or a failure
in a file this plan touched — not the persistence of one of the above.

---

### Task 0: Prepare the worktree and record a green baseline

**Files:** none (setup only)

**Interfaces:**
- Consumes: nothing
- Produces: a worktree that can run both test suites; a recorded baseline count every later task compares against

- [ ] **Step 1: Install frontend dependencies**

A fresh worktree has no `frontend/node_modules`.

```bash
cd C:/Users/Admin/sentinel/.claude/worktrees/records-service-categories
pnpm -C frontend install
```

- [ ] **Step 2: Run the backend suite and record the count**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest -q
```

Expected: 815 passed, 1 pre-existing failure — see "Gate drift measured on
`main`" above. Write the passed count down — every later task must not
reduce it (it may grow, since later tasks add tests).

- [ ] **Step 3: Run the frontend suite and record the count**

```bash
pnpm -C frontend test -- --run
```

Expected: 437 passed, 1 pre-existing failure — see "Gate drift measured on
`main`" above. Write the passed count down.

- [ ] **Step 4: Confirm the tree is clean**

```bash
git status --porcelain
```

Expected: empty (or only `frontend/pnpm-lock.yaml` if install touched it — if so, do not commit it). If `backend/templates/*.docx` appear, run `git checkout -- backend/templates/`.

---

### Task 1: The service resolver

**Files:**
- Create: `backend/app/core/form_kind.py`
- Test: `backend/tests/test_form_kind.py`

**Interfaces:**
- Consumes: `app.core.constants.TEMPLATE_FILES`, `app.core.constants.COMPANION_TEMPLATE_IDS`
- Produces:
  - `OTHER_SERVICE_ID: str` — the literal `"other"`
  - `SERVICE_IDS: tuple[str, ...]` — `TEMPLATE_FILES` keys minus companions, in `TEMPLATE_FILES` order
  - `LEGACY_SUBJECT_ALIASES: Mapping[str, str]`
  - `subject_prefixes(service_id: str) -> tuple[str, ...]` — lower-cased prefixes resolving to that service
  - `resolve_service(subject: str | None, template_id: str | None, *, versioned: bool) -> str`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_form_kind.py`:

```python
"""form_kind — the single definition of "which service produced this record"."""

from __future__ import annotations

import pytest

from app.core.constants import COMPANION_TEMPLATE_IDS, TEMPLATE_FILES
from app.core.form_kind import (
    LEGACY_SUBJECT_ALIASES,
    OTHER_SERVICE_ID,
    SERVICE_IDS,
    resolve_service,
    subject_prefixes,
)


def test_service_ids_are_templates_minus_companions() -> None:
    assert set(SERVICE_IDS) == set(TEMPLATE_FILES) - set(COMPANION_TEMPLATE_IDS)
    assert len(SERVICE_IDS) == 17
    # TEMPLATE_FILES order is preserved (drives rail order).
    assert list(SERVICE_IDS) == [t for t in TEMPLATE_FILES if t not in COMPANION_TEMPLATE_IDS]


@pytest.mark.parametrize("service_id", list(SERVICE_IDS))
def test_template_id_resolves_to_itself(service_id: str) -> None:
    assert resolve_service(None, service_id, versioned=True) == service_id
    # Subject text is irrelevant when a template id is present.
    assert resolve_service("Leave Application Form - X", service_id, versioned=True) == service_id


@pytest.mark.parametrize("companion", sorted(COMPANION_TEMPLATE_IDS))
def test_companions_resolve_to_other(companion: str) -> None:
    assert resolve_service(None, companion, versioned=True) == OTHER_SERVICE_ID


def test_versioned_record_with_unknown_template_is_other_not_subject_guessed() -> None:
    # A version exists but its template is unknown/NULL: never fall back to the
    # subject, or modern records rejoin the guessing path.
    assert resolve_service("Leave Application Form - X", "Ghost Form", versioned=True) == (
        OTHER_SERVICE_ID
    )
    assert resolve_service("Leave Application Form - X", None, versioned=True) == OTHER_SERVICE_ID


@pytest.mark.parametrize(
    ("subject", "expected"),
    [
        ("Leave Application Form - Saif Rashed", "Leave Application Form"),
        ("Duty Resumption Form - X", "Duty Resumption Form"),
        ("Violation Form - X", "Violation Form"),
        ("HR Request Form - X", "HR Request Form"),
        ("Employee Clearance Form - X", "Employee Clearance Form"),
        ("Passport Release Form - X", "Passport Release Form"),
        ("General Book", "General Book"),
        ("Salary Transfer Request - X", "Salary Transfer Request"),
        ("Material Request Form - X", "Material Request Form"),
        ("Acknowledgment Form - X", "Acknowledgment Form"),
        # The three that a generic prefix scan gets wrong:
        ("Resignation Form - X", "Resignation Letter"),
        ("كتاب عام", "General Book"),
        ("تصاريح الامنية", OTHER_SERVICE_ID),
    ],
)
def test_versionless_subject_heads_resolve(subject: str, expected: str) -> None:
    """The 13 distinct subject heads present in the 365 v3-imported records."""
    assert resolve_service(subject, None, versioned=False) == expected


def test_versionless_matching_is_case_insensitive() -> None:
    assert resolve_service("leave application form - x", None, versioned=False) == (
        "Leave Application Form"
    )


def test_empty_and_null_subject_are_other() -> None:
    assert resolve_service(None, None, versioned=False) == OTHER_SERVICE_ID
    assert resolve_service("   ", None, versioned=False) == OTHER_SERVICE_ID


def test_unknown_subject_is_other() -> None:
    assert resolve_service("Some random subject", None, versioned=False) == OTHER_SERVICE_ID


def test_longest_prefix_wins() -> None:
    """Passport Release List must not be swallowed by Passport Release Form."""
    assert resolve_service("Passport Release List - X", None, versioned=False) == (
        "Passport Release List"
    )
    assert resolve_service("Passport Release Form - X", None, versioned=False) == (
        "Passport Release Form"
    )


def test_subject_prefixes_include_aliases_and_are_lowercase() -> None:
    assert "resignation letter" in subject_prefixes("Resignation Letter")
    assert "resignation form" in subject_prefixes("Resignation Letter")
    assert "كتاب عام" in subject_prefixes("General Book")
    for service_id in SERVICE_IDS:
        for prefix in subject_prefixes(service_id):
            assert prefix == prefix.lower()


def test_every_alias_target_is_a_real_service() -> None:
    for target in LEGACY_SUBJECT_ALIASES.values():
        assert target in SERVICE_IDS


def test_no_prefix_contains_a_sql_like_wildcard() -> None:
    """subject_prefixes() feeds straight into ILIKE in Task 3 — % and _ would
    silently widen the match."""
    for service_id in SERVICE_IDS:
        for prefix in subject_prefixes(service_id):
            assert "%" not in prefix
            assert "_" not in prefix
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_form_kind.py -q
```

Expected: collection error — `ModuleNotFoundError: No module named 'app.core.form_kind'`.

- [ ] **Step 3: Write the implementation**

Create `backend/app/core/form_kind.py`:

```python
"""Which service produced a given Records entry.

The Records rail filters by *service* — the form/template a record came from.
`template_id` on the book's version is authoritative. The 365 v3-imported books
carry no version at all, so they fall back to an explicit alias table over the
machine-written subject they were imported with.

Pure module: no session, no I/O. `subject_prefixes()` is shared with the SQL
filter in `book_service` so the Python rule and the SQL rule are generated from
one table.
"""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType
from typing import Final

from app.core.constants import COMPANION_TEMPLATE_IDS, TEMPLATE_FILES

OTHER_SERVICE_ID: Final[str] = "other"

#: Legacy subject heads that are NOT `TEMPLATE_FILES` keys. "Resignation Form"
#: is the dead `FORM_TYPE_SUBFOLDER` key (constants.py:138) — it was never a
#: real template, but 8 imported records carry it. The Arabic head belongs to a
#: hand-written General Book. (The third live head, "تصاريح الامنية", has no
#: home and correctly falls to Other.)
LEGACY_SUBJECT_ALIASES: Final[Mapping[str, str]] = MappingProxyType(
    {
        "Resignation Form": "Resignation Letter",
        "كتاب عام": "General Book",
    }
)

#: Every service that can own a rail entry: registered templates minus the two
#: companions, which exist only attached to a primary. `TEMPLATE_FILES` order is
#: preserved — it is the rail's display order.
SERVICE_IDS: Final[tuple[str, ...]] = tuple(
    t for t in TEMPLATE_FILES if t not in COMPANION_TEMPLATE_IDS
)


def subject_prefixes(service_id: str) -> tuple[str, ...]:
    """Lower-cased subject prefixes that resolve to ``service_id``.

    The template's own name plus any legacy alias pointing at it. Used both by
    ``resolve_service`` and by the SQL ILIKE clause in ``book_service``.
    """
    out: list[str] = []
    if service_id in TEMPLATE_FILES:
        out.append(service_id.lower())
    out.extend(k.lower() for k, v in LEGACY_SUBJECT_ALIASES.items() if v == service_id)
    return tuple(out)


#: (prefix, service_id) sorted longest-first, so a longer name always wins over
#: a shorter one that happens to be its prefix.
_PREFIX_TABLE: Final[tuple[tuple[str, str], ...]] = tuple(
    sorted(
        ((p, s) for s in SERVICE_IDS for p in subject_prefixes(s)),
        key=lambda pair: len(pair[0]),
        reverse=True,
    )
)


def resolve_service(subject: str | None, template_id: str | None, *, versioned: bool) -> str:
    """The service that produced this record, or ``OTHER_SERVICE_ID``.

    ``versioned`` says whether the book has any ``book_versions`` row. When it
    does, ``template_id`` (the newest version's) decides and the subject is
    ignored entirely — an unknown or NULL template resolves to Other rather than
    rejoining the subject-guessing path. Only version-less v3 imports consult
    the subject.
    """
    if versioned:
        return template_id if template_id in SERVICE_IDS else OTHER_SERVICE_ID
    s = (subject or "").strip().lower()
    if not s:
        return OTHER_SERVICE_ID
    for prefix, service_id in _PREFIX_TABLE:
        if s.startswith(prefix):
            return service_id
    return OTHER_SERVICE_ID
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_form_kind.py -q
```

Expected: all pass.

- [ ] **Step 5: Lint and typecheck**

```bash
C:/Users/Admin/sentinel/venv/Scripts/ruff.exe check . && C:/Users/Admin/sentinel/venv/Scripts/ruff.exe format --check . && C:/Users/Admin/sentinel/venv/Scripts/mypy.exe
```

Expected: clean. If `ruff format --check` complains, run `ruff.exe format backend/app/core/form_kind.py backend/tests/test_form_kind.py`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/form_kind.py backend/tests/test_form_kind.py
git commit -m "feat(records): resolve a record's service from its template id"
```

---

### Task 2: Expose `service_id` on every record row

**Files:**
- Modify: `backend/app/schemas/book.py` (add a computed field next to `current_template_id` at :281-285)
- Test: `backend/tests/test_book_service_id_field.py`

**Interfaces:**
- Consumes: `app.core.form_kind.resolve_service`, `OTHER_SERVICE_ID`
- Produces: `BookRead.service_id: str` — a Pydantic computed field, present on every list and detail payload

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_book_service_id_field.py`:

```python
"""BookRead.service_id — the frontend must never re-derive the service rule."""

from __future__ import annotations

from datetime import UTC, datetime

from app.core.form_kind import OTHER_SERVICE_ID
from app.schemas.book import BookRead, BookVersionRead


def _version(template_id: str | None) -> BookVersionRead:
    return BookVersionRead(
        id=1,
        version_no=1,
        template_id=template_id,
        created_at=datetime(2026, 7, 30, tzinfo=UTC),
    )


def _book(subject: str | None, versions: list[BookVersionRead]) -> BookRead:
    return BookRead(
        id=1,
        ref_number="GS-0001",
        subject=subject,
        direction="outgoing",
        created_at=datetime(2026, 7, 30, tzinfo=UTC),
        versions=versions,
    )


def test_service_id_comes_from_the_newest_version_template() -> None:
    book = _book("anything at all", [_version("Report")])
    assert book.service_id == "Report"


def test_service_id_falls_back_to_subject_only_when_versionless() -> None:
    book = _book("Leave Application Form - Saif", [])
    assert book.service_id == "Leave Application Form"


def test_versioned_book_with_unknown_template_is_other() -> None:
    book = _book("Leave Application Form - Saif", [_version(None)])
    assert book.service_id == OTHER_SERVICE_ID


def test_service_id_is_serialised() -> None:
    book = _book(None, [_version("Warning Form")])
    assert book.model_dump()["service_id"] == "Warning Form"
```

**Note for the implementer:** `BookRead` and `BookVersionRead` have more fields
than the four passed above; the rest carry defaults. If either constructor
raises a `ValidationError` for a missing required field, add that field to the
helper with a trivial value — do **not** loosen the schema. Read
`backend/app/schemas/book.py` first and mirror what
`backend/tests/` already does when it builds a `BookRead` by hand.

- [ ] **Step 2: Run the test to verify it fails**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_book_service_id_field.py -q
```

Expected: FAIL — `'BookRead' object has no attribute 'service_id'`.

- [ ] **Step 3: Add the computed field**

In `backend/app/schemas/book.py`, add the import at the top of the module:

```python
from app.core.form_kind import resolve_service
```

Then immediately after the existing `current_template_id` computed field
(currently ending at line 285), add:

```python
    @computed_field  # type: ignore[prop-decorator]
    @property
    def service_id(self) -> str:
        """Which service produced this record — the Records rail's category.

        Single source of truth for the rule (app.core.form_kind); the frontend
        reads this instead of parsing the subject. `versions` is empty for
        v3-imported records, which is exactly when the subject fallback applies.
        """
        return resolve_service(
            self.subject,
            self.versions[-1].template_id if self.versions else None,
            versioned=bool(self.versions),
        )
```

**Important:** `books.py:373` overwrites `item.subject` with
`book_service.derive_subject(r)` *after* `model_validate`. Computed fields
evaluate at serialisation time, so `service_id` sees the derived subject. This
is safe: `derive_subject` only differs from `Book.subject` when a version
carries an operator-entered `subject`, and any record with a version resolves by
`template_id` and never reads the subject at all.

- [ ] **Step 4: Run the test to verify it passes**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_book_service_id_field.py -q
```

Expected: all pass.

- [ ] **Step 5: Run the whole backend suite**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest -q
```

Expected: the Task 0 baseline count plus the new tests. A new field on a
response model can break snapshot-style assertions — if anything fails, fix the
assertion, not the field.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
C:/Users/Admin/sentinel/venv/Scripts/ruff.exe check . && C:/Users/Admin/sentinel/venv/Scripts/mypy.exe
git add backend/app/schemas/book.py backend/tests/test_book_service_id_field.py
git commit -m "feat(records): ship service_id on every book row"
```

---

### Task 3: Filter `GET /books` by service on the server

**Files:**
- Modify: `backend/app/services/book_service.py` (`list_books`, currently :137-220)
- Modify: `backend/app/api/v1/books.py` (`list_books` route, :333-357)
- Test: `backend/tests/test_books_service_filter.py`

**Interfaces:**
- Consumes: `subject_prefixes`, `SERVICE_IDS`, `OTHER_SERVICE_ID`, `resolve_service` from Task 1
- Produces:
  - `book_service.service_clause(service_id: str) -> ColumnElement[bool]` — the SQL expression for one service (exported for the facets task and the agreement test)
  - `book_service.list_books(..., service_id: str | None = None)` — new keyword-only-in-practice parameter
  - `GET /api/v1/books?service_id=<id>`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_books_service_filter.py`. `db_session` is the real
fixture from `backend/tests/conftest.py:36`. There is **no** shared `client`
fixture — route tests build their own `TestClient`; the fixture below mirrors
`backend/tests/test_book_template_routes_m4.py:29-45`.

```python
"""GET /books?service_id= — server-side service filtering.

The SQL clause and the Python resolver are two expressions of one rule, so the
agreement test below is the guard that keeps them from drifting.
"""

from __future__ import annotations

import secrets
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS, resolve_service
from app.db import session as session_mod
from app.db.models import Base, Book, BookCategory, BookVersion, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import book_service, perm_service


def _add_book(
    db: Session, *, ref: str, subject: str | None, template_id: str | None, versioned: bool
) -> Book:
    """A book with (optionally) one version. `versioned=False` mimics a v3 import."""
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.flush()
    book = Book(ref_number=ref, category_id="GS", subject=subject, direction="outgoing")
    db.add(book)
    db.flush()
    if versioned:
        db.add(BookVersion(book_id=book.id, version_no=1, template_id=template_id))
    db.flush()
    return book


#: (ref, subject, template_id, versioned, expected_service)
FIXTURES = [
    ("A-1", "Leave Application Form - X", "Leave Application Form", True,
     "Leave Application Form"),
    ("A-2", "whatever", "Report", True, "Report"),
    ("A-3", "whatever", "Warning Form", True, "Warning Form"),
    ("A-4", "whatever", "Leave Undertaking", True, OTHER_SERVICE_ID),      # companion
    ("A-5", "Leave Application Form - X", "Ghost Form", True, OTHER_SERVICE_ID),
    ("A-6", "Leave Application Form - X", None, True, OTHER_SERVICE_ID),
    ("B-1", "Leave Application Form - X", None, False, "Leave Application Form"),
    ("B-2", "Resignation Form - X", None, False, "Resignation Letter"),
    ("B-3", "كتاب عام", None, False, "General Book"),
    ("B-4", "تصاريح الامنية", None, False, OTHER_SERVICE_ID),
    ("B-5", "Passport Release Form - X", None, False, "Passport Release Form"),
    ("B-6", "Passport Release List - X", None, False, "Passport Release List"),
    ("B-7", None, None, False, OTHER_SERVICE_ID),
]


def _seed(db: Session) -> None:
    for ref, subject, template_id, versioned, _expected in FIXTURES:
        _add_book(db, ref=ref, subject=subject, template_id=template_id,
                  versioned=versioned)
    db.commit()


@pytest.fixture()
def api(monkeypatch: pytest.MonkeyPatch, tmp_path) -> Iterator[TestClient]:
    """Seeded TestClient with auth overridden (mirrors test_book_template_routes_m4)."""
    eng = create_engine(
        f"sqlite:///{tmp_path / 'svc_filter.db'}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    user = User(
        email=f"{secrets.token_hex(4)}@test.ae", password_hash="x", role="admin", status="active"
    )
    db.add(user)
    db.commit()
    _seed(db)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        yield client
    db.close()


def test_filter_returns_only_that_service(db_session: Session) -> None:
    _seed(db_session)
    rows, total, _ = book_service.list_books(
        db_session, service_id="Leave Application Form", limit=500
    )
    assert {r.ref_number for r in rows} == {"A-1", "B-1"}
    assert total == 2


def test_other_collects_exactly_the_unresolved(db_session: Session) -> None:
    _seed(db_session)
    rows, _total, _ = book_service.list_books(
        db_session, service_id=OTHER_SERVICE_ID, limit=500
    )
    assert {r.ref_number for r in rows} == {"A-4", "A-5", "A-6", "B-4", "B-7"}


def test_sql_filter_agrees_with_the_python_resolver(db_session: Session) -> None:
    """The rule has two expressions (SQL + Python). They must partition the
    same set of records identically, for every service and for Other."""
    _seed(db_session)
    for service_id in [*SERVICE_IDS, OTHER_SERVICE_ID]:
        rows, _total, _ = book_service.list_books(
            db_session, service_id=service_id, limit=500
        )
        by_sql = {r.ref_number for r in rows}
        by_python = {
            ref
            for ref, subject, template_id, versioned, _expected in FIXTURES
            if resolve_service(subject, template_id, versioned=versioned) == service_id
        }
        assert by_sql == by_python, f"mismatch for {service_id!r}"


def test_every_fixture_lands_in_exactly_one_bucket(db_session: Session) -> None:
    _seed(db_session)
    seen: list[str] = []
    for service_id in [*SERVICE_IDS, OTHER_SERVICE_ID]:
        rows, _total, _ = book_service.list_books(
            db_session, service_id=service_id, limit=500
        )
        seen.extend(r.ref_number for r in rows)
    assert sorted(seen) == sorted(ref for ref, *_rest in FIXTURES)


def test_unknown_service_id_returns_nothing(db_session: Session) -> None:
    _seed(db_session)
    rows, total, _ = book_service.list_books(db_session, service_id="Ghost Form", limit=500)
    assert rows == []
    assert total == 0


def test_route_accepts_service_id(api: TestClient) -> None:
    """The API surface, not just the service function."""
    res = api.get("/api/v1/books", params={"service_id": "Report", "limit": 500})
    assert res.status_code == 200
    body = res.json()
    assert [item["ref_number"] for item in body["items"]] == ["A-2"]
    assert all(item["service_id"] == "Report" for item in body["items"])


def test_route_without_service_id_returns_everything(api: TestClient) -> None:
    res = api.get("/api/v1/books", params={"limit": 500})
    assert res.status_code == 200
    assert res.json()["total"] == len(FIXTURES)


def test_filter_composes_with_the_other_filters(db_session: Session) -> None:
    _seed(db_session)
    rows, _total, _ = book_service.list_books(
        db_session, service_id="Leave Application Form", direction="incoming", limit=500
    )
    assert rows == []
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_books_service_filter.py -q
```

Expected: FAIL — `list_books() got an unexpected keyword argument 'service_id'`.

- [ ] **Step 3: Add the SQL clause and the parameter**

In `backend/app/services/book_service.py`, add to the imports:

```python
from sqlalchemy import and_, not_
from sqlalchemy.sql.elements import ColumnElement

from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS, subject_prefixes
```

(`and_` / `or_` / `select` may already be imported — do not duplicate.)

Add above `list_books`:

```python
def service_clause(service_id: str) -> ColumnElement[bool]:
    """SQL for "this book belongs to `service_id`".

    Mirrors `form_kind.resolve_service`, generated from the same prefix table:
    a book belongs to a service if it has a version with that `template_id`, or
    — being version-less — its subject starts with one of the service's names.
    `OTHER_SERVICE_ID` is the literal negation of every named clause, so the
    buckets are provably complementary: no book can land in two or in none.

    `subject_prefixes()` is asserted wildcard-free in test_form_kind, so
    interpolating it into ILIKE cannot widen the match.
    """
    if service_id == OTHER_SERVICE_ID:
        return and_(*[not_(service_clause(s)) for s in SERVICE_IDS])
    has_version_of = Book.id.in_(
        select(BookVersion.book_id).where(BookVersion.template_id == service_id)
    )
    prefixes = subject_prefixes(service_id)
    if not prefixes:
        return has_version_of
    return or_(
        has_version_of,
        and_(
            Book.id.not_in(select(BookVersion.book_id)),
            or_(*[Book.subject.ilike(f"{p}%") for p in prefixes]),
        ),
    )
```

In `list_books`, add the parameter to the signature (after `category_id`):

```python
    service_id: str | None = None,
```

and the filter, alongside the existing `category_id` block at :173-175:

```python
    if service_id is not None:
        clause = service_clause(service_id)
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)
```

Do **not** name the local `clause` if the `q` block below already uses that
name — rename to `svc_clause` if so.

In `backend/app/api/v1/books.py`, add `service_id: str | None = None` to the
route signature after `category_id`, and `service_id=service_id,` to the
`book_service.list_books(...)` call.

- [ ] **Step 4: Run the test to verify it passes**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_books_service_filter.py -q
```

Expected: all pass. If the `other` clause is slow or wrong, check that
`not_(service_clause(s))` is applied over *all* of `SERVICE_IDS` — a partial
list silently mislabels records.

- [ ] **Step 5: Run the whole backend suite, lint, typecheck**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest -q
C:/Users/Admin/sentinel/venv/Scripts/ruff.exe check . && C:/Users/Admin/sentinel/venv/Scripts/mypy.exe
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/book_service.py backend/app/api/v1/books.py backend/tests/test_books_service_filter.py
git commit -m "feat(records): filter GET /books by service_id in SQL"
```

---

### Task 4: `GET /books/facets` — true counts for the rail and the spine

**Files:**
- Modify: `backend/app/schemas/book.py` (add two response models near `BookListResponse` at :293)
- Modify: `backend/app/services/book_service.py` (add `service_facets`)
- Modify: `backend/app/api/v1/books.py` (add the route **above** the `/books/{book_id}` routes)
- Test: `backend/tests/test_books_facets.py`

**Interfaces:**
- Consumes: `resolve_service`, `SERVICE_IDS`, `OTHER_SERVICE_ID` (Task 1); the `FIXTURES` shape from Task 3
- Produces:
  - `book_service.ServiceCount` — `NamedTuple(service_id: str, count: int, states: dict[str, int])`
  - `book_service.service_facets(db: Session) -> tuple[ServiceCount, list[ServiceCount]]` — `(all_records, per_service)`
  - schemas `ServiceFacetRead { id, count, states }` and `BookFacetsResponse { total, states, services }`
  - `GET /api/v1/books/facets`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_books_facets.py`:

```python
"""GET /books/facets — per-service counts + per-service approval-state counts.

Global over every non-deleted book: never a page window. This is what fixes the
rail's silent truncation at 500 rows.
"""

from __future__ import annotations

import secrets
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.core.form_kind import OTHER_SERVICE_ID
from app.db import session as session_mod
from app.db.models import Base, Book, BookCategory, BookVersion, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import book_service, perm_service

#: (ref, subject, template_id, versioned, approval_state)
ROWS = [
    ("F-1", "x", "Leave Application Form", True, "pending"),
    ("F-2", "x", "Leave Application Form", True, "approved"),
    ("F-3", "x", "Leave Application Form", True, "none"),
    ("F-4", "x", "Report", True, "approved"),
    ("F-5", "Resignation Form - X", None, False, "none"),
    ("F-6", "تصاريح الامنية", None, False, "none"),
]


def _seed(db: Session) -> None:
    db.add(BookCategory(id="GS", prefix="GS"))
    db.flush()
    for ref, subject, template_id, versioned, state in ROWS:
        book = Book(
            ref_number=ref, category_id="GS", subject=subject,
            direction="outgoing", approval_state=state,
        )
        db.add(book)
        db.flush()
        if versioned:
            db.add(BookVersion(book_id=book.id, version_no=1, template_id=template_id))
    # A deleted book must not be counted anywhere.
    db.add(
        Book(
            ref_number="F-7", category_id="GS", subject="x", direction="outgoing",
            approval_state="approved", deleted_at=datetime(2026, 7, 1, tzinfo=UTC),
        )
    )
    db.commit()


@pytest.fixture()
def api(monkeypatch: pytest.MonkeyPatch, tmp_path) -> Iterator[TestClient]:
    """Seeded TestClient (mirrors test_book_template_routes_m4.py:29-45)."""
    eng = create_engine(
        f"sqlite:///{tmp_path / 'facets.db'}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    user = User(
        email=f"{secrets.token_hex(4)}@test.ae", password_hash="x", role="admin", status="active"
    )
    db.add(user)
    db.commit()
    _seed(db)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        yield client
    db.close()


def test_counts_are_per_service(db_session: Session) -> None:
    _seed(db_session)
    _all, services = book_service.service_facets(db_session)
    by_id = {s.service_id: s for s in services}
    assert by_id["Leave Application Form"].count == 3
    assert by_id["Report"].count == 1
    assert by_id["Resignation Letter"].count == 1
    assert by_id[OTHER_SERVICE_ID].count == 1


def test_states_are_per_service(db_session: Session) -> None:
    _seed(db_session)
    _all, services = book_service.service_facets(db_session)
    by_id = {s.service_id: s for s in services}
    assert by_id["Leave Application Form"].states == {
        "pending": 1, "approved": 1, "none": 1
    }


def test_totals_agree_and_exclude_deleted(db_session: Session) -> None:
    _seed(db_session)
    all_records, services = book_service.service_facets(db_session)
    assert all_records.count == 6  # F-7 is deleted
    assert sum(s.count for s in services) == all_records.count
    assert sum(all_records.states.values()) == all_records.count


def test_empty_services_are_omitted(db_session: Session) -> None:
    _seed(db_session)
    _all, services = book_service.service_facets(db_session)
    assert all(s.count > 0 for s in services)
    assert "Warning Form" not in {s.service_id for s in services}


def test_order_is_template_order_with_other_last(db_session: Session) -> None:
    _seed(db_session)
    _all, services = book_service.service_facets(db_session)
    assert services[-1].service_id == OTHER_SERVICE_ID
    ids = [s.service_id for s in services]
    assert ids.index("Leave Application Form") < ids.index("Report")


def test_route_shape(api: TestClient) -> None:
    res = api.get("/api/v1/books/facets")
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"total", "states", "services"}
    assert body["total"] == len(ROWS)
    for item in body["services"]:
        assert set(item) == {"id", "count", "states"}
    assert body["services"][-1]["id"] == OTHER_SERVICE_ID


def test_facets_agree_with_the_service_filter(db_session: Session) -> None:
    """Whatever facets counts, the Task 3 filter must return that many rows."""
    _seed(db_session)
    _all, services = book_service.service_facets(db_session)
    for facet in services:
        _rows, total, _ = book_service.list_books(
            db_session, service_id=facet.service_id, limit=500
        )
        assert total == facet.count, f"{facet.service_id}: {total} != {facet.count}"
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_books_facets.py -q
```

Expected: FAIL — `module 'app.services.book_service' has no attribute 'service_facets'`.

- [ ] **Step 3: Implement the aggregation**

In `backend/app/services/book_service.py` add:

```python
class ServiceCount(NamedTuple):
    """One rail entry's numbers. `states` maps approval_state → count."""

    service_id: str
    count: int
    states: dict[str, int]


def service_facets(db: Session) -> tuple[ServiceCount, list[ServiceCount]]:
    """`(all_records, per_service)` over EVERY non-deleted book.

    Deliberately unpaginated: these are the numbers the Records rail and the
    status spine display, and computing them from a page window is what made
    them disagree with the page's own total.

    "The book's template" is its NEWEST version's template_id, defined exactly
    as `service_clause` and `BookRead.service_id` define it — highest
    `version_no`. Do NOT use `func.max(BookVersion.template_id)`: that is the
    lexicographic max across all versions, which reintroduces the any-vs-newest
    divergence Task 3 removed, and would let a multi-template book be counted
    under a service it no longer belongs to. The separate version count
    distinguishes "no version at all" from "has a version whose template is
    NULL" — the two resolve differently.

    # ponytail: one full scan with two correlated subqueries per row — 629 rows
    # today, and book_versions.book_id is indexed. If books pass ~50k,
    # denormalise service_id onto `books`.
    """
    newest_template_id = (
        select(BookVersion.template_id)
        .where(BookVersion.book_id == Book.id)
        .order_by(BookVersion.version_no.desc())
        .limit(1)
        .scalar_subquery()
    )
    n_versions = (
        select(func.count())
        .select_from(BookVersion)
        .where(BookVersion.book_id == Book.id)
        .scalar_subquery()
    )
    stmt = select(
        Book.subject, Book.approval_state, newest_template_id, n_versions
    ).where(Book.deleted_at.is_(None))

    all_states: Counter[str] = Counter()
    per_service: dict[str, Counter[str]] = {}
    for subject, approval_state, template_id, n_versions in db.execute(stmt):
        service_id = resolve_service(subject, template_id, versioned=n_versions > 0)
        state = approval_state or "none"
        all_states[state] += 1
        per_service.setdefault(service_id, Counter())[state] += 1

    ordered = [*SERVICE_IDS, OTHER_SERVICE_ID]
    services = [
        ServiceCount(sid, sum(per_service[sid].values()), dict(per_service[sid]))
        for sid in ordered
        if sid in per_service
    ]
    all_records = ServiceCount("all", sum(all_states.values()), dict(all_states))
    return all_records, services
```

Add to the imports: `from collections import Counter`, `from typing import NamedTuple`,
`from app.core.form_kind import resolve_service` (extend the Task 3 import line),
and `func` from `sqlalchemy` if not already there.

In `backend/app/schemas/book.py`, next to `BookListResponse`:

```python
class ServiceFacetRead(BaseModel):
    """One Records-rail entry: a service id, its record count, and how those
    records split across approval states (drives the rail's mini-dots)."""

    id: str
    count: int
    states: dict[str, int]


class BookFacetsResponse(BaseModel):
    """Rail + status-spine numbers over every non-deleted book (no paging).

    `services` omits services with no records and is ordered by TEMPLATE_FILES
    with "other" last. `total`/`states` are the office-wide "All" figures.
    """

    total: int
    states: dict[str, int]
    services: list[ServiceFacetRead]
```

In `backend/app/api/v1/books.py`, add the route. **It must sit next to
`/classifications` (:101), before any `/{book_id}` route**, or FastAPI will
match `facets` as a book id:

```python
@router.get("/facets", response_model=BookFacetsResponse)
def book_facets(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
) -> BookFacetsResponse:
    """Per-service counts for the Records rail + per-service approval-state
    counts for the status spine. Global, unpaginated."""
    all_records, services = book_service.service_facets(db)
    return BookFacetsResponse(
        total=all_records.count,
        states=all_records.states,
        services=[
            ServiceFacetRead(id=s.service_id, count=s.count, states=s.states)
            for s in services
        ],
    )
```

Import `BookFacetsResponse` and `ServiceFacetRead` from `app.schemas.book`
alongside the existing `BookListResponse` import.

- [ ] **Step 4: Run the test to verify it passes**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_books_facets.py -q
```

Expected: all pass. A 404 on `/books/facets` means the route landed below a
`/{book_id}` route — move it up.

- [ ] **Step 5: Sanity-check against the live database (read-only)**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -c "import sqlite3,sys; sys.path.insert(0,'backend'); from app.core.form_kind import resolve_service; c=sqlite3.connect('file:C:/Users/Admin/sentinel/data/gssg.db?mode=ro',uri=True); rows=c.execute('SELECT b.subject, max(v.template_id), count(v.id) FROM books b LEFT JOIN book_versions v ON v.book_id=b.id WHERE b.deleted_at IS NULL GROUP BY b.id').fetchall(); from collections import Counter; k=Counter(resolve_service(s,t,versioned=n>0) for s,t,n in rows); [print(f'{v:5d}  {i}') for i,v in k.most_common()]; print('total', sum(k.values()))"
```

Expected, exactly: `Leave Application Form` 275, `Duty Resumption Form` 88,
`Violation Form` 62, `HR Request Form` 61, `General Book` 32,
`Administrative Leave Form` 27, `Employee Clearance Form` 18,
`Passport Release Form` 12, `Resignation Letter` 10, `Salary Transfer Request` 9,
`Material Request Form` 9, `Warning Form` 7, `Report` 6, `Leave Permit Form` 6,
`Salary Deduction Form` 3, `Acknowledgment Form` 3, `other` 1 — total 629.

A different distribution means the alias table or the `versioned` logic is
wrong. Fix it before continuing; every later task trusts these numbers.

- [ ] **Step 6: Full suite, lint, typecheck, commit**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest -q
C:/Users/Admin/sentinel/venv/Scripts/ruff.exe check . && C:/Users/Admin/sentinel/venv/Scripts/mypy.exe
git add backend/app/schemas/book.py backend/app/services/book_service.py backend/app/api/v1/books.py backend/tests/test_books_facets.py
git commit -m "feat(records): GET /books/facets with true per-service counts"
```

---

### Task 5: Resync the generated API contract

**Files:**
- Modify: `backend/openapi.json`, `frontend/src/lib/api.types.ts` (both generated — never hand-edited)
- Modify: `frontend/src/lib/api.ts` (add the `service_id` param and the facets method)

**Interfaces:**
- Consumes: the routes and schemas from Tasks 2-4
- Produces:
  - TS types `BookFacetsResponse`, `ServiceFacetRead`; `BookRead.service_id`
  - `api.listBooks({ ..., service_id?: string })`
  - `api.getBookFacets(): Promise<BookFacetsResponse>`

- [ ] **Step 1: Regenerate the contract**

Run the repo's `/sync-api-types` procedure: dump the OpenAPI schema from the
FastAPI app to `backend/openapi.json`, then `pnpm -C frontend run gen:api`.
Read `.claude/skills/sync-api-types/` (or `pnpm -C frontend run` script list)
for the exact commands rather than improvising.

- [ ] **Step 2: Verify the new types landed**

```bash
grep -n "service_id" frontend/src/lib/api.types.ts | head
grep -n "BookFacetsResponse\|ServiceFacetRead" frontend/src/lib/api.types.ts | head
```

Expected: `service_id` appears on `BookRead` and as a `/books` query parameter;
both new schemas exist.

- [ ] **Step 3: Add the client methods**

In `frontend/src/lib/api.ts`, add `service_id?: string` to the `listBooks`
params object (after `category_id`), and next to `listBookCategories`:

```ts
  /** GET /books/facets — per-service counts + per-service approval-state
   *  counts, over every record (not a page window). Backs the Records rail
   *  and the status spine. */
  getBookFacets: () => request<BookFacetsResponse>('GET', '/books/facets'),
```

Add the type export near the other book types (around :820):

```ts
export type BookFacetsResponse = components['schemas']['BookFacetsResponse']
export type ServiceFacetRead = components['schemas']['ServiceFacetRead']
```

- [ ] **Step 4: Typecheck**

```bash
pnpm -C frontend exec tsc -b --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit — `openapi.json` and `api.types.ts` together**

```bash
git add backend/openapi.json frontend/src/lib/api.types.ts frontend/src/lib/api.ts
git commit -m "chore(api): resync generated types for service facets"
```

If `backend/openapi.json` is gitignored in this repo, commit the other two and
say so in the commit body — do not force-add an ignored file.

---

### Task 6: Retire the client-side prefix guessing

**Files:**
- Create: `frontend/src/pages/books/serviceLabels.ts`
- Create: `frontend/src/pages/books/serviceLabels.test.tsx`
- Modify: `frontend/src/pages/books/formKind.ts` (delete the prefix table and `formKindOf`; keep `subjectEmployeePart`)
- Modify: `frontend/src/pages/books/formKind.test.ts` (drop the `formKindOf` cases)
- Modify: `frontend/src/pages/books/RecordsList.tsx` (:83-84)
- Modify: `frontend/src/pages/books/RecordPane.tsx` (:117-118)

**Interfaces:**
- Consumes: `BookRead.service_id` (Task 2), `api.listTemplates()`, `emojiForTemplate` from `@/pages/application/formEmoji`
- Produces:
  - `OTHER_SERVICE_ID: 'other'`
  - `serviceGlyph(serviceId: string): string`
  - `useServiceLabel(): (serviceId: string) => string`
  - `formKind.ts` still exports `subjectEmployeePart(subject, opts?)` unchanged

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/books/serviceLabels.test.tsx`. This follows the
`renderHook` + `QueryClientProvider` + `vi.mock('react-i18next')` pattern already
used by `frontend/src/pages/books/useManagePaper.test.tsx:1-16`.

```tsx
/**
 * serviceLabels — rail and row labels come from _fields.json via /templates,
 * not from locale keys. The Arabic assertions are the point: an English-only
 * assertion cannot catch an AR leak when the English label equals the key.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

import { OTHER_SERVICE_ID, serviceGlyph, useServiceLabel } from './serviceLabels'

// Mutable language so one file can assert both EN and AR (vi.mock is hoisted,
// so the holder must be created with vi.hoisted).
const i18nState = vi.hoisted(() => ({ lang: 'en' }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) =>
      k === 'books.formKind.other'
        ? i18nState.lang === 'ar'
          ? 'سجلات أخرى'
          : 'Other records'
        : k,
    i18n: { language: i18nState.lang },
  }),
}))

const TEMPLATES = {
  items: [
    { id: 'Report', name_en: 'Report', name_ar: 'تقرير' },
    { id: 'Warning Form', name_en: 'Warning Form', name_ar: 'إنذار' },
  ],
}

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

function labelFn(): (serviceId: string) => string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['templates'], TEMPLATES)
  return renderHook(() => useServiceLabel(), { wrapper: wrapperFor(qc) }).result.current
}

beforeEach(() => {
  i18nState.lang = 'en'
})

describe('serviceGlyph', () => {
  it('uses the Services-tile glyph for a real service', () => {
    expect(serviceGlyph('Report')).toBe('📊')
    expect(serviceGlyph('Warning Form')).toBe('⚠️')
  })

  it('falls back to a generic doc for Other', () => {
    expect(serviceGlyph(OTHER_SERVICE_ID)).toBe('📄')
  })
})

describe('useServiceLabel', () => {
  it('returns the English name under lng=en', () => {
    expect(labelFn()('Report')).toBe('Report')
  })

  it('returns the ARABIC name under lng=ar', () => {
    i18nState.lang = 'ar'
    const label = labelFn()
    expect(label('Report')).toBe('تقرير')
    expect(label('Warning Form')).toBe('إنذار')
  })

  it('localises the Other label', () => {
    i18nState.lang = 'ar'
    expect(labelFn()(OTHER_SERVICE_ID)).toBe('سجلات أخرى')
  })

  it('falls back to the raw id for an unknown service', () => {
    expect(labelFn()('Ghost Form')).toBe('Ghost Form')
  })

  it('falls back to the raw id before the templates query resolves', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useServiceLabel(), { wrapper: wrapperFor(qc) })
    expect(result.current('Report')).toBe('Report')
  })
})
```

**Note:** `TEMPLATES` is deliberately a partial `TemplateMeta` — only the three
fields the hook reads. If `tsc` objects, cast the seed at the `setQueryData`
call (`as TemplateListResponse`) rather than filling in every unused field.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm -C frontend exec vitest run src/pages/books/serviceLabels.test.tsx
```

Expected: FAIL — cannot resolve `./serviceLabels`.

- [ ] **Step 3: Write the module**

Create `frontend/src/pages/books/serviceLabels.ts`:

```ts
/**
 * Service labels + glyphs for the Records rail, row badges and mobile filter.
 *
 * A record's service is decided by the backend (BookRead.service_id) — this
 * module only renders it. Names come from `_fields.json` via the already-cached
 * `/templates` query, so adding a form to TEMPLATE_FILES gives it a rail entry
 * with correct EN/AR names and no locale-file edit. Glyphs reuse the Services
 * gallery lookup so the two surfaces never drift.
 */
import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '@/lib/api'
import { emojiForTemplate } from '@/pages/application/formEmoji'

/** Mirrors app.core.form_kind.OTHER_SERVICE_ID. */
export const OTHER_SERVICE_ID = 'other'

const OTHER_GLYPH = '📄'

export function serviceGlyph(serviceId: string): string {
  return serviceId === OTHER_SERVICE_ID ? OTHER_GLYPH : emojiForTemplate(serviceId)
}

/**
 * `(serviceId) => localized label`. Shares the `['templates']` query key with
 * the Services gallery, so this costs no extra request in practice.
 */
export function useServiceLabel(): (serviceId: string) => string {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const { data } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.listTemplates(),
    staleTime: Infinity,
  })
  return useCallback(
    (serviceId: string): string => {
      if (serviceId === OTHER_SERVICE_ID) return t('books.formKind.other')
      const tpl = data?.items.find((x) => x.id === serviceId)
      if (!tpl) return serviceId
      return (isAr ? tpl.name_ar : tpl.name_en) || tpl.name_en || serviceId
    },
    [data, isAr, t],
  )
}
```

- [ ] **Step 4: Shrink `formKind.ts`**

Delete `FormKind`, `FORM_KINDS`, `OTHER_KIND`, `GENERAL_BOOK_KIND`,
`REPORT_KIND` and `formKindOf`. Keep `subjectEmployeePart` and the
`FormKindOpts` type it uses (trim `FormKindOpts` to just `classified?: boolean`
if `template_id` becomes unused). Update the module docstring to say the service
now comes from the backend.

- [ ] **Step 5: Update the two consumers**

`RecordsList.tsx` — replace the `formKindOf` call. Add
`const serviceLabel = useServiceLabel()` at the top of the component, then in
the row body:

```tsx
            const classified = { classified: !!row.classification_code }
            const glyph = serviceGlyph(row.service_id)
            const label = serviceLabel(row.service_id)
            const who = subjectEmployeePart(row.subject, classified)
```

and replace the badge's `t(kind.labelKey)` / `kind.glyph` usages with `label` /
`glyph`. `RecordPane.tsx` — the same substitution using `book.service_id`.

- [ ] **Step 6: Update `formKind.test.ts`**

Delete the whole `describe('formKindOf', …)` block including the
`REPORT_KIND` / `GENERAL_BOOK_KIND` assertions. Keep
`describe('subjectEmployeePart', …)` exactly as it is — the em-dash regression
it guards is still live.

- [ ] **Step 7: Run the frontend suite and typecheck**

```bash
pnpm -C frontend exec vitest run src/pages/books
pnpm -C frontend exec tsc -b --noEmit
```

Expected: pass. `tsc` will point at any remaining `formKindOf` import —
`BooksPage.tsx:48` is expected to break here and is fixed in Task 7. If you
cannot get a green typecheck without touching `BooksPage`, do Task 7's edit now
and commit both together rather than committing a red tree.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/books/serviceLabels.ts frontend/src/pages/books/serviceLabels.test.tsx frontend/src/pages/books/formKind.ts frontend/src/pages/books/formKind.test.ts frontend/src/pages/books/RecordsList.tsx frontend/src/pages/books/RecordPane.tsx
git commit -m "refactor(records): read the service from the backend, not the subject"
```

---

### Task 7: Rail and status spine from facets

**Files:**
- Modify: `frontend/src/pages/books/serviceLabels.ts` (add the two pure derivations)
- Modify: `frontend/src/pages/books/FormRail.tsx` (`RailItem`)
- Modify: `frontend/src/pages/books/BooksPage.tsx` (:48 import, :92-95 query, :256-301 facets, :309-343 filtering, :467 render)
- Test: `frontend/src/pages/books/serviceFacets.test.tsx`

**Interfaces:**
- Consumes: `api.getBookFacets()`, `api.listBooks({ service_id })`, `serviceGlyph`, `useServiceLabel`
- Produces:
  - `RailItem { serviceId: string; glyph: string; label: string; count: number; states: string[] }`
  - `railItemsFrom(facets: BookFacetsResponse | undefined, allLabel: string, label: (id: string) => string): RailItem[]`
  - `spineCountsFrom(facets: BookFacetsResponse | undefined, railService: string): Record<SpineState, number>`

**Why the derivations are extracted:** there is no `BooksPage` render test in
this repo and standing one up would need mocks for the api module, the router,
capabilities, i18n and five queries. All the logic worth testing (ordering,
All-first/Other-last, hide-empty, dot selection, spine scoping) is pure, so it
moves into two functions that test with no DOM at all. The remaining change in
`BooksPage` is wiring.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/books/serviceFacets.test.tsx`:

```tsx
/**
 * Rail + spine derivation from the /books/facets payload.
 *
 * These are the numbers that used to be computed over a 500-row page window and
 * therefore disagreed with the page's own total.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { railItemsFrom, spineCountsFrom } from './serviceLabels'
import { FormRail } from './FormRail'
import type { BookFacetsResponse } from '@/lib/api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

const FACETS: BookFacetsResponse = {
  total: 629,
  states: { none: 100, pending: 20, approved: 509 },
  services: [
    { id: 'Leave Application Form', count: 275, states: { approved: 275 } },
    { id: 'Report', count: 6, states: { none: 6 } },
    { id: 'other', count: 1, states: { none: 1 } },
  ],
}

const label = (id: string): string => `L:${id}`

describe('railItemsFrom', () => {
  it('puts All first with the true total and Other last', () => {
    const items = railItemsFrom(FACETS, 'All forms', label)
    expect(items).toHaveLength(4)
    expect(items[0]).toMatchObject({ serviceId: 'all', label: 'All forms', count: 629 })
    expect(items[items.length - 1].serviceId).toBe('other')
  })

  it('preserves the payload order and omits empty services', () => {
    const items = railItemsFrom(FACETS, 'All forms', label).map((i) => i.serviceId)
    expect(items).toEqual(['all', 'Leave Application Form', 'Report', 'other'])
    expect(items).not.toContain('Warning Form')
  })

  it('labels and glyphs each service', () => {
    const items = railItemsFrom(FACETS, 'All forms', label)
    const report = items.find((i) => i.serviceId === 'Report')
    expect(report).toMatchObject({ label: 'L:Report', glyph: '📊', count: 6 })
    expect(items.find((i) => i.serviceId === 'other')?.glyph).toBe('📄')
  })

  it('mini-dots list the non-draft states present, excluding none and zeros', () => {
    const items = railItemsFrom(
      { ...FACETS, services: [{ id: 'Report', count: 3, states: { none: 1, pending: 2, approved: 0 } }] },
      'All forms',
      label,
    )
    expect(items[1].states).toEqual(['pending'])
  })

  it('renders nothing before the payload arrives', () => {
    expect(railItemsFrom(undefined, 'All forms', label)).toEqual([])
  })
})

describe('spineCountsFrom', () => {
  it('is global when All is selected', () => {
    expect(spineCountsFrom(FACETS, 'all')).toEqual({
      all: 629, none: 100, pending: 20, awaiting_scan: 0,
      returned: 0, approved: 509, rejected: 0,
    })
  })

  it('scopes to the selected service', () => {
    expect(spineCountsFrom(FACETS, 'Leave Application Form')).toEqual({
      all: 275, none: 0, pending: 0, awaiting_scan: 0,
      returned: 0, approved: 275, rejected: 0,
    })
  })

  it('is all zeros for an unknown service or a missing payload', () => {
    const zeros = {
      all: 0, none: 0, pending: 0, awaiting_scan: 0,
      returned: 0, approved: 0, rejected: 0,
    }
    expect(spineCountsFrom(FACETS, 'Ghost Form')).toEqual(zeros)
    expect(spineCountsFrom(undefined, 'all')).toEqual(zeros)
  })
})

describe('FormRail', () => {
  it('shows the resolved label, not a locale key, and reports the service id', async () => {
    const onChange = vi.fn()
    render(
      <FormRail
        items={railItemsFrom(FACETS, 'All forms', label)}
        active="all"
        onChange={onChange}
      />,
    )
    expect(screen.getByText('L:Report')).toBeTruthy()
    await userEvent.click(screen.getByText('L:Report'))
    expect(onChange).toHaveBeenCalledWith('Report')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm -C frontend exec vitest run src/pages/books/serviceFacets.test.tsx
```

Expected: FAIL — `railItemsFrom` / `spineCountsFrom` are not exported.

- [ ] **Step 2b: Add the two derivations to `serviceLabels.ts`**

```ts
import type { BookFacetsResponse } from '@/lib/api'
import type { RailItem } from './FormRail'
import type { SpineState } from './StatusSpine'

/** Rail entries: "All" first, then the payload's own order (TEMPLATE_FILES,
 *  "other" last, empties already omitted server-side). */
export function railItemsFrom(
  facets: BookFacetsResponse | undefined,
  allLabel: string,
  label: (serviceId: string) => string,
): RailItem[] {
  if (!facets) return []
  return [
    { serviceId: 'all', glyph: '🗂', label: allLabel, count: facets.total, states: [] },
    ...facets.services.map((s) => ({
      serviceId: s.id,
      glyph: serviceGlyph(s.id),
      label: label(s.id),
      count: s.count,
      // Mini-dots: the non-draft states actually present in this service.
      states: Object.entries(s.states)
        .filter(([state, n]) => state !== 'none' && n > 0)
        .map(([state]) => state),
    })),
  ]
}

/** Status-spine counts, scoped to the selected service ('all' = office-wide). */
export function spineCountsFrom(
  facets: BookFacetsResponse | undefined,
  railService: string,
): Record<SpineState, number> {
  const scope =
    railService === 'all'
      ? { count: facets?.total ?? 0, states: facets?.states ?? {} }
      : (facets?.services.find((s) => s.id === railService) ?? { count: 0, states: {} })
  const n = (k: string): number => scope.states[k] ?? 0
  return {
    all: scope.count,
    none: n('none'),
    pending: n('pending'),
    awaiting_scan: n('awaiting_scan'),
    returned: n('returned'),
    approved: n('approved'),
    rejected: n('rejected'),
  }
}
```

- [ ] **Step 3: Widen `RailItem`**

In `FormRail.tsx`, replace the interface and the two usages of `labelKey` /
`kindId`:

```ts
export interface RailItem {
  serviceId: string
  glyph: string
  /** Already-localised label (from serviceLabels.useServiceLabel). */
  label: string
  count: number
  /** distinct non-draft approval states present, e.g. ['pending','approved'] */
  states: string[]
}
```

In the body, use `item.serviceId` for the key / `active` comparison /
`onChange` argument, `item.glyph` unchanged, and `{item.label}` in place of
`{t(item.labelKey)}`. The `aria-label` on `<nav>` stays
`t('books.formKind.all')`. The `DOT` map and the mini-dot markup are unchanged.

- [ ] **Step 4: Rewire `BooksPage`**

Delete the `formKind` import at :48 (it is replaced by the `serviceLabels`
import shown further down this step).

Rename the `railKind` state to `railService` (same `useState<string>('all')`).
Add the facets query next to `listQuery`:

```ts
  // Rail + spine numbers over EVERY record — the 500-row page window is why
  // these used to disagree with the page's own total.
  const facetsQuery = useQuery({
    queryKey: ['books', 'facets'],
    queryFn: () => api.getBookFacets(),
  })
```

Make the list query service-aware:

```ts
  const listQuery = useQuery({
    queryKey: ['books', 'all', railService],
    queryFn: () =>
      api.listBooks(
        railService === 'all' ? { limit: 500 } : { service_id: railService, limit: 500 },
      ),
  })
```

Replace the `spineCounts` memo (:256-271) and the `railItems` memo (:273-301)
with calls to the two functions added in Step 2b — all the logic lives there:

```ts
  const serviceLabel = useServiceLabel()

  const spineCounts = useMemo<Record<SpineState, number>>(
    () => spineCountsFrom(facetsQuery.data, railService),
    [facetsQuery.data, railService],
  )

  const railItems = useMemo<RailItem[]>(
    () => railItemsFrom(facetsQuery.data, t('books.formKind.all'), serviceLabel),
    [facetsQuery.data, serviceLabel, t],
  )
```

Extend the Step 4 import accordingly:

```ts
import {
  OTHER_SERVICE_ID,
  railItemsFrom,
  spineCountsFrom,
  useServiceLabel,
} from './serviceLabels'
```

`facets.services` already arrives ordered with `other` last and empties
omitted — do not re-sort or re-filter it.

In both `desktopRows` branches (:315-325 and :328-338), delete the
`formKindOf` block. The server already scoped the main list, but the debounced
**search** query is not service-scoped, so keep a client guard there only:

```ts
          if (railService !== 'all' && row.service_id !== railService) return false
```

Update the `useMemo` dependency arrays: `railKind` → `railService`. Update the
`FormRail` render at :467 to `active={railService} onChange={setRailService}`.

`OTHER_SERVICE_ID` is only needed once Task 8 lands — leave it out of the import
until then, or eslint's unused-import rule will fail the build.

- [ ] **Step 5: Invalidate facets wherever the list is invalidated**

Search `BooksPage.tsx` for `invalidateQueries` calls touching
`queryKey: ['books'...]`. Any mutation that changes a record's state or deletes
one must also refresh the counts. A prefix invalidation of `['books']` covers
both `['books','all',…]` and `['books','facets']` — verify each call site
either uses the bare `['books']` prefix or adds `['books','facets']`.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm -C frontend exec vitest run src/pages/books
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
```

Expected: all pass. `main` carries some pre-existing eslint/mypy baseline noise
— compare against the Task 0 baseline and only fix what this task introduced.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/books/BooksPage.tsx frontend/src/pages/books/FormRail.tsx frontend/src/pages/books/serviceLabels.ts frontend/src/pages/books/serviceFacets.test.tsx
git commit -m "feat(records): 17-service rail and scoped spine from /books/facets"
```

---

### Task 8: Service filter on mobile

**Files:**
- Modify: `frontend/src/pages/books/BooksFilterBar.tsx` (add a Service popover beside the existing Category one)
- Modify: `frontend/src/pages/books/booksFiltersUtils.ts` (`DEFAULT_BOOKS_FILTERS`, `normalizeFilters`)
- Modify: `frontend/src/pages/books/BooksPage.tsx` (apply the filter on the mobile branch)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/pages/books/BooksFilterBar.service.test.tsx`

**Interfaces:**
- Consumes: `useServiceLabel`, `serviceGlyph`, `api.getBookFacets()` (via `BooksPage`)
- Produces: `BooksFilters.serviceId: string` (`'all'` when unset)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/books/BooksFilterBar.service.test.tsx`:

```tsx
/**
 * Mobile service filter. Deliberately NOT called "Category": that word already
 * means the 12 ref-number buckets in this same bar.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { BooksFilterBar, type BooksFilters } from './BooksFilterBar'
import type { ServiceFacetRead } from '@/lib/api'

// Arabic throughout: an EN-only assertion cannot catch an AR leak here.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => {
      const ar: Record<string, string> = {
        'books.filters.category': 'التصنيف',
        'books.filters.service': 'النموذج',
        'books.filters.serviceAll': 'الكل',
        'books.filters.categoryAll': 'الكل',
        'books.filters.clear': 'مسح',
      }
      return ar[k] ?? k
    },
    i18n: { language: 'ar' },
  }),
}))

vi.mock('./serviceLabels', () => ({
  OTHER_SERVICE_ID: 'other',
  serviceGlyph: () => '📊',
  useServiceLabel: () => (id: string) => (id === 'Report' ? 'تقرير' : id),
}))

const SERVICES: ServiceFacetRead[] = [
  { id: 'Report', count: 6, states: { none: 6 } },
  { id: 'other', count: 1, states: { none: 1 } },
]

const BASE: BooksFilters = {
  categoryIds: [],
  direction: 'all',
  status: 'all',
  fromDate: '',
  toDate: '',
  q: '',
  drafts: false,
  serviceId: 'all',
}

function setup(filters: Partial<BooksFilters> = {}) {
  const onChange = vi.fn()
  render(
    <BooksFilterBar
      filters={{ ...BASE, ...filters }}
      categories={[]}
      services={SERVICES}
      onChange={onChange}
    />,
  )
  return { onChange }
}

describe('BooksFilterBar service filter', () => {
  it('renders a Service trigger distinct from the Category trigger', () => {
    setup()
    const category = screen.getByTestId('category-filter')
    const service = screen.getByTestId('service-filter')
    expect(category).not.toBe(service)
    expect(service.textContent).toContain('النموذج')
    expect(category.textContent).not.toContain('النموذج')
  })

  it('labels the trigger in ARABIC, not English', () => {
    setup()
    expect(screen.getByTestId('service-filter').textContent).not.toContain('Service')
  })

  it('selecting a service reports its id', async () => {
    const { onChange } = setup()
    await userEvent.click(screen.getByTestId('service-filter'))
    await userEvent.click(screen.getByText('تقرير'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 'Report' }))
  })

  it('counts as an active filter and Clear resets it to all', async () => {
    const { onChange } = setup({ serviceId: 'Report' })
    await userEvent.click(screen.getByText('مسح'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 'all' }))
  })
})
```

**Note:** the `Clear` button only renders when `isAnyFilterActive` is true, so the
last test doubles as the check that `serviceId !== 'all'` was added to that
condition.

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm -C frontend exec vitest run src/pages/books/BooksFilterBar.service.test.tsx
```

- [ ] **Step 3: Add the locale keys**

`frontend/src/locales/en.json`, in the `books.filters` object:

```json
      "service": "Service",
      "serviceAll": "All"
```

`frontend/src/locales/ar.json`, same object:

```json
      "service": "النموذج",
      "serviceAll": "الكل"
```

- [ ] **Step 4: Extend the filter shape**

In `booksFiltersUtils.ts` add `serviceId: 'all'` to `DEFAULT_BOOKS_FILTERS` and
make `normalizeFilters` default a missing/empty `serviceId` to `'all'` (the file
already does this merge for other late-added fields — follow its pattern).

In `BooksFilterBar.tsx` add `serviceId: string` to the `BooksFilters` interface,
add `filters.serviceId !== 'all'` to `isAnyFilterActive`, add
`serviceId: 'all'` to the `clear()` object, and add a **single-select** popover
next to the category one — same trigger and listbox classes, `role="listbox"`
without `aria-multiselectable`, `data-testid="service-filter"`, label
`t('books.filters.service')`, and an "All" option at the top plus one option per
entry in a new `services: ServiceFacetRead[]` prop, labelled with
`useServiceLabel()` and prefixed with `serviceGlyph(s.id)`.

- [ ] **Step 5: Wire it in `BooksPage`**

Pass `services={facetsQuery.data?.services ?? []}` to `BooksFilterBar`, and in
the mobile row filtering add:

```ts
      if (filters.serviceId !== 'all' && row.service_id !== filters.serviceId) return false
```

next to the existing mobile filter predicates.

- [ ] **Step 6: Run tests, typecheck, lint**

```bash
pnpm -C frontend exec vitest run src/pages/books
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/books/BooksFilterBar.tsx frontend/src/pages/books/booksFiltersUtils.ts frontend/src/pages/books/BooksPage.tsx frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/pages/books/BooksFilterBar.service.test.tsx
git commit -m "feat(records): service filter on the mobile filter bar"
```

---

### Task 9: Collapse the drafts card

**Files:**
- Modify: `frontend/src/pages/books/BooksPage.tsx` (:515-556)

**Interfaces:**
- Consumes: `draftBooks` (existing memo at :304-307)
- Produces: nothing new — a markup change only

**No test for this one.** It is a markup swap to a native element with no
branching logic of its own: `<details>` supplies the collapse, the existing
`draftBooks.length > 0` condition is unchanged, and there is no `BooksPage`
render harness to extend. Verify it by eye in Step 4 instead. If a future change
adds real state here (remembering the open/closed choice, for instance), that
change gets the test.

- [ ] **Step 1: Wrap the card**

At `BooksPage.tsx:515`, keep the `draftBooks.length > 0 && !showDrafts`
condition and the outer wrapper `<div>`, but replace the inner
`<div className="rounded-xl border border-dashed …">` with a `<details>`
carrying those same classes, and move the existing header row into a
`<summary>`:

```tsx
                      <details className="group rounded-xl border border-dashed border-warning/50 bg-warning-soft/30 p-3">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm">
                          <span className="flex items-center gap-1.5 text-[0.75em] font-bold uppercase tracking-[0.07em] text-warning">
                            <ChevronRight
                              aria-hidden
                              className="h-3.5 w-3.5 transition-transform group-open:rotate-90 rtl:-scale-x-100"
                            />
                            {t('books.filters.drafts')} ({draftBooks.length})
                          </span>
                        </summary>
                        <div className="mt-2 flex flex-col gap-1.5">
                          {/* the existing draftBooks.slice(0, 3).map(...) rows and
                              the "+N more" button, unchanged */}
                        </div>
                      </details>
```

Notes:
- `list-none` (plus Tailwind's `[&::-webkit-details-marker]:hidden` if the
  native triangle still shows) removes the default marker; the `ChevronRight`
  rotated by `group-open:` replaces it. `rtl:-scale-x-100` mirrors it in Arabic.
- The old header also held a button (:522-528). Keep it, but move it **outside**
  the `<summary>` or give it `onClick={(e) => e.stopPropagation()}` — a click on
  a control inside a `<summary>` also toggles the `<details>`.
- Import `ChevronRight` from `lucide-react` (the file already imports from it).
- No `open` attribute: collapsed is the default. No persistence — out of scope.

- [ ] **Step 2: Typecheck and lint**

```bash
pnpm -C frontend exec vitest run src/pages/books
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
```

- [ ] **Step 3: Verify it by eye**

```bash
pnpm -C frontend run build
```

Then load the Records page in the running app (or `scripts\mng.ps1 deploy` if the
service is the only way to reach it) and confirm, with at least one draft
present: the card shows a single collapsed line with the count; clicking it
expands the draft rows; the chevron rotates; under Arabic the chevron points the
other way; and the "+N more" / Word-action buttons inside still work without
collapsing the card.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/books/BooksPage.tsx
git commit -m "feat(records): collapse the drafts card by default"
```

---

### Task 10: Remove the dead locale keys and run every gate

**Files:**
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Modify: `docs/superpowers/plans/2026-07-30-records-service-categories.md` (tick the boxes)

**Interfaces:**
- Consumes: everything above
- Produces: a branch ready to review and merge

- [x] **Step 1: Delete the eight superseded keys**

Under `books.formKind` in **both** `en.json` and `ar.json`, remove exactly:
`leave`, `salary`, `duty`, `hr`, `passport`, `material`, `generalBook`,
`report`. **Keep** `all` and `other` — both are still used.

- [x] **Step 2: Prove nothing references them**

```bash
grep -rn "formKind\.\(leave\|salary\|duty\|hr\|passport\|material\|generalBook\|report\)" frontend/src
```

Expected: no matches. Any hit means a consumer was missed in Task 6 or 7.

- [x] **Step 3: Check EN/AR key parity**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -c "import json; a=json.load(open('frontend/src/locales/en.json',encoding='utf-8')); b=json.load(open('frontend/src/locales/ar.json',encoding='utf-8')); f=lambda d,p='': {k2 for k,v in d.items() for k2 in (f(v,p+k+'.') if isinstance(v,dict) else {p+k})}; x,y=f(a),f(b); print('EN only:',sorted(x-y)); print('AR only:',sorted(y-x))"
```

Expected: both lists unchanged from the Task 0 baseline (run the same command
before editing to capture it). New drift means a missing translation.

- [x] **Step 4: Run every gate**

```bash
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest -q
C:/Users/Admin/sentinel/venv/Scripts/ruff.exe check . && C:/Users/Admin/sentinel/venv/Scripts/ruff.exe format --check .
C:/Users/Admin/sentinel/venv/Scripts/mypy.exe
pnpm -C frontend test -- --run
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
pnpm -C frontend run build
```

Expected: no NEW failures and no failures in files this branch touched — not
literal all-green. Compare against "Gate drift measured on `main`" above:
pytest should still show exactly the one `test_dav.py` failure (count at or
above 815), vitest exactly the one `TemplateForm.bodyMode.test.tsx` failure
(count at or above 437), ruff/format/mypy/lint counts unchanged and in the
same unrelated files. `build` writes into `backend/app/static/` — **do not
commit that output**; it is built at deploy time.

- [x] **Step 5: Run the mandatory reviewer agents**

Both are required by `CLAUDE.md` for this change:
- `i18n-rtl-reviewer` — new labels, the mobile Service popover, the RTL chevron.
- `notification-template-reviewer` — only if any notification copy was touched
  (it should not have been; if the diff is clean of `notify_format.py` /
  `sms_templates.py`, say so and skip).

Fix anything they raise, then re-run Step 4.

- [x] **Step 6: Verify against the live database one last time**

Re-run the Task 4 Step 5 command. The distribution must still be exactly the 17
figures listed there, totalling 629.

- [x] **Step 7: Confirm the diff contains no churn**

```bash
git status --porcelain
git diff --stat main...HEAD
```

Expected: no `backend/templates/*.docx`, no `backend/app/static/`, no
`frontend/node_modules`. If templates churned, `git checkout -- backend/templates/`.

- [x] **Step 8: Commit the plan with its boxes ticked**

```bash
git add docs/superpowers/plans/2026-07-30-records-service-categories.md frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "chore(records): drop the superseded formKind locale keys"
```

---

## Notes for the reviewer

Two places deviate from the letter of the spec, both to reduce work:

1. **`/books/facets` does not carry `name_en` / `name_ar`.** The spec had it
   bundling names so the frontend needed no second request. Labels instead come
   from the already-cached `/templates` query (`useServiceLabel`), because the
   row badge in `RecordsList` and the pane header need a label for a *single*
   record and facets would not have served them. One name source, one query,
   fewer moving parts.
2. **`resolve_service` takes an explicit `versioned: bool`** rather than
   inferring "no version" from `template_id is None`. One live version row has a
   NULL `template_id`; conflating the two cases would send such a record back
   down the subject-guessing path.
3. **The rail and spine derivations are pure functions in `serviceLabels.ts`,
   tested without a DOM.** This repo has no `BooksPage` render test, and
   building one would mean mocking the api module, the router, capabilities,
   i18n and five queries to assert arithmetic. The logic moved out instead;
   `BooksPage` is left holding only wiring. The drafts collapse (Task 9) ships
   with no automated test at all — it is a swap to a native `<details>` with no
   logic of its own — and is verified by eye in that task's Step 3.

Everything else — the alias table, the 17 + All + Other rail, hide-when-empty,
server-side filtering, service-scoped spine, the collapsible drafts card — is as
approved.
