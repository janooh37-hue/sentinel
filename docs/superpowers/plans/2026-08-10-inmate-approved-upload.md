# Approved Inmate-Violation Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff inspect and directly file an already-approved Inmate Conduct Violations PDF or scan as a stamped, approved Records entry.

**Architecture:** Add a dedicated two-step documents API: inspection validates, normalizes, OCRs, and user-scopes a staged PDF; commit atomically allocates a NAT reference, stamps the PDF, and creates the Document/Book/BookVersion audit trail. A focused frontend component owns upload/review state while `ApplicationPage` owns the Create/Upload mode and saved-record handoff.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Alembic, SQLite, PyMuPDF, Pillow/Tesseract, pytest; React 19, TypeScript, React Query, Vitest, pdf.js, i18next, Playwright.

## Global Constraints

- Work only in `C:\Users\Admin\sentinel\.claude\worktrees\inmate-approved-upload` on `feature/inmate-approved-upload`; the production checkout stays untouched.
- Python commands use `venv\Scripts\python.exe`, `venv\Scripts\ruff.exe`, and `venv\Scripts\mypy.exe`; frontend commands use pnpm.
- Keep the existing **Create form** path unchanged and default-selected.
- The import template ID is exactly `Inmate Conduct Violations`; the book category is exactly `NAT`.
- Accept only PDF, PNG, JPEG, or JPG, at most 25 MiB; validate bytes, not claimed MIME type.
- OCR assists report-date/inmate-name entry; staff-confirmed values are authoritative.
- Commit creates an approved Records entry and no employee `Violation` row, approval step, or notification.
- Stamp page 1 with the newly allocated human-readable reference and the existing Aztec payload; stamp failure aborts the import.
- `Document.docx_path` becomes nullable; never place PDF bytes behind a fake DOCX path.
- UI strings ship in English and Arabic; use logical CSS and verify LTR/RTL, desktop/phone, and keyboard behavior.
- SQLite schema changes use `batch_alter_table`; the new revision is `0068` on `0067` and must leave exactly one Alembic head.
- Route/schema changes require `backend/openapi.json` and `frontend/src/lib/api.types.ts` regeneration through the project `sync-api-types` workflow.
- Do not touch `backend/templates/*.docx`, generated frontend static assets, `data/`, or local PII.
- Each implementation task follows red → green TDD and ends in a focused commit.

---

### Task 1: Support honest PDF-only Document rows

**Files:**
- Create: `backend/app/db/migrations/versions/0068_document_docx_nullable.py`
- Create: `backend/tests/test_document_pdf_only.py`
- Create: `backend/tests/test_migration_document_docx_nullable.py`
- Modify: `backend/app/db/models.py:809-830`
- Modify: `backend/app/api/v1/documents.py:180-192,482-535`

**Interfaces:**
- Consumes: existing `Document`, `DocumentRead`, and `/documents/{id}/download` behavior.
- Produces: `Document.docx_path: str | None`; `DocumentRead.docx_path: str | None`; error code `DOCX_NOT_AVAILABLE` for a DOCX request when the row has no DOCX.

- [ ] **Step 1: Write model and download contract tests**

Create `backend/tests/test_document_pdf_only.py` with an in-memory Document whose `docx_path=None` and real `pdf_path`. Assert ORM/Pydantic acceptance, successful PDF download, and precise DOCX rejection:

```python
def test_document_read_accepts_pdf_only_row() -> None:
    row = Document(
        employee_id=None,
        template_id="Inmate Conduct Violations",
        ref_number="NAT-0001",
        docx_path=None,
        pdf_path="book_attachments/1/original-v1.pdf",
        submission_id="submission",
        role="primary",
    )
    item = DocumentRead.model_validate(row)
    assert item.docx_path is None


def test_pdf_only_document_rejects_docx_download(client, pdf_only_document) -> None:
    response = client.get(
        f"/api/v1/documents/{pdf_only_document.id}/download?format=docx"
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "DOCX_NOT_AVAILABLE"
```

The fixture must also assert `format=pdf` returns `%PDF` bytes under `books.view` authorization.

- [ ] **Step 2: Run the contract tests and confirm red**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_document_pdf_only.py -v
```

Expected: model construction/Pydantic validation fails because `docx_path` is non-nullable and `DocumentRead` requires `str`.

- [ ] **Step 3: Make ORM, API schema, and download behavior nullable**

Change the model and response schema:

```python
# backend/app/db/models.py
class Document(Base):
    # ...
    docx_path: Mapped[str | None] = mapped_column(String(512), nullable=True)

# backend/app/api/v1/documents.py
class DocumentRead(ORMBase):
    # ...
    docx_path: str | None = None
```

Before the existing `row.docx_path` path construction, add:

```python
elif format == "docx" and not row.docx_path:
    raise NotFoundError(
        "DOCX_NOT_AVAILABLE",
        f"No editable DOCX exists for document {document_id}",
        id=document_id,
    )
