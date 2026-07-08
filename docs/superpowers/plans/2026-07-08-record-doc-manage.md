# Record Document Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators always view a record's original generated form, and delete or replace a wrongly-uploaded scan — whether it was filed as a plain attachment or as the signed/approved copy.

**Architecture:** Backend gains an `original=true` bypass on the document download (serves `Document.pdf_path` even when signed-locked) plus four `books.manage` mutation routes over the two attachment sources (`Book.attachment_paths[i]` and `BookVersion.signed_pdf_path`). Frontend renders *Original form* and *Signed copy* as distinct film-strip papers and wires per-paper Delete/Replace across all three record surfaces.

**Tech Stack:** FastAPI (Python 3.12) + SQLAlchemy/SQLite, React 19 + TypeScript, React Query, Radix, Tailwind 4, pytest, vitest.

## Global Constraints

- **Live checkout:** every change must be committed and pushed to `origin/main` when merged, or `mng update` overwrites it. Work happens on branch `feat/record-doc-manage-impl`.
- **Strict gates:** mypy `strict`; pytest runs with `filterwarnings=error`; `pnpm exec tsc -b --noEmit` and `pnpm run lint` must pass.
- **API contract is generated:** after any Pydantic/route change run the `/sync-api-types` flow and commit `openapi.json` + `api.types.ts` together.
- **Bilingual:** every new UI string needs `en.json` + `ar.json` parity; use logical CSS (`ms-`/`me-`, `text-start`/`text-end`). Run `i18n-rtl-reviewer` after touching bilingual surfaces.
- **Permissions:** mutating routes require `books.manage`; `original=true` viewing requires `books.view`.
- **Backend test fixtures:** service-level tests use the `db_session` fixture (`backend/tests/conftest.py`) and build `Book`/`BookVersion` rows directly. API-level tests mirror `backend/tests/test_sms_api.py`: `create_app()` + `app.dependency_overrides[get_db]`/`[get_current_user]`, `TestClient(app, raise_server_exceptions=True)`. File-writing tests must point the data dir at `tmp_path` via `monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))` + `get_settings.cache_clear()`.
- All Python runs through the repo venv: `venv\Scripts\python.exe -m pytest ...`, `venv\Scripts\ruff.exe`, `venv\Scripts\mypy.exe`.

---

### Task 1: View the original form (`download_document?original=true`)

**Files:**
- Modify: `backend/app/api/v1/documents.py` (`download_document`, ~line 345-461)
- Test: `backend/tests/test_document_download_original.py` (create)

**Interfaces:**
- Produces: `GET /api/v1/documents/{id}/download?format=pdf&original=true` → serves `Document.pdf_path` bytes even when the version is signed-locked; requires `books.view`; 404 `PDF_NOT_AVAILABLE` when `pdf_path` is `None`. Honours `encoding=base64`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_document_download_original.py`. Build a signed-locked version, then assert `original=true` returns the original PDF bytes, not the signed artifact. Reuse the `api_db`/`_client` pattern from `test_sms_api.py`.

```python
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, Book, BookCategory, BookVersion, Document, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    from app.config import get_settings
    get_settings.cache_clear()
    eng = create_engine(f"sqlite:///{tmp_path/'t.db'}", future=True,
                        connect_args={"check_same_thread": False})
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TS = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TS)
    db = TS()
    perm_service.seed_role_defaults(db)
    try:
        yield db
    finally:
        db.close()
        get_settings.cache_clear()