```

Keep signed-lock behavior first: an approved/signed PDF-only version still rejects DOCX as locked, while an unsigned PDF-only Document returns `DOCX_NOT_AVAILABLE`.

- [ ] **Step 4: Run the contract tests and confirm green**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_document_pdf_only.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Write migration upgrade/downgrade tests**

Create `backend/tests/test_migration_document_docx_nullable.py`. Build a minimal `documents` table at revision `0067`, upgrade to `0068`, insert a row with `docx_path=NULL`, and assert the column is nullable. Assert downgrade refuses while null rows exist, then delete the null row and assert downgrade restores NOT NULL:

```python
command.upgrade(config, "0068")
columns = {c["name"]: c for c in inspect(engine).get_columns("documents")}
assert columns["docx_path"]["nullable"] is True

with engine.begin() as conn:
    conn.execute(text("INSERT INTO documents (...) VALUES (..., NULL, ...)"))
with pytest.raises(RuntimeError, match="PDF-only documents"):
    command.downgrade(config, "0067")
```

- [ ] **Step 6: Run the migration test and confirm red**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_migration_document_docx_nullable.py -v
```

Expected: FAIL because revision `0068` does not exist.

- [ ] **Step 7: Implement revision 0068**

Create:

```python
"""allow PDF-only document rows

Revision ID: 0068
Revises: 0067
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0068"
down_revision: str | Sequence[str] | None = "0067"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("documents") as batch:
        batch.alter_column(
            "docx_path",
            existing_type=sa.String(512),
            nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    null_count = bind.execute(
        sa.text("SELECT COUNT(*) FROM documents WHERE docx_path IS NULL")
    ).scalar_one()
    if null_count:
        raise RuntimeError(
            "Cannot downgrade while PDF-only documents have no docx_path"
        )
    with op.batch_alter_table("documents") as batch:
        batch.alter_column(
            "docx_path",
            existing_type=sa.String(512),
            nullable=False,
        )
```

- [ ] **Step 8: Run migration and contract tests**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_document_pdf_only.py backend/tests/test_migration_document_docx_nullable.py -v
```

Expected: all tests pass.

- [ ] **Step 9: Commit Task 1**

```powershell
git add backend/app/db/models.py backend/app/api/v1/documents.py backend/app/db/migrations/versions/0068_document_docx_nullable.py backend/tests/test_document_pdf_only.py backend/tests/test_migration_document_docx_nullable.py
git commit -m "feat(documents): support pdf-only records"
```

---

### Task 2: Normalize and stamp approved PDF uploads

**Files:**
- Create: `backend/app/core/approved_pdf.py`
- Create: `backend/tests/test_approved_pdf.py`
- Modify: `backend/app/services/book_service.py:1367-1386,1451-1475,1620-1660`
- Modify: `backend/tests/test_signed_copy_manage.py`

**Interfaces:**
- Consumes: `app.core.qr.make_aztec_png`, PyMuPDF, existing `book_service` image-scan conversion paths.
- Produces:
  - `ApprovedPdfError(ValueError)`
  - `normalize_upload_to_pdf(data: bytes) -> bytes`
  - `stamp_approved_pdf(pdf_bytes: bytes, ref_number: str) -> bytes`
  - approved-upload signed-copy replacements retain the existing reference stamp.

- [ ] **Step 1: Write normalization and stamping tests**

Create `backend/tests/test_approved_pdf.py` with small in-memory fixtures:

```python
def test_normalize_pdf_preserves_page_count(sample_pdf_bytes: bytes) -> None:
    normalized = normalize_upload_to_pdf(sample_pdf_bytes)
    with fitz.open(stream=normalized, filetype="pdf") as doc:
        assert doc.page_count == 2


def test_normalize_png_and_jpeg_to_real_pdf(sample_image_bytes) -> None:
    for raw in sample_image_bytes:
        normalized = normalize_upload_to_pdf(raw)
        assert normalized.startswith(b"%PDF")


def test_stamp_writes_reference_and_decodable_aztec(sample_pdf_bytes: bytes) -> None:
    stamped = stamp_approved_pdf(sample_pdf_bytes, "NAT-0042")
    with fitz.open(stream=stamped, filetype="pdf") as doc:
        assert "Ref: NAT-0042" in doc[0].get_text()
        assert "Ref: NAT-0042" not in doc[1].get_text()
        ref_rect = doc[0].search_for("Ref: NAT-0042").pop()
        assert ref_rect.y1 < doc[0].rect.height * 0.12
        assert [page.rect for page in doc] == [fitz.Rect(0, 0, 595, 842)] * 2
    assert qr_refs_from_bytes(stamped) == ["NAT-0042"]
```

Also assert empty, random, corrupt PDF, and encrypted PDF bytes raise `ApprovedPdfError` and no output is returned.

- [ ] **Step 2: Run the tests and confirm red**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_approved_pdf.py -v
```

Expected: import failure because `app.core.approved_pdf` does not exist.

- [ ] **Step 3: Implement the focused PDF utility**

Create `backend/app/core/approved_pdf.py` with byte-sniffing and no filesystem/global state:

```python
class ApprovedPdfError(ValueError):
    pass


def normalize_upload_to_pdf(data: bytes) -> bytes:
    if not data:
        raise ApprovedPdfError("The uploaded file is empty")
    try:
        if data.startswith(b"%PDF"):
            with fitz.open(stream=data, filetype="pdf") as doc:
                if doc.needs_pass or doc.page_count < 1:
                    raise ApprovedPdfError("The uploaded PDF is not readable")
                return doc.tobytes(garbage=4, deflate=True)
        image = load_image(data)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        with fitz.open(stream=buffer.getvalue(), filetype="png") as image_doc:
            return image_doc.convert_to_pdf()
    except (fitz.FileDataError, fitz.EmptyFileError, InvalidImageError, OSError, RuntimeError) as exc:
        raise ApprovedPdfError("Upload a valid PDF, PNG or JPEG") from exc
```

`stamp_approved_pdf` must open a copy, insert the literal text `Ref: NAT-0042` when called with `ref_number="NAT-0042"` in navy at the standard top-start header point, insert `make_aztec_png(ref_number)` into the standard top-right rectangle, stamp page 1 only, and return `doc.tobytes(garbage=4, deflate=True)`. Raise `ApprovedPdfError` on any render/save failure.

- [ ] **Step 4: Replace book_service's duplicate image conversion**

Remove `_image_to_pdf_bytes`. In scan-back and replacement branches call `normalize_upload_to_pdf(data)` and translate `ApprovedPdfError` to the existing `ValidationFailedError("BOOK_SCAN_CONVERT_FAILED", ...)`. PDF inputs stay byte-compatible at the API level; images still become real PDFs.

Add a private marker helper for later tasks:

```python
def _is_approved_upload(version: BookVersion | None) -> bool:
    return bool(version and version.fields and version.fields.get("source") == "approved_upload")
```

When the marker is true in `add_attachment(..., as_signed=True)` or `replace_signed_copy`, normalize and call `stamp_approved_pdf(normalized, book.ref_number)` before writing `signed_pdf_path`. Set `book.doc_path` to the new stamped path. In `unfile_signed_copy`, restore `book.doc_path` to the linked Document's `pdf_path` for this marker.

- [ ] **Step 5: Add signed-copy invariant tests**

Extend `backend/tests/test_signed_copy_manage.py` with an approved-upload version fixture and assert:

```python
updated = book_service.replace_signed_copy(db, book.id, "replacement.png", png, user=user)
version = updated.versions[-1]
assert version.status == "approved"
assert qr_refs_from_bytes(resolve_attachment_path(version.signed_pdf_path).read_bytes()) == [book.ref_number]

book_service.unfile_signed_copy(db, book.id, user=user)
assert book.doc_path == document.pdf_path
```

- [ ] **Step 6: Run PDF and signed-copy tests**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_approved_pdf.py backend/tests/test_signed_copy_manage.py -v
```

Expected: all tests pass.

- [ ] **Step 7: Commit Task 2**

```powershell
git add backend/app/core/approved_pdf.py backend/app/services/book_service.py backend/tests/test_approved_pdf.py backend/tests/test_signed_copy_manage.py
git commit -m "feat(documents): stamp approved pdf uploads"
```

---

### Task 3: Inspect and user-scope staged inmate reports

**Files:**
- Create: `backend/app/services/approved_violation_import_service.py`
- Create: `backend/tests/test_approved_violation_inspection.py`

**Interfaces:**
- Consumes: `normalize_upload_to_pdf`, `ocr_bytes_to_text`, `OCR_GATE`, configured data directory.
- Produces:
  - `InmateNameCandidate(name: str, confidence: float)`
  - `ApprovedViolationInspection(token, filename, size, expires_at, report_date, inmate_names, proposed_subject, warnings)`
  - `inspect_upload(data: bytes, filename: str, user_id: int, *, now: datetime | None = None) -> ApprovedViolationInspection`
  - `claim_staged(token: str, user_id: int, *, now: datetime | None = None) -> ClaimedApprovedViolation`
  - `release_claim(claim: ClaimedApprovedViolation) -> None`
  - `consume_claim(claim: ClaimedApprovedViolation) -> None`

- [ ] **Step 1: Write metadata parser tests**

Use representative Arabic/English text from the official form:

```python
def test_extracts_report_date_and_inmate_names() -> None:
    text = """
    التاريخ 05/08/2026 الوقت 12:43
    اسم النزيل الجنسية الجناح الرقم الموحد رقم الحجز
    1 محمد سالم ياسر الامارات 1A 159809450 1565118
    2 خالد عبدالله مصر 3B 778112 990211
    تفاصيل المخالفة
    """
    result = extract_metadata(text)
    assert result.report_date == date(2026, 8, 5)
    assert [item.name for item in result.inmate_names] == [
        "محمد سالم ياسر",
        "خالد عبدالله",
    ]
```

Add tests for ISO/d-m-Y dates, no recognizable table, duplicate OCR lines, and invalid calendar values. Partial extraction returns `None`/`[]`, never a guessed date or name.

- [ ] **Step 2: Write staging ownership/expiry/claim tests**

With `GSSG_DATA_DIR=tmp_path`, assert inspection writes only a normalized `source.pdf` plus metadata under `staged_approved_imports/{token}/`, token ownership is enforced, stale tokens are rejected/purged, and `claim_staged` atomically renames the directory so a second claim fails.

Mock `ocr_bytes_to_text` to return representative text. Add an `OcrUnavailableError` test asserting inspection still succeeds with a warning and editable empty metadata.

- [ ] **Step 3: Run inspection tests and confirm red**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_approved_violation_inspection.py -v
```

Expected: import failure because the service does not exist.

- [ ] **Step 4: Implement dataclasses and conservative parser**