def _user(db, role="manager"):
    u = User(email=f"{role}@x.ae", password_hash="x", role=role, status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def _client(db, user):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _signed_book(db, tmp_path):
    """A book whose current version is signed: pdf_path = original, signed_pdf_path = scan."""
    (tmp_path / "documents").mkdir(exist_ok=True)
    (tmp_path / "book_attachments").mkdir(exist_ok=True)
    orig = tmp_path / "documents" / "orig.pdf"
    orig.write_bytes(b"%PDF-ORIGINAL")
    signed = tmp_path / "book_attachments" / "signed-v1.pdf"
    signed.write_bytes(b"%PDF-SIGNED-SCAN")
    db.add(BookCategory(id="HR", prefix="HR"))
    db.flush()
    book = Book(category_id="HR", ref_number="HR-1", approval_state="approved",
                signing_path="scan")
    db.add(book); db.flush()
    doc = Document(pdf_path="documents/orig.pdf", docx_path="documents/orig.docx")
    db.add(doc); db.flush()
    db.add(BookVersion(book_id=book.id, version_no=1, status="approved",
                       document_id=doc.id, signed_pdf_path="book_attachments/signed-v1.pdf"))
    db.commit()
    return book, doc


def test_original_true_serves_pre_signature_pdf(api_db, tmp_path):
    _book, doc = _signed_book(api_db, tmp_path)
    c = _client(api_db, _user(api_db))
    # default: swapped to the signed scan
    assert c.get(f"/api/v1/documents/{doc.id}/download?format=pdf").content == b"%PDF-SIGNED-SCAN"
    # original=true: the generated original
    resp = c.get(f"/api/v1/documents/{doc.id}/download?format=pdf&original=true")
    assert resp.status_code == 200
    assert resp.content == b"%PDF-ORIGINAL"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_document_download_original.py -v`
Expected: FAIL — `original=true` currently returns the signed scan bytes (the param is ignored).

- [ ] **Step 3: Implement the `original` bypass**

In `download_document`, add the query param and short-circuit BEFORE the `locked` swap. Insert `original` in the signature and a branch after the `row` lookup / settings:

```python
    format: Literal["docx", "pdf"] = Query("pdf"),
    original: Annotated[bool, Query()] = False,
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
```

After `row` is fetched and `settings = get_settings()` is set, before the `locked, signed_rel = ...` line, add:

```python
    # `original=true` returns the pre-signature generated PDF even when the
    # version is signed-locked (the default download swaps in the signed
    # artifact). Lets the UI always show the original form next to the signed
    # copy. books.view is sufficient — an original form is viewable by anyone
    # who can view the record.
    if original:
        if not perm_service.has_capability(db, user, "books.view"):
            raise AppError("FORBIDDEN", "You don't have permission to download this document",
                           http_status=status.HTTP_403_FORBIDDEN)
        if not row.pdf_path:
            raise NotFoundError("PDF_NOT_AVAILABLE",
                                f"No PDF rendition exists for document {document_id}", id=document_id)
        file_path = settings.data_dir / row.pdf_path
        # containment + existence checks reuse the block below via a helper path:
        _data_dir_resolved = settings.data_dir.resolve()
        try:
            _fr = file_path.resolve()
        except OSError:
            _fr = file_path
        if _data_dir_resolved not in _fr.parents and _fr != _data_dir_resolved:
            raise NotFoundError("FILE_NOT_FOUND", f"File not found on disk for document {document_id}", id=document_id)
        if not file_path.is_file():
            raise NotFoundError("FILE_NOT_FOUND", f"File not found on disk for document {document_id}", id=document_id)
        if (b64 := maybe_base64(file_path.read_bytes(), encoding)) is not None:
            return b64
        return FileResponse(path=str(file_path), media_type="application/pdf",
                            filename=document_service.download_filename_for(row, ".pdf"),
                            content_disposition_type="inline")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_document_download_original.py -v`
Expected: PASS. Then `venv\Scripts\mypy.exe backend/app/api/v1/documents.py` and `venv\Scripts\ruff.exe check backend/app/api/v1/documents.py` clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/documents.py backend/tests/test_document_download_original.py
git commit -m "feat(records): serve the original form via ?original=true even when signed-locked"
```

---

### Task 2: Delete a plain attachment

**Files:**
- Modify: `backend/app/api/v1/books.py` (add route after `get_book_attachment`, ~line 574)
- Test: `backend/tests/test_book_attachment_manage.py` (create)

**Interfaces:**
- Consumes: `book_service.detach_attachment(db, book_id, rel_path)` (exists), `book_service.get_book`.
- Produces: `DELETE /api/v1/books/{book_id}/attachments/{index}` → `BookRead`; 404 when index out of range; cap `books.manage`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_book_attachment_manage.py` with the same `api_db`/`_user`/`_client` helpers as Task 1 (copy them; DRY across a shared local helper module is optional). Seed a book with two plain attachments on disk + in `attachment_paths`, then delete index 0.

```python
def _book_with_attachments(db, tmp_path):
    (tmp_path / "book_attachments" / "1").mkdir(parents=True, exist_ok=True)
    for name in ("a.pdf", "b.pdf"):
        (tmp_path / "book_attachments" / "1" / name).write_bytes(b"%PDF-" + name.encode())
    db.add(BookCategory(id="HR", prefix="HR")); db.flush()
    book = Book(id=1, category_id="HR", ref_number="HR-1", approval_state="none",
                attachment_paths=["book_attachments/1/a.pdf", "book_attachments/1/b.pdf"])
    db.add(book); db.flush()
    db.add(BookVersion(book_id=book.id, version_no=1, status="none"))
    db.commit()
    return book


def test_delete_attachment_removes_file_and_entry(api_db, tmp_path):
    _book_with_attachments(api_db, tmp_path)
    c = _client(api_db, _user(api_db))
    resp = c.request("DELETE", "/api/v1/books/1/attachments/0")
    assert resp.status_code == 200, resp.text
    assert resp.json()["attachment_paths"] == ["book_attachments/1/b.pdf"]
    assert not (tmp_path / "book_attachments" / "1" / "a.pdf").exists()


def test_delete_attachment_out_of_range_404(api_db, tmp_path):
    _book_with_attachments(api_db, tmp_path)
    c = _client(api_db, _user(api_db))
    assert c.request("DELETE", "/api/v1/books/1/attachments/9").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_book_attachment_manage.py -v`
Expected: FAIL — route does not exist (404 for a valid index too / method not allowed).

- [ ] **Step 3: Implement the DELETE route**

In `books.py`, after `get_book_attachment`:

```python
@router.delete("/{book_id}/attachments/{index}", response_model=BookRead)
def delete_book_attachment(
    book_id: int,
    index: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> BookRead:
    """Delete one plain attachment by its ``attachment_paths`` index (undo a
    wrongly-uploaded scan). Does not touch a signed copy — see
    ``DELETE /{book_id}/signed-copy``."""
    book = book_service.get_book(db, book_id)
    paths = book.attachment_paths or []
    if index < 0 or index >= len(paths):
        raise HTTPException(status_code=404, detail="attachment not found")
    row = book_service.detach_attachment(db, book_id, paths[index])
    item = BookRead.model_validate(row)
    item.versions = _build_versions(db, row)
    return item
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_book_attachment_manage.py -v`
Expected: PASS. mypy + ruff on `books.py` clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/books.py backend/tests/test_book_attachment_manage.py
git commit -m "feat(records): DELETE a plain attachment by index"
```

---

### Task 3: Replace a plain attachment

**Files:**
- Modify: `backend/app/services/book_service.py` (add `replace_attachment`, near `detach_attachment` ~line 1295; add to `__all__`)
- Modify: `backend/app/api/v1/books.py` (add `PUT /{book_id}/attachments/{index}`)
- Test: `backend/tests/test_book_attachment_manage.py` (extend)

**Interfaces:**
- Consumes: `book_service._safe_filename`, `ALLOWED_DOC_EXTS`, `MAX_ATTACHMENT_BYTES`, `_book_attachment_dir`, `_unique_attachment_dest`, `resolve_attachment_path`.
- Produces: `book_service.replace_attachment(db, book_id, index, filename, data) -> Book`; `PUT /api/v1/books/{book_id}/attachments/{index}` (multipart `file`) → `BookRead`; cap `books.manage`.

- [ ] **Step 1: Write the failing test**

Extend `test_book_attachment_manage.py`:

```python
def test_replace_attachment_swaps_bytes_keeps_index(api_db, tmp_path):
    _book_with_attachments(api_db, tmp_path)
    c = _client(api_db, _user(api_db))
    resp = c.put("/api/v1/books/1/attachments/0",
                 files={"file": ("new.pdf", b"%PDF-NEW", "application/pdf")})
    assert resp.status_code == 200, resp.text
    paths = resp.json()["attachment_paths"]
    assert len(paths) == 2 and paths[0].endswith("new.pdf")
    # old file gone, new served at index 0
    got = c.get(f"/api/v1/books/1/attachments/0").content
    assert got == b"%PDF-NEW"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_book_attachment_manage.py::test_replace_attachment_swaps_bytes_keeps_index -v`
Expected: FAIL — no PUT route.

- [ ] **Step 3: Implement `replace_attachment` + route**

In `book_service.py` after `detach_attachment`:

```python
def replace_attachment(
    db: Session, book_id: int, index: int, filename: str, data: bytes
) -> Book:
    """Swap the file at ``attachment_paths[index]`` for ``data`` (undo a wrong
    upload) while keeping the index stable. Validates like ``add_attachment``;
    unlinks the previous file. Raises 404 on an out-of-range index."""
    book = get_book(db, book_id)
    paths = list(book.attachment_paths or [])
    if index < 0 or index >= len(paths):
        raise NotFoundError("ATTACHMENT_NOT_FOUND", "attachment not found", index=index)
    if len(data) == 0:
        raise ValidationFailedError("BOOK_EMPTY_FILE", "Uploaded file is empty")
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ValidationFailedError("BOOK_FILE_TOO_LARGE",
            f"File exceeds {MAX_ATTACHMENT_BYTES} bytes", max_bytes=MAX_ATTACHMENT_BYTES, size=len(data))
    safe_name = _safe_filename(filename)
    ext = Path(safe_name).suffix.lower()
    if ext not in ALLOWED_DOC_EXTS:
        raise ValidationFailedError("BOOK_BAD_EXTENSION",
            f"File type {ext!r} is not allowed", allowed=sorted(ALLOWED_DOC_EXTS))
    target_dir = _book_attachment_dir(book_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = _unique_attachment_dest(target_dir, safe_name)
    data_dir = get_settings().data_dir.resolve()
    dest_resolved = dest.resolve()
    if data_dir not in dest_resolved.parents:
        raise AppError("BOOK_PATH_ESCAPE", "Resolved attachment path escaped the data directory", http_status=500)
    dest.write_bytes(data)
    old_rel = paths[index]
    paths[index] = dest_resolved.relative_to(data_dir).as_posix()
    book.attachment_paths = paths
    old_abs = resolve_attachment_path(old_rel)
    if old_abs is not None:
        try:
            old_abs.unlink()
        except OSError:
            log.warning("replace_attachment: could not unlink %s", old_abs)
    db.commit()
    db.refresh(book)
    return book
```

Add `"replace_attachment"` to `__all__`. In `books.py`:

```python
@router.put("/{book_id}/attachments/{index}", response_model=BookRead)
async def replace_book_attachment(
    book_id: int,
    index: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> BookRead:
    """Replace one plain attachment's bytes, keeping its index."""
    data = await upload.read()
    row = book_service.replace_attachment(db, book_id, index, upload.filename or "scan", data)
    item = BookRead.model_validate(row)
    item.versions = _build_versions(db, row)
    return item
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_book_attachment_manage.py -v`
Expected: PASS. mypy + ruff clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/book_service.py backend/app/api/v1/books.py backend/tests/test_book_attachment_manage.py
git commit -m "feat(records): PUT replace a plain attachment in place"
```

---

### Task 4: Replace a signed copy (keep approval)

**Files:**
- Modify: `backend/app/services/book_service.py` (add `replace_signed_copy`; `__all__`)
- Modify: `backend/app/api/v1/books.py` (add `PUT /{book_id}/signed-copy`)
- Test: `backend/tests/test_signed_copy_manage.py` (create)

**Interfaces:**
- Consumes: `_current_version`, `_image_to_pdf_bytes`, `_book_attachment_dir`, `_unique_attachment_dest`, `resolve_attachment_path`, `_safe_filename`, `ALLOWED_DOC_EXTS`, `MAX_ATTACHMENT_BYTES`.
- Produces: `book_service.replace_signed_copy(db, book_id, filename, data, *, user) -> Book`; `PUT /api/v1/books/{book_id}/signed-copy` (multipart `file`) → `BookRead`; cap `books.manage`. Approval state unchanged.

- [ ] **Step 1: Write the failing test**

Create `test_signed_copy_manage.py` (copy the `api_db`/`_user`/`_client` helpers + a `_signed_scanback_book` builder that mirrors Task 1's `_signed_book` but with `signing_path="scan"`, `approval_state="approved"`, `signed_by_user_id` set). Service-level assertion is enough here:

```python
from app.services import book_service


def test_replace_signed_copy_swaps_bytes_keeps_approved(api_db, tmp_path):
    book = _signed_scanback_book(api_db, tmp_path)   # approval_state == "approved"
    user = _user(api_db)
    book_service.replace_signed_copy(api_db, book.id, "fixed.pdf", b"%PDF-FIXED", user=user)
    api_db.refresh(book)
    v = book.versions[-1]
    assert book.approval_state == "approved"
    assert v.signed_pdf_path is not None
    assert (tmp_path / v.signed_pdf_path).read_bytes() == b"%PDF-FIXED"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_signed_copy_manage.py::test_replace_signed_copy_swaps_bytes_keeps_approved -v`
Expected: FAIL — `AttributeError: replace_signed_copy`.

- [ ] **Step 3: Implement `replace_signed_copy` + route**

```python
def replace_signed_copy(
    db: Session, book_id: int, filename: str, data: bytes, *, user: User | None = None
) -> Book:
    """Swap the signed artifact's bytes without changing approval state — the
    'I filed the wrong signed scan' fix. Image scans are converted to PDF, as in
    the scan-back flip. Raises if the current version carries no signed copy."""
    book = get_book(db, book_id)
    version = _current_version(book)
    if version is None or not version.signed_pdf_path:
        raise ValidationFailedError("NO_SIGNED_COPY", "This record has no signed copy to replace")
    if len(data) == 0:
        raise ValidationFailedError("BOOK_EMPTY_FILE", "Uploaded file is empty")
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ValidationFailedError("BOOK_FILE_TOO_LARGE",
            f"File exceeds {MAX_ATTACHMENT_BYTES} bytes", max_bytes=MAX_ATTACHMENT_BYTES, size=len(data))
    ext = Path(_safe_filename(filename)).suffix.lower()
    if ext not in ALLOWED_DOC_EXTS:
        raise ValidationFailedError("BOOK_BAD_EXTENSION",
            f"File type {ext!r} is not allowed", allowed=sorted(ALLOWED_DOC_EXTS))
    if ext != ".pdf":
        data = _image_to_pdf_bytes(data, ext)
    target_dir = _book_attachment_dir(book_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = _unique_attachment_dest(target_dir, f"signed-v{version.version_no}.pdf")
    data_dir = get_settings().data_dir.resolve()
    dest_resolved = dest.resolve()
    if data_dir not in dest_resolved.parents:
        raise AppError("BOOK_PATH_ESCAPE", "Resolved attachment path escaped the data directory", http_status=500)
    dest.write_bytes(data)
    old_abs = resolve_attachment_path(version.signed_pdf_path)
    version.signed_pdf_path = dest_resolved.relative_to(data_dir).as_posix()
    version.signed_by_user_id = user.id if user is not None else version.signed_by_user_id
    version.signed_at = datetime.now(UTC).replace(tzinfo=None)
    if old_abs is not None:
        try:
            old_abs.unlink()
        except OSError:
            log.warning("replace_signed_copy: could not unlink %s", old_abs)
    db.commit()
    db.refresh(book)
    return book
```

Add `"replace_signed_copy"` to `__all__`. Route in `books.py`:

```python
@router.put("/{book_id}/signed-copy", response_model=BookRead)
async def replace_signed_copy(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.manage"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> BookRead:
    """Replace the signed copy's bytes, keeping the record approved."""
    data = await upload.read()
    row = book_service.replace_signed_copy(db, book_id, upload.filename or "signed", data, user=user)
    item = BookRead.model_validate(row)
    item.versions = _build_versions(db, row)
    return item
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_signed_copy_manage.py -v`
Expected: PASS. mypy + ruff clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/book_service.py backend/app/api/v1/books.py backend/tests/test_signed_copy_manage.py
git commit -m "feat(records): PUT replace the signed copy without un-approving"
```

---

### Task 5: Unfile (delete) a signed copy — revert approval

**Files:**
- Modify: `backend/app/services/book_service.py` (add `unfile_signed_copy`; `__all__`)
- Modify: `backend/app/api/v1/books.py` (add `DELETE /{book_id}/signed-copy`)
- Test: `backend/tests/test_signed_copy_manage.py` (extend)

**Interfaces:**
- Consumes: `_current_version`, `_approver_steps`, `_recompute_approval_state`, `resolve_attachment_path`, `correspondence_service.log_event`.
- Produces: `book_service.unfile_signed_copy(db, book_id) -> Book`; `DELETE /api/v1/books/{book_id}/signed-copy` → `BookRead`; cap `books.manage`. Reverts `signing_path=="scan"` → `awaiting_scan`; else reopens flip-approved steps (`decided_at == signed_at`) → `pending`/`none`. Logs a compensating `book_unsigned` correspondence event.

- [ ] **Step 1: Write the failing tests**

Extend `test_signed_copy_manage.py`. Two cases: scan-path → `awaiting_scan`; as_signed digital → `pending` with only the flip-approved step reopened.

```python
from datetime import datetime

from app.db.models import BookApprovalStep


def test_unfile_signed_scanpath_reverts_to_awaiting_scan(api_db, tmp_path):
    book = _signed_scanback_book(api_db, tmp_path)   # signing_path == "scan"
    book_service.unfile_signed_copy(api_db, book.id)
    api_db.refresh(book)
    v = book.versions[-1]
    assert book.approval_state == "awaiting_scan"
    assert v.status == "awaiting_scan"
    assert v.signed_pdf_path is None and v.signed_at is None


def test_unfile_signed_assigned_reopens_only_flip_step(api_db, tmp_path):
    # digital record: one human-approved step + one flip-approved step
    book = _assigned_signed_book(api_db, tmp_path)   # signing_path == "in_app"
    v = book.versions[-1]
    flip_at = v.signed_at
    # step 1 approved earlier by a human (decided_at != flip_at); step 2 approved by the flip
    book_service.unfile_signed_copy(api_db, book.id)
    api_db.refresh(book)
    steps = sorted(v.approval_steps, key=lambda s: s.step_order)
    assert steps[0].state == "approved"        # human approval preserved
    assert steps[1].state == "pending"         # flip approval reopened
    assert book.approval_state == "pending"
    assert v.signed_pdf_path is None
```

(The `_assigned_signed_book` builder creates a `BookVersion` with `signed_at = flip_at`, two `BookApprovalStep` rows — `step_order` 1 with `state="approved", decided_at=<earlier>`, `step_order` 2 with `state="approved", decided_at=flip_at`, both `kind` absent/approver.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_signed_copy_manage.py -k unfile -v`
Expected: FAIL — `AttributeError: unfile_signed_copy`.

- [ ] **Step 3: Implement `unfile_signed_copy` + route**

```python
def unfile_signed_copy(db: Session, book_id: int) -> Book:
    """Undo a filed signed copy: delete the artifact and revert the record to
    its pre-signed state. scan-path forms return to ``awaiting_scan``; otherwise
    the approver steps the scan auto-approved (``decided_at == signed_at``) are
    reopened and the state recomputed. Leaves the original 'signed' correspondence
    entry in place and logs a compensating ``book_unsigned`` event."""
    book = get_book(db, book_id)
    version = _current_version(book)
    if version is None or not version.signed_pdf_path:
        raise ValidationFailedError("NO_SIGNED_COPY", "This record has no signed copy to unfile")
    flip_at = version.signed_at
    old_abs = resolve_attachment_path(version.signed_pdf_path)
    version.signed_pdf_path = None
    version.signed_by_user_id = None
    version.signed_at = None
    if book.signing_path == "scan":
        version.status = "awaiting_scan"
        book.approval_state = "awaiting_scan"
    else:
        for step in _approver_steps(version):
            if step.state == "approved" and step.decided_at == flip_at:
                step.state = "pending"
                step.decided_at = None
        _recompute_approval_state(book)
    if old_abs is not None:
        try:
            old_abs.unlink()
        except OSError:
            log.warning("unfile_signed_copy: could not unlink %s", old_abs)
    try:
        from app.services import correspondence_service

        correspondence_service.log_event(
            db,
            trigger="book_unsigned",
            source_kind="generated_doc",
            source_book_id=book.id,
            subject=(book.subject or book.ref_number)[:255],
            employee_id=book.employee_id,
            submitter=None,
            entry_date=date.today(),
            condition_fields={"category": book.category_id},
            direction="outgoing",
        )
    except Exception:
        log.warning("correspondence auto-log failed on unfile for book %s", book.id, exc_info=True)
    db.commit()
    db.refresh(book)
    return book
```

Add `"unfile_signed_copy"` to `__all__`. Route:

```python
@router.delete("/{book_id}/signed-copy", response_model=BookRead)
def unfile_signed_copy(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> BookRead:
    """Undo a filed signed copy and revert the record's approval state."""
    row = book_service.unfile_signed_copy(db, book_id)
    item = BookRead.model_validate(row)
    item.versions = _build_versions(db, row)
    return item
```

**Note:** verify `correspondence_service.log_event` accepts `trigger="book_unsigned"` (it may validate against a known-trigger set). If it rejects unknown triggers, add `book_unsigned` to that set in the same commit, or reuse the nearest existing trigger and document it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_signed_copy_manage.py -v`
Expected: PASS (all). mypy + ruff clean. Then full backend suite: `venv\Scripts\python.exe -m pytest`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/book_service.py backend/app/api/v1/books.py backend/tests/test_signed_copy_manage.py
git commit -m "feat(records): DELETE unfile a signed copy and revert approval state"
```

---

### Task 6: Sync API types

**Files:**
- Modify: `backend/openapi.json`, `frontend/src/lib/api.types.ts` (generated)

**Interfaces:**
- Produces: regenerated types reflecting the four new routes + `original` query param.

- [ ] **Step 1: Regenerate**

Run the `/sync-api-types` flow: dump openapi, `pnpm -C frontend gen:api`, then `pnpm -C frontend exec tsc -b --noEmit`.
Expected: types regenerate; typecheck clean.

- [ ] **Step 2: Commit**

```bash
git add backend/openapi.json frontend/src/lib/api.types.ts
git commit -m "chore(api): sync types for record document management routes"
```

---

### Task 7: Frontend — distinct Original-form + Signed-copy papers

**Files:**
- Modify: `frontend/src/pages/books/recordPapers.ts`
- Test: `frontend/src/pages/books/recordPapers.test.ts` (create)

**Interfaces:**
- Produces: `Paper` gains `attachmentIndex?: number` (set on `kind === 'scan'`). The generated/original paper URL always carries `&original=true`. A `signed` paper is emitted when the version is approved + has `signed_pdf_url`. Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

Create `recordPapers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { papersOf } from './recordPapers'

const signedBook = {
  id: 1, ref_number: 'HR-1',
  versions: [{ version_no: 1, document_id: 5, status: 'approved',
               signed_pdf_url: '/api/v1/documents/5/download?format=pdf' }],
  attachment_paths: ['book_attachments/1/scan.pdf'],
}

describe('papersOf', () => {
  it('emits a distinct original-form paper and a signed-copy paper', () => {
    const kinds = papersOf(signedBook as never).map((p) => p.kind)
    expect(kinds).toContain('generated')
    expect(kinds).toContain('signed')
    const original = papersOf(signedBook as never).find((p) => p.kind === 'generated')!
    expect(original.url).toContain('original=true')
  })
  it('tags scan papers with their attachment index', () => {
    const scan = papersOf(signedBook as never).find((p) => p.kind === 'scan')!
    expect(scan.attachmentIndex).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/books/recordPapers.test.ts`
Expected: FAIL — original paper URL lacks `original=true`; `attachmentIndex` undefined.

- [ ] **Step 3: Implement**

In `recordPapers.ts`: add `attachmentIndex?: number` to the `Paper` interface. Change the generated-paper URL to `` `/api/v1/documents/${docId}/download?format=pdf&original=true` `` (keep `downloadUrl` the same). In the attachments loop, set `attachmentIndex: index` on each scan paper. The signed paper block is already present — leave it. Update `paperCountOf` only if the count logic changes (it does not).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/pages/books/recordPapers.test.ts`
Expected: PASS. `pnpm -C frontend exec tsc -b --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/books/recordPapers.ts frontend/src/pages/books/recordPapers.test.ts
git commit -m "feat(records): render original form and signed copy as distinct papers"
```

---

### Task 8: Frontend — manage-paper hook + film-strip actions

**Files:**
- Create: `frontend/src/pages/books/useManagePaper.ts`
- Modify: `frontend/src/lib/api.ts` (client methods)
- Modify: `frontend/src/pages/books/RecordPaperViewer.tsx` (per-paper Delete/Replace in the toolbar)
- Modify: `frontend/src/pages/books/RecordPane.tsx` (wire hook + confirm dialogs + replace file input)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/pages/books/useManagePaper.test.ts` (create)

**Interfaces:**
- Consumes: `Paper` (Task 7), the four routes (Task 6).
- Produces: `api.deleteBookAttachment(bookId, index)`, `api.replaceBookAttachment(bookId, index, file)`, `api.replaceSignedCopy(bookId, file)`, `api.unfileSignedCopy(bookId)` → `Promise<BookRead>`. `useManagePaper(bookId)` returning `{ busy, deletePaper(paper), replacePaper(paper, file) }` that routes by `paper.kind` and invalidates `['books']`.

- [ ] **Step 1: Add API client methods**

In `api.ts` near `addBookAttachment`:

```ts
  deleteBookAttachment: (bookId: number, index: number) =>
    request<BookRead>('DELETE', `/books/${bookId}/attachments/${index}`),
  replaceBookAttachment: (bookId: number, index: number, file: File) => {
    const form = new FormData(); form.append('file', file)
    return multipart<BookRead>(`/books/${bookId}/attachments/${index}`, form, 'PUT')
  },
  replaceSignedCopy: (bookId: number, file: File) => {
    const form = new FormData(); form.append('file', file)
    return multipart<BookRead>(`/books/${bookId}/signed-copy`, form, 'PUT')
  },
  unfileSignedCopy: (bookId: number) =>
    request<BookRead>('DELETE', `/books/${bookId}/signed-copy`),
```

Check the `multipart` helper signature — if it does not accept a method arg, add an optional `method = 'POST'` parameter and pass it through to `fetch`.

- [ ] **Step 2: Write the failing hook test**

Create `useManagePaper.test.ts` mocking `@/lib/api`; assert `deletePaper` on a scan paper calls `deleteBookAttachment(bookId, index)`, on a signed paper calls `unfileSignedCopy(bookId)`; `replacePaper` routes analogously.

```ts
import { describe, expect, it, vi } from 'vitest'
// mock api, render hook via @testing-library/react renderHook, invoke, assert calls
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/books/useManagePaper.test.ts`
Expected: FAIL — hook does not exist.

- [ ] **Step 4: Implement the hook**

`useManagePaper.ts` mirrors `useAddScan` structure (busy state, `useQueryClient`, toasts via `sonner`, `apiErrorMessage`). `deletePaper(paper)`: `paper.kind === 'signed'` → `unfileSignedCopy`; `paper.kind === 'scan'` → `deleteBookAttachment(bookId, paper.attachmentIndex!)`. `replacePaper(paper, file)`: `signed` → `replaceSignedCopy`; `scan` → `replaceBookAttachment`. Invalidate `['books']`, success/error toasts.

- [ ] **Step 5: Wire the viewer + pane**

In `RecordPaperViewer.tsx`, add optional props `onDeletePaper?: (p: Paper) => void` and `onReplacePaper?: (p: Paper) => void`; render Trash/Replace `ToolbarBtn`s next to Download only when the handlers exist AND `paper.kind === 'scan' || paper.kind === 'signed'`. In `RecordPane.tsx`: instantiate `useManagePaper`, pass handlers (gated by `canManage`), add a `ConfirmDialog` for delete and a second hidden file input for replace (capture the target paper in state). Add strings `books.pane.deletePaper`, `books.pane.replacePaper`, `books.pane.deletePaperConfirm`, `books.pane.paperDeleted`, `books.pane.paperReplaced` to `en.json` + `ar.json` (Arabic authored, not fallback).

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm -C frontend exec vitest run src/pages/books/ && pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint`
Expected: PASS/clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/books/useManagePaper.ts frontend/src/pages/books/useManagePaper.test.ts frontend/src/lib/api.ts frontend/src/pages/books/RecordPaperViewer.tsx frontend/src/pages/books/RecordPane.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(records): delete/replace scans and signed copy from the film-strip"
```

---

### Task 9: Frontend — record page (BookRecordPage) actions + original view

**Files:**
- Modify: `frontend/src/pages/books/BookRecordPage.tsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (reuse Task 8 keys)

**Interfaces:**
- Consumes: `useManagePaper`, `papersOf`/`Paper`, `api` methods.

- [ ] **Step 1: Add the original-form view**

When `current?.signed_pdf_url` exists, add an **"Original form"** link/toggle that fetches `` `/api/v1/documents/${current.document_id}/download?format=pdf&original=true` `` (mirror the existing `pdfUrl` canvas or an `<a target="_blank">`). Keep the main canvas authoritative (signed when signed).

- [ ] **Step 2: Add delete/replace actions**

On the executed-copy rows and the signed copy, add Delete/Replace controls wired through `useManagePaper` (or direct `api` calls) with a `ConfirmDialog`, gated to `canManage`. Reuse the Task 8 i18n keys.

- [ ] **Step 3: Verify**

Run: `pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint`
Expected: clean. Add/extend a vitest for the page if one exists.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/books/BookRecordPage.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(records): original-form view + delete/replace on the record page"
```

---

### Task 10: Frontend — detail drawer executed-copy actions

**Files:**
- Modify: `frontend/src/components/books/BookDetailDrawer.tsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (reuse keys)

**Interfaces:**
- Consumes: `useManagePaper`/`api`, existing executed-copy list (~line 426-450).

- [ ] **Step 1: Add per-row Delete/Replace**

Next to each executed-copy `<a>`, add Delete (ConfirmDialog) + Replace (hidden file input) controls calling `api.deleteBookAttachment` / `api.replaceBookAttachment` by index, invalidating `['books']`, gated to `books.manage`. Reuse Task 8 i18n keys.

- [ ] **Step 2: Verify**

Run: `pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/books/BookDetailDrawer.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(records): delete/replace executed copies from the detail drawer"
```

---

### Task 11: Bilingual review + full verification

**Files:** none (review + gates)

- [ ] **Step 1: i18n / notification review**

Run the `i18n-rtl-reviewer` agent over the diff (new locale keys + RTL) and the `notification-template-reviewer` agent over the `book_unsigned` correspondence wording. Fix findings.

- [ ] **Step 2: Full gates**

Run: `venv\Scripts\python.exe -m pytest`, `venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .`, `venv\Scripts\mypy.exe`, `pnpm -C frontend test`, `pnpm -C frontend exec tsc -b --noEmit`, `pnpm -C frontend run lint`, `pnpm -C frontend run build`.
Expected: all green.

- [ ] **Step 3: Manual smoke (optional)**

`scripts\mng.ps1 deploy` on a test build; file a signed copy → confirm original still viewable → replace → unfile → confirm state reverts.

- [ ] **Step 4: Commit any review fixes**

```bash
git add -A
git commit -m "chore(records): i18n/RTL review fixes and verification"
```

---

## Self-Review

**Spec coverage:** §1 view-original → Task 1 (backend) + Task 7 (papers) + Task 9 (record page). §2 delete/replace attachment → Tasks 2, 3. §3 replace signed → Task 4; unfile signed → Task 5. §4 surfaces → Tasks 8, 9, 10; permissions gated on every route. §5 correspondence compensating event → Task 5. §6 api types → Task 6. Testing → per-task + Task 11. All spec sections mapped.

**Placeholder scan:** No TBD/TODO; each code step carries real code. Two verify-in-place notes (multipart method arg in Task 8; `log_event` trigger allow-list in Task 5) are explicit checks, not placeholders.

**Type consistency:** `Paper.attachmentIndex` defined in Task 7, consumed in Task 8. `replace_attachment`/`replace_signed_copy`/`unfile_signed_copy` service names match their routes and `__all__` entries. Client method names (`deleteBookAttachment`, `replaceBookAttachment`, `replaceSignedCopy`, `unfileSignedCopy`) are consistent between Task 8 definition and Tasks 9-10 consumption.