Create `backend/app/services/approved_violation_import_service.py` with:

```python
TEMPLATE_ID = "Inmate Conduct Violations"
CATEGORY_ID = "NAT"
STAGED_DIR_NAME = "staged_approved_imports"
TTL_SECONDS = 24 * 3600
_TOKEN_RE = re.compile(r"^[0-9a-f]{32}$")

@dataclass(frozen=True)
class InmateNameCandidate:
    name: str
    confidence: float

@dataclass(frozen=True)
class ApprovedViolationInspection:
    token: str
    filename: str
    size: int
    expires_at: datetime
    report_date: date | None
    inmate_names: list[InmateNameCandidate]
    proposed_subject: str
    warnings: list[str]
```

The parser may use explicit date regexes and the known table boundaries, but it must reject numeric-only/label-only candidates, preserve Arabic names, de-duplicate while preserving order, and cap stored names to a reasonable form-derived count rather than scanning arbitrary document text.

- [ ] **Step 5: Implement staging, OCR fallback, and atomic claim**

`inspect_upload` must normalize first, OCR under `OCR_GATE`, write a metadata sidecar with `user_id`, source filename, size, extracted text, creation/expiry ISO timestamps, and write both files through temporary names before renaming the token directory into place.

`claim_staged` must validate token shape/path/owner/expiry, then atomically rename `{token}` to `{token}.claimed`. `release_claim` renames it back only after a failed commit; `consume_claim` removes the claimed directory only after a successful commit. Purge only token-shaped stale directories.

Translate empty/large/invalid data to stable `ValidationFailedError` codes:

- `APPROVED_IMPORT_EMPTY_FILE`
- `APPROVED_IMPORT_FILE_TOO_LARGE`
- `APPROVED_IMPORT_BAD_FILE`
- `APPROVED_IMPORT_TOKEN_NOT_FOUND`
- `APPROVED_IMPORT_TOKEN_EXPIRED`
- `APPROVED_IMPORT_TOKEN_FORBIDDEN`
- `APPROVED_IMPORT_TOKEN_IN_USE`

- [ ] **Step 6: Run inspection tests and confirm green**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_approved_violation_inspection.py -v
```

Expected: all tests pass.

- [ ] **Step 7: Commit Task 3**

```powershell
git add backend/app/services/approved_violation_import_service.py backend/tests/test_approved_violation_inspection.py
git commit -m "feat(violations): inspect approved inmate reports"
```

---

### Task 4: Commit an approved versioned Records entry

**Files:**
- Modify: `backend/app/services/approved_violation_import_service.py`
- Create: `backend/tests/test_approved_violation_import_service.py`

**Interfaces:**
- Consumes: Task 1 nullable Document, Task 2 PDF stamper, Task 3 claimed staging, `allocate_ref_with_retry`, `build_search_text`, `correspondence_service.log_event`.
- Produces:
  - `ApprovedViolationImportResult(book_id: int, document_id: int, ref_number: str)`
  - `commit_import(db: Session, *, token: str, report_date: date, inmate_names: list[str], subject: str, user: User) -> ApprovedViolationImportResult`

- [ ] **Step 1: Write the successful persistence test**

Seed a `BookCategory(id="NAT", prefix="NAT", ...)`, a ref sequence, and an uploader. Stage a sample PDF, then call `commit_import`:

```python
result = commit_import(
    db,
    token=inspection.token,
    report_date=date(2026, 8, 5),
    inmate_names=["محمد سالم ياسر", "خالد عبدالله"],
    subject="Inmate Conduct Violations — محمد سالم ياسر، خالد عبدالله",
    user=uploader,
)
book = db.get(Book, result.book_id)
version = book.versions[-1]
document = db.get(Document, result.document_id)
assert book.category_id == "NAT"
assert book.approval_state == version.status == "approved"
assert version.template_id == "Inmate Conduct Violations"
assert version.trigger == "approved-upload"
assert version.fields["source"] == "approved_upload"
assert version.fields["report_date"] == "2026-08-05"
assert document.docx_path is None
assert document.violation_id is None
assert db.scalar(select(func.count(Violation.id))) == 0
assert qr_refs_from_bytes(resolve_attachment_path(version.signed_pdf_path).read_bytes()) == [result.ref_number]
```

Assert `Book.created_at` is the filing time, not `report_date`, and that search text contains both inmate names and the OCR corpus.

- [ ] **Step 2: Write transaction/idempotency failure tests**

Cover:

- missing NAT category;
- empty subject/date validation;
- a monkeypatched stamping failure;
- a monkeypatched `db.commit` failure;
- calling commit twice with the same token;
- correspondence/audit insertion in the same transaction.

After every failed commit, assert no Book/Document/Version rows and no final output files exist, the ref counter rolled back, and the claim was released for retry. After success, assert the stage is consumed and a retry returns token-not-found without allocating another reference.

- [ ] **Step 3: Run service tests and confirm red**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_approved_violation_import_service.py -v
```

Expected: FAIL because `commit_import` and the result dataclass do not exist.

- [ ] **Step 4: Implement validated persistence and compensated file writes**

Add:

```python
@dataclass(frozen=True)
class ApprovedViolationImportResult:
    book_id: int
    document_id: int
    ref_number: str
```

`commit_import` must:

1. strip/de-duplicate confirmed names and validate non-empty subject/report date;
2. claim the staged token before allocating a reference;
3. read the normalized original and call `stamp_approved_pdf`;
4. call `allocate_ref_with_retry(db, "NAT")`;
5. create/flush Book to obtain `book.id`;
6. write `original-v1.pdf` and `signed-v1.pdf` under `data/book_attachments/<book.id>/` through collision-safe temporary files;
7. create Document with nullable DOCX and normalized original PDF;
8. create approved version 1 with the exact fields/attribution contract;
9. set `book.doc_path` to the stamped signed path and `search_text = build_search_text(subject=..., ref=..., body=confirmed_and_ocr_text)`;
10. add `AuditLog(action="approved_violation_imported", entity_type="book", ...)`;
11. call `correspondence_service.log_event(trigger="document_generated", source_kind="generated_doc", source_book_id=book.id, condition_fields={"category": "NAT", "template_id": TEMPLATE_ID}, ...)`;
12. commit once; and
13. consume the claim.

Wrap all pre-commit work in `try/except`: `db.rollback()`, unlink only files created by this call, release the claim, then re-raise. If claim deletion fails after commit, log it for TTL cleanup and still return success.

- [ ] **Step 5: Run service tests and confirm green**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_approved_violation_import_service.py -v
```

Expected: all tests pass.

- [ ] **Step 6: Run neighboring record tests**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_inmate_violations_service.py backend/tests/test_scanback_api.py backend/tests/test_signed_copy_manage.py -q
```

Expected: all tests pass; generated inmate form and scan-back behavior remain unchanged.

- [ ] **Step 7: Commit Task 4**

```powershell
git add backend/app/services/approved_violation_import_service.py backend/tests/test_approved_violation_import_service.py
git commit -m "feat(violations): file approved inmate reports"
```

---

### Task 5: Expose inspection and commit APIs

**Files:**
- Modify: `backend/app/api/v1/documents.py:17-52,85-194,274-314`
- Create: `backend/tests/test_approved_violation_import_api.py`

**Interfaces:**
- Consumes: Task 3 `inspect_upload`; Task 4 `commit_import`.
- Produces:
  - `POST /api/v1/documents/inmate-violations/approved-imports/inspect`
  - `POST /api/v1/documents/inmate-violations/approved-imports`
  - generated schemas `ApprovedViolationInspectionRead`, `ApprovedViolationImportRequest`, and `ApprovedViolationImportRead`.

- [ ] **Step 1: Write API serialization and authorization tests**

Create FastAPI TestClient fixtures following `backend/tests/test_scanback_api.py`. Assert:

```python
inspect_response = client.post(
    "/api/v1/documents/inmate-violations/approved-imports/inspect",
    files={"file": ("approved.pdf", sample_pdf, "application/pdf")},
)
assert inspect_response.status_code == 200
body = inspect_response.json()
assert re.fullmatch(r"[0-9a-f]{32}", body["token"])
assert datetime.fromisoformat(body["expires_at"])
assert body["filename"] == "approved.pdf"
assert body["size"] == len(sample_pdf)
assert body["report_date"] == "2026-08-05"
assert body["inmate_names"] == [
    {"name": "محمد سالم ياسر", "confidence": pytest.approx(0.9)}
]
assert body["proposed_subject"] == "Inmate Conduct Violations — محمد سالم ياسر"
assert body["warnings"] == []
```

Post confirmed JSON to the commit route and assert `201`, `{book_id, document_id, ref_number, approval_state: "approved"}`. Assert users without `documents.generate` receive 403 and another user's token receives the stable forbidden error.

- [ ] **Step 2: Run API tests and confirm red**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_approved_violation_import_api.py -v
```

Expected: 404 because the routes do not exist.

- [ ] **Step 3: Add Pydantic request/response schemas**

In `documents.py` add:

```python
class ApprovedViolationNameRead(BaseModel):
    name: str
    confidence: float

class ApprovedViolationInspectionRead(BaseModel):
    token: str
    filename: str
    size: int
    expires_at: datetime
    report_date: date | None = None
    inmate_names: list[ApprovedViolationNameRead]
    proposed_subject: str
    warnings: list[str]

ConfirmedInmateName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=256),
]
ConfirmedSubject = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=512),
]

class ApprovedViolationImportRequest(BaseModel):
    token: str = Field(min_length=32, max_length=32, pattern=r"^[0-9a-f]{32}$")
    report_date: date
    inmate_names: list[ConfirmedInmateName] = Field(default_factory=list, max_length=100)
    subject: ConfirmedSubject

class ApprovedViolationImportRead(BaseModel):
    book_id: int
    document_id: int
    ref_number: str
    approval_state: Literal["approved"] = "approved"
```

Import `StringConstraints` from Pydantic. The aliases enforce stripped subject/name lengths; the list uses `default_factory=list`, not a mutable literal.

- [ ] **Step 4: Add thin routes**

Declare both literal approved-import routes before the generic `/{document_id}` document route so FastAPI never tries to parse `inmate-violations` as an integer.

The inspect route reads at most `MAX_ATTACHMENT_BYTES + 1`, calls `inspect_upload(..., user_id=user.id)`, and maps the dataclass. The commit route passes the request-scoped DB session and authenticated User to `commit_import`, returns `201`, and contains no persistence logic.

- [ ] **Step 5: Run API and service tests**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_approved_violation_import_api.py backend/tests/test_approved_violation_import_service.py -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit Task 5**

```powershell
git add backend/app/api/v1/documents.py backend/tests/test_approved_violation_import_api.py
git commit -m "feat(api): add approved inmate import routes"
```

---

### Task 6: Synchronize API types and add typed client calls

**Files:**
- Modify generated: `backend/openapi.json`
- Modify generated: `frontend/src/lib/api.types.ts`
- Modify: `frontend/src/lib/api.ts:698-718,1884-1898`

**Interfaces:**
- Consumes: Task 5 FastAPI schemas/routes.
- Produces frontend aliases and methods:
  - `ApprovedViolationInspectionRead`
  - `ApprovedViolationImportRequest`
  - `ApprovedViolationImportRead`
  - `api.inspectApprovedViolation(file: File)`
  - `api.commitApprovedViolation(body: ApprovedViolationImportRequest)`

- [ ] **Step 1: Run the project `sync-api-types` workflow**

Regenerate `backend/openapi.json` from FastAPI and then `frontend/src/lib/api.types.ts`. The generated contract must show nullable `DocumentRead.docx_path` and both new routes/schemas.

- [ ] **Step 2: Add only ergonomic aliases and client methods**

In `api.ts`:

```typescript
export type ApprovedViolationInspectionRead =
  components['schemas']['ApprovedViolationInspectionRead']
export type ApprovedViolationImportRequest =
  components['schemas']['ApprovedViolationImportRequest']
export type ApprovedViolationImportRead =
  components['schemas']['ApprovedViolationImportRead']
```

Add:

```typescript
inspectApprovedViolation: (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return multipart<ApprovedViolationInspectionRead>(
    '/documents/inmate-violations/approved-imports/inspect',
    form,
  )
},
commitApprovedViolation: (body: ApprovedViolationImportRequest) =>
  request<ApprovedViolationImportRead>(
    'POST',
    '/documents/inmate-violations/approved-imports',
    body,
  ),
```

Do not hand-edit generated type bodies.

- [ ] **Step 3: Verify generated contract and TypeScript**

Run sequentially:

```powershell
pnpm -C frontend exec tsc -b --noEmit
venv\Scripts\python.exe -m pytest backend/tests/test_approved_violation_import_api.py -q
```

Expected: both pass.

- [ ] **Step 4: Commit Task 6**

```powershell
git add backend/openapi.json frontend/src/lib/api.types.ts frontend/src/lib/api.ts
git commit -m "feat(api): sync approved inmate import contract"
```

---

### Task 7: Build the approved-upload review component

**Files:**
- Create: `frontend/src/pages/application/ApprovedViolationUpload.tsx`
- Create: `frontend/src/pages/application/ApprovedViolationPreview.tsx`
- Create: `frontend/src/pages/application/ApprovedViolationUpload.test.tsx`
- Create: `frontend/src/pages/application/ApprovedViolationPreview.test.tsx`
- Modify: `frontend/src/locales/en.json:2128-2370`
- Modify: `frontend/src/locales/ar.json:2287-2528`

**Interfaces:**
- Consumes: Task 6 API types/methods, existing `apiErrorMessage`, `Button`, React Query.
- Produces:

```typescript
interface ApprovedViolationUploadProps {
  onSaved: (result: ApprovedViolationImportRead) => void
}
```

`ApprovedViolationUpload` owns the selected local File/object URL, inspection result, editable report date/names/subject, validation errors, and inspect/commit mutation state.

- [ ] **Step 1: Write component behavior tests**

Mock API methods and preview. Cover:

- accepts PDF/PNG/JPEG/JPG and calls inspect once;
- rejects unsupported/oversized files before the API call;
- shows filename, size, warnings, extracted date/name/subject;
- correction of date, names, and subject;
- add/remove inmate-name rows;
- Save disabled while inspecting, required fields missing, or commit pending;
- submitting invalid metadata focuses the first invalid field and exposes its inline error;
- exact commit payload and one `onSaved` call;
- inspection/commit failure keeps the selected file and confirmed values;
- remove/replace revokes object URLs and resets staged metadata;
- explicit Arabic labels under `i18n.changeLanguage('ar')`.

Example payload assertion:

```typescript
expect(api.commitApprovedViolation).toHaveBeenCalledWith({
  token: 'a'.repeat(32),
  report_date: '2026-08-05',
  inmate_names: ['محمد سالم ياسر', 'خالد عبدالله'],
  subject: 'مخالفة مسلكية — محمد سالم ياسر، خالد عبدالله',
})
```

- [ ] **Step 2: Run upload component tests and confirm red**

Run:

```powershell
pnpm -C frontend exec vitest run src/pages/application/ApprovedViolationUpload.test.tsx
```

Expected: import failure because the component does not exist.

- [ ] **Step 3: Implement the focused upload/review state machine**

Use two React Query mutations:

```typescript
const inspectMutation = useMutation({
  mutationFn: (file: File) => api.inspectApprovedViolation(file),
  onSuccess: (inspection) => {
    setInspection(inspection)
    setReportDate(inspection.report_date ?? '')
    setInmateNames(inspection.inmate_names.map((item) => item.name))
    setSubject(inspection.proposed_subject)
  },
  onError: (error) => setError(apiErrorMessage(error)),
})

const commitMutation = useMutation({
  mutationFn: () => api.commitApprovedViolation({
    token: inspection!.token,
    report_date: reportDate,
    inmate_names: inmateNames.map((name) => name.trim()).filter(Boolean),
    subject: subject.trim(),
  }),
  onSuccess: (result) => {
    void queryClient.invalidateQueries({ queryKey: ['books'] })
    void queryClient.invalidateQueries({ queryKey: ['books', 'facets'] })
    onSaved(result)
  },
  onError: (error) => setError(apiErrorMessage(error)),
})
```

Use one real hidden file input plus a keyboard-operable dashed button/dropzone following the existing `FileDropzone` interaction pattern. Use `accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"` but keep client-side extension/type checks advisory; the server remains authoritative.

- [ ] **Step 4: Add complete EN/AR copy**

Add an `application.approvedViolation` object in both locale files for mode labels, dropzone/hint/limit, inspecting, preview, report date, inmate names, add/remove name, subject, OCR warning, approved notice, Save approved record, approved copy filed, New upload, and all client-side errors. Arabic must be authored Arabic, not copied English keys.

- [ ] **Step 5: Implement first-page local preview**

`ApprovedViolationPreview` receives `file: File`. For images, create/revoke an object URL and render `<img alt={filename}>`. For PDFs, read `file.arrayBuffer()`, use pdf.js to render page 1 to a canvas, honor device pixel ratio, cancel on unmount, and expose loading/error text. Do not send the staged token back to the server for preview and do not use `<iframe>`/`<object>` in WebView2.

- [ ] **Step 6: Run component and preview tests**

Run:

```powershell
pnpm -C frontend exec vitest run src/pages/application/ApprovedViolationUpload.test.tsx src/pages/application/ApprovedViolationPreview.test.tsx
```

Expected: all tests pass.

- [ ] **Step 7: Commit Task 7**

```powershell
git add frontend/src/pages/application/ApprovedViolationUpload.tsx frontend/src/pages/application/ApprovedViolationPreview.tsx frontend/src/pages/application/ApprovedViolationUpload.test.tsx frontend/src/pages/application/ApprovedViolationPreview.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(services): add approved violation upload review"
```

---

### Task 8: Integrate mode choice and saved handoff

**Files:**
- Modify: `frontend/src/pages/application/ApplicationPage.tsx:27-77,161-204,818-1210`
- Create: `frontend/src/pages/application/ApplicationPage.approvedViolationUpload.test.tsx`

**Interfaces:**
- Consumes: Task 7 `ApprovedViolationUpload`; existing `SavedRecordActions`.
- Produces: Create/Upload mode visible only for `Inmate Conduct Violations`; approved-upload success handoff with Print/Open/New upload and no approval action.

- [ ] **Step 1: Write ApplicationPage mode integration tests**

Model the harness on `ApplicationPage.generatedHandoff.test.tsx`, mock `ApprovedViolationUpload`, and select the Inmate template. Assert:

```typescript
expect(screen.getByRole('button', { name: 'Create form' })).toHaveAttribute('aria-pressed', 'true')
expect(screen.getByTestId('template-form')).toBeVisible()

await user.click(screen.getByRole('button', { name: 'Upload approved copy' }))
expect(screen.getByTestId('approved-violation-upload')).toBeVisible()
expect(screen.queryByTestId('template-form')).not.toBeInTheDocument()
```

Mock `onSaved({book_id: 42, document_id: 9, ref_number: 'NAT-0042', approval_state: 'approved'})`; assert `SavedRecordActions` receives book 42/ref and detail **Approved copy filed**, the success wrapper receives focus, and **New upload** resets to the uploader. Assert another template has no mode choice and the existing form path is unchanged.

- [ ] **Step 2: Run integration test and confirm red**

Run:

```powershell
pnpm -C frontend exec vitest run src/pages/application/ApplicationPage.approvedViolationUpload.test.tsx
```

Expected: no Upload approved copy control.

- [ ] **Step 3: Add mode and saved-result state without branching TemplateForm**

In `ApplicationPage` add:

```typescript
type InmateEntryMode = 'create' | 'upload'
const [inmateEntryMode, setInmateEntryMode] = useState<InmateEntryMode>('create')
const [approvedImport, setApprovedImport] =
  useState<ApprovedViolationImportRead | null>(null)
const isInmateService = selectedTemplate === 'Inmate Conduct Violations'
```

Reset both states in `handleSelectTemplate`, `resetToGallery`, and New upload. Render an accessible two-button `aria-pressed` mode selector only for this template. When mode is upload, skip the existing Fields/Preview tab strip entirely and render either:

```tsx
<ApprovedViolationUpload onSaved={setApprovedImport} />
```

or, after success:

```tsx
<div
  ref={approvedImportSuccessRef}
  data-testid="approved-import-success"
  tabIndex={-1}
>
  <SavedRecordActions
    bookId={approvedImport.book_id}
    refNumber={approvedImport.ref_number}
    detail={t('application.approvedViolation.approvedCopyFiled')}
  />
  <Button type="button" onClick={() => setApprovedImport(null)}>
    {t('application.approvedViolation.newUpload')}
  </Button>
</div>
```

Use an effect keyed by `approvedImport?.book_id` to focus `approvedImportSuccessRef.current` after filing. `SavedRecordActions` fetches the approved book; its existing state logic suppresses Send for approval and enables Print from `signed_pdf_url`.

- [ ] **Step 4: Run focused frontend tests**

Run:

```powershell
pnpm -C frontend exec vitest run src/pages/application/ApplicationPage.approvedViolationUpload.test.tsx src/pages/application/ApprovedViolationUpload.test.tsx src/components/application/TemplateForm.inmateViolations.test.tsx
```

Expected: all tests pass; the generated form's four existing tests remain green.

- [ ] **Step 5: Run frontend static checks sequentially**

Run:

```powershell
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
```

Expected: both pass. Do not run them concurrently on this host.

- [ ] **Step 6: Commit Task 8**

```powershell
git add frontend/src/pages/application/ApplicationPage.tsx frontend/src/pages/application/ApplicationPage.approvedViolationUpload.test.tsx
git commit -m "feat(services): integrate approved inmate uploads"
```

---

### Task 9: Verify the complete approved-import contract

**Files:**
- Modify only if verification exposes a real defect in files already owned by Tasks 1–8.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: evidence that API, migration, import, existing generated form, bilingual UI, and running browser workflow meet the approved spec.

- [ ] **Step 1: Run the focused backend feature suite**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_document_pdf_only.py backend/tests/test_migration_document_docx_nullable.py backend/tests/test_approved_pdf.py backend/tests/test_approved_violation_inspection.py backend/tests/test_approved_violation_import_service.py backend/tests/test_approved_violation_import_api.py backend/tests/test_signed_copy_manage.py backend/tests/test_inmate_violations_service.py backend/tests/test_inmate_violations_template.py -q
```

Expected: all pass.

- [ ] **Step 2: Run backend static checks**

```powershell
venv\Scripts\ruff.exe check backend/app/core/approved_pdf.py backend/app/services/approved_violation_import_service.py backend/app/api/v1/documents.py backend/app/services/book_service.py backend/tests/test_approved_pdf.py backend/tests/test_approved_violation_inspection.py backend/tests/test_approved_violation_import_service.py backend/tests/test_approved_violation_import_api.py
venv\Scripts\ruff.exe format --check backend/app/core/approved_pdf.py backend/app/services/approved_violation_import_service.py backend/app/api/v1/documents.py backend/app/services/book_service.py backend/tests/test_approved_pdf.py backend/tests/test_approved_violation_inspection.py backend/tests/test_approved_violation_import_service.py backend/tests/test_approved_violation_import_api.py
venv\Scripts\mypy.exe
```

Expected: all pass.

- [ ] **Step 3: Confirm one Alembic head and migration round-trip**

```powershell
venv\Scripts\python.exe -m alembic heads
venv\Scripts\python.exe -m pytest backend/tests/test_migration_document_docx_nullable.py -q
```

Expected: one head, `0068`, and passing upgrade/downgrade tests. Run the required `alembic-migration-reviewer`; resolve every blocking finding and rerun these commands.

- [ ] **Step 4: Run focused frontend verification sequentially**

```powershell
pnpm -C frontend exec vitest run src/pages/application/ApprovedViolationUpload.test.tsx src/pages/application/ApprovedViolationPreview.test.tsx src/pages/application/ApplicationPage.approvedViolationUpload.test.tsx src/components/application/TemplateForm.inmateViolations.test.tsx
pnpm -C frontend test
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
pnpm -C frontend run build
```

Expected: all pass without concurrent memory pressure.

- [ ] **Step 5: Run required bilingual/RTL review**

Run the project `i18n-rtl-reviewer` against the Create/Upload selector, dropzone, metadata review, errors, approved notice, and success state. Resolve every blocking finding. Explicitly verify English/LTR and Arabic/RTL at the same desktop and phone resolutions with logical CSS and no horizontal overflow.

- [ ] **Step 6: Smoke test the running workflow**

Start the worktree app with isolated test data, then use a real browser:

1. sign in with `documents.generate` and `books.view`;
2. open Services → Inmate Conduct Violations;
3. confirm Create form is default;
4. switch to Upload approved copy;
5. inspect a born-digital sample PDF, correct metadata, and save;
6. open Records → Inmate Conduct Violations;
7. verify one new record, approved status, Print/Open behavior, visible `Ref: NAT-…`, and a decodable Aztec payload;
8. repeat with a JPEG/PNG scan;
9. repeat UI inspection in Arabic/RTL and a phone viewport.

A browser screenshot/DOM assertion is evidence for layout; service/database assertions are evidence for persistence. Do not point the smoke test at live production data.

- [ ] **Step 7: Run the full relevant backend suite**

```powershell
venv\Scripts\python.exe -m pytest
```

Expected: all tests pass. If an unrelated existing failure appears, reproduce it on `main` before classifying it as baseline.

- [ ] **Step 8: Commit any verification-driven fixes**

If Steps 1–7 required code corrections, commit only those corrections:

```powershell
git add -u
git commit -m "fix(violations): resolve approved import review findings"
```

If no corrections were required, do not create an empty commit.
