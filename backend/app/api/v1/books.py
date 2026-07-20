"""Books + BookCategories endpoints — Phase 05.

Two routers:
  - ``router``             prefix=/books        tags=[books]
  - ``categories_router``  prefix=/book-categories  tags=[books]

Both are wired into ``main.py`` under ``/api/v1``.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api._responses import maybe_base64
from app.api.deps import get_current_user, require_capability
from app.core import form_policy
from app.core.classifications import CLASSIFICATIONS
from app.db.models import Book, BookEditSession, BookVersion, User
from app.db.session import get_db
from app.schemas.book import (
    ApproverOptionRead,
    BookAnnotationCreate,
    BookAnnotationRead,
    BookCategoryRead,
    BookCreate,
    BookDecisionRequest,
    BookEditSessionRead,
    BookListResponse,
    BookRead,
    BookSubmitRequest,
    BookUpdate,
    BookVersionRead,
    ClassificationListResponse,
    ClassificationRead,
    RenameTemplateRequest,
    ReviewersAddRequest,
    ReviewRequest,
    SaveAsTemplateRequest,
    WordBookCreate,
    WordSessionRead,
    WordTemplateRead,
    WordTemplateTableRead,
)
from app.schemas.notify import NotifyMessageRead as NotifyMessageRead
from app.services import book_service, book_template_service, word_book_service
from app.services.book_service import LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT

router = APIRouter(prefix="/books", tags=["books"])
categories_router = APIRouter(prefix="/book-categories", tags=["books"])


def _signed_source_of(v: BookVersion) -> Literal["in_app", "scan"] | None:
    """Derived: a signed copy filed under ``book_attachments/`` is a scan-back;
    anything else (sign_book output dirs) was signed in-app."""
    if not v.signed_pdf_path:
        return None
    return (
        "scan" if v.signed_pdf_path.replace("\\", "/").startswith("book_attachments/") else "in_app"
    )


def _signed_pdf_url_of(v: BookVersion) -> str | None:
    if v.status == "approved" and v.signed_pdf_path and v.document_id is not None:
        return f"/api/v1/documents/{v.document_id}/download?format=pdf"
    return None


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


@categories_router.get("", response_model=list[BookCategoryRead])
def list_book_categories(
    db: Annotated[Session, Depends(get_db)],
) -> list[BookCategoryRead]:
    rows = book_service.list_book_categories(db)
    return [BookCategoryRead.model_validate(r) for r in rows]


# ---------------------------------------------------------------------------
# Books — classification list + word-session endpoints
# ---------------------------------------------------------------------------


@router.get("/classifications", response_model=ClassificationListResponse)
def list_classifications(
    _user: Annotated[User, Depends(get_current_user)],
) -> ClassificationListResponse:
    """Return the full government classification list (any authenticated user)."""
    return ClassificationListResponse(
        items=[
            ClassificationRead(
                code=c.code,
                tab=c.tab,
                name_ar=c.name_ar,
                name_en=c.name_en,
                unit_ar=c.unit_ar,
            )
            for c in CLASSIFICATIONS
        ]
    )


@router.get("/word-templates", response_model=list[WordTemplateRead])
def list_word_templates(
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> list[WordTemplateRead]:
    """Shared General Book boilerplate library (Word path)."""
    return [
        WordTemplateRead(name=t.name, modified_at=t.modified_at, kind=t.kind)
        for t in book_template_service.list_templates()
    ]


@router.patch("/word-templates/{name}", response_model=WordTemplateRead)
def rename_word_template(
    name: str,
    payload: RenameTemplateRequest,
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> WordTemplateRead:
    """Rename a template in the shared General Book library."""
    info = book_template_service.rename_template(name, payload.new_name)
    return WordTemplateRead(name=info.name, modified_at=info.modified_at)


@router.get("/word-templates/{name}/table", response_model=WordTemplateTableRead)
def get_word_template_table_schema(
    name: str,
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> WordTemplateTableRead:
    """Return table detection result for a shared General Book template."""
    has_table, columns = book_template_service.table_schema_for(name)
    return WordTemplateTableRead(has_table=has_table, columns=columns)


@router.delete("/word-templates/{name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_word_template(
    name: str,
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> Response:
    """Delete a template from the shared General Book library."""
    book_template_service.delete_template(name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/word-sessions", response_model=WordSessionRead, status_code=status.HTTP_201_CREATED)
def create_word_session(
    payload: WordBookCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.manage"))],
) -> WordSessionRead:
    """Create a classified (or plain) General Book with a Word-editable working docx."""
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
    return WordSessionRead(
        book_id=info.book_id,
        ref_number=info.ref_number,
        token=info.token,
        filename=info.filename,
        word_url=info.word_url,
        dav_url=info.dav_url,
    )


@router.post(
    "/{book_id}/word-sessions/finish",
    response_model=BookRead,
)
def finish_word_session(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.manage"))],
) -> BookRead:
    """Finish the active Word editing session: move docx, create BookVersion + Document, optional PDF."""
    row = word_book_service.finish_word_session(db, user=user, book_id=book_id)
    item = BookRead.model_validate(row)
    item.subject = book_service.derive_subject(row)
    item.versions = _build_versions(db, row)
    return _enrich_path_fields(item, row, db)


@router.get("/{book_id}/word-sessions/preview")
def word_session_preview(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """PDF preview of the active Word session's working docx (regenerates on change).

    ``encoding=base64`` mirrors the documents download endpoint — the in-app
    pdf.js canvas fetches base64 text so download accelerators can't hijack
    the PDF byte stream.
    """
    pdf = word_book_service.render_session_preview(db, book_id=book_id)
    if (b64 := maybe_base64(pdf.read_bytes(), encoding)) is not None:
        return b64
    return FileResponse(
        str(pdf),
        media_type="application/pdf",
        headers={"Cache-Control": "no-store"},
    )


@router.post(
    "/{book_id}/word-sessions",
    response_model=WordSessionRead,
    status_code=status.HTTP_201_CREATED,
)
def reopen_word_session(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.manage"))],
) -> WordSessionRead:
    """Re-open a finished book for Word editing — copies the latest version's docx
    into a fresh working file and returns a new session token + word_url."""
    info = word_book_service.reopen_word_session(db, user=user, book_id=book_id)
    return WordSessionRead(
        book_id=info.book_id,
        ref_number=info.ref_number,
        token=info.token,
        filename=info.filename,
        word_url=info.word_url,
        dav_url=info.dav_url,
    )


@router.delete(
    "/{book_id}/word-sessions",
    response_model=BookRead,
)
def discard_word_session(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.manage"))],
) -> BookRead:
    """Discard the active Word editing session; void the book if it has no committed versions."""
    row = word_book_service.discard_word_session(db, user=user, book_id=book_id)
    item = BookRead.model_validate(row)
    item.subject = book_service.derive_subject(row)
    item.versions = _build_versions(db, row)
    return _enrich_path_fields(item, row, db)


@router.post(
    "/{book_id}/save-as-template",
    response_model=WordTemplateRead,
    status_code=status.HTTP_201_CREATED,
)
def save_book_as_template(
    book_id: int,
    payload: SaveAsTemplateRequest,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> WordTemplateRead:
    """Copy a finished General Book into the shared template library
    (retokenized + validated; content becomes visible to all books.manage users)."""
    info = book_template_service.save_book_as_template(db, book_id=book_id, name=payload.name)
    return WordTemplateRead(name=info.name, modified_at=info.modified_at)


def _fill_draft_fields(
    item: BookRead,
    row: Book,
    db: Session,
    by_book: dict[int, BookEditSession] | None = None,
) -> None:
    """Populate classification_code, voided_at, is_draft, edit_session on item.

    ``by_book`` is a pre-fetched {book_id: active_session} map for batch callers
    (list endpoints).  Pass ``None`` for single-row callers — a direct query is
    used instead (no N+1 on a single row).
    """
    item.classification_code = row.classification_code
    item.voided_at = row.voided_at
    item.is_draft = len(row.versions) == 0 and row.voided_at is None
    if by_book is not None:
        active: BookEditSession | None = by_book.get(row.id)
    else:
        active = db.query(BookEditSession).filter_by(book_id=row.id, state="active").one_or_none()
    if active is not None:
        item.edit_session = BookEditSessionRead(
            user_id=active.user_id,
            user_name=book_service.resolve_user_name_by_id(db, active.user_id),
            state=active.state,
            last_put_at=active.last_put_at,
            created_at=active.created_at,
        )


# ---------------------------------------------------------------------------
# Books — list
# ---------------------------------------------------------------------------


@router.get("", response_model=BookListResponse)
def list_books(
    db: Annotated[Session, Depends(get_db)],
    category_id: str | None = None,
    direction: str | None = None,
    approval_state: str | None = None,
    q: str | None = None,
    from_date: datetime | None = None,
    to_date: date | None = None,
    include_deleted: bool = False,
    limit: int = Query(LIST_DEFAULT_LIMIT, ge=1, le=LIST_MAX_LIMIT),
    offset: int = Query(0, ge=0),
) -> BookListResponse:
    rows, total, fts_snippets = book_service.list_books(
        db,
        category_id=category_id,
        direction=direction,
        approval_state=approval_state,
        q=q,
        from_date=from_date,
        to_date=to_date,
        include_deleted=include_deleted,
        limit=limit,
        offset=offset,
    )
    # Batch-load active edit sessions — one query for all rows (avoids N+1).
    by_book: dict[int, BookEditSession] = {}
    if rows:
        sessions = (
            db.query(BookEditSession)
            .filter(
                BookEditSession.book_id.in_([r.id for r in rows]),
                BookEditSession.state == "active",
            )
            .all()
        )
        by_book = {s.book_id: s for s in sessions}
    items: list[BookRead] = []
    for r in rows:
        item = BookRead.model_validate(r)
        item.subject = book_service.derive_subject(r)
        item.search_snippet = fts_snippets.get(r.id) or None
        items.append(_enrich_path_fields(item, r, db, by_book=by_book))
    return BookListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


def _enrich_path_fields(
    item: BookRead,
    row: Book,
    db: Session,
    by_book: dict[int, BookEditSession] | None = None,
) -> BookRead:
    """Same enrichment as GET /books/{id}: every BookRead-returning surface needs
    signing_path (path-aware seal labels) plus the current version's
    signed_source/signed_pdf_url (scan-back seal + signed paper).

    ``by_book`` is forwarded to ``_fill_draft_fields`` for batch list callers.
    """
    current = row.versions[-1] if row.versions else None
    item.signing_path = form_policy.signing_path_of(
        current.template_id if current is not None else None
    )
    # Word-authored: current version has a document but NO re-renderable
    # fields ({} — word_book_service commits it that way). Top-level so LIST
    # rows carry it (list responses don't build the versions payload).
    item.is_word_book = (
        current is not None and not current.fields and current.document_id is not None
    )
    if current is not None and item.versions:
        item.versions[-1].signed_source = _signed_source_of(current)
        item.versions[-1].signed_pdf_url = _signed_pdf_url_of(current)
    # v3-imported records: surface the file copied into the employee vault so
    # it's viewable/downloadable (no generated Document on these books).
    item.imported_doc = book_service.imported_document_of(row)
    _fill_draft_fields(item, row, db, by_book=by_book)
    return item


@router.get("/by-ref/{ref}", response_model=BookRead)
def get_book_by_ref(
    ref: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.view"))],
) -> BookRead:
    """Resolve a book by its ``ref_number`` — backs the ledger book-chip
    deep-link. Declared before ``/{book_id}`` so the literal ``by-ref`` segment
    isn't swallowed by the int path param."""
    row = book_service.get_book_by_ref(db, ref)
    return _enrich_path_fields(BookRead.model_validate(row), row, db)


@router.get("/awaiting", response_model=list[BookRead])
def list_awaiting(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.approve"))],
) -> list[BookRead]:
    """Books whose current pending approval step is assigned to the caller.

    Declared before ``/{book_id}`` so the literal ``awaiting`` segment isn't
    swallowed by the int path param."""
    rows = book_service.list_awaiting(db, user_id=user.id)
    # Batch-resolve submitter names once instead of 2 db.get per row (N+1).
    name_by_id = book_service.resolve_names_by_ids(
        db, {r.submitted_by_user_id for r in rows if r.submitted_by_user_id is not None}
    )
    # Batch-load active edit sessions — one query for all rows (avoids N+1).
    by_book: dict[int, BookEditSession] = {}
    if rows:
        sessions = (
            db.query(BookEditSession)
            .filter(
                BookEditSession.book_id.in_([r.id for r in rows]),
                BookEditSession.state == "active",
            )
            .all()
        )
        by_book = {s.book_id: s for s in sessions}
    out: list[BookRead] = []
    for r in rows:
        item = BookRead.model_validate(r)
        item.submitted_by_name = (
            name_by_id.get(r.submitted_by_user_id) if r.submitted_by_user_id is not None else None
        )
        item.your_step_kind = book_service.your_step_kind(r, user.id)
        out.append(_enrich_path_fields(item, r, db, by_book=by_book))
    return out


@router.get("/approvers", response_model=list[ApproverOptionRead])
def list_approvers(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> list[ApproverOptionRead]:
    """Active users who hold ``books.approve`` — for the submit-for-approval picker.

    Declared before ``/{book_id}`` so the literal ``approvers`` segment isn't
    swallowed by the int path param."""
    return book_service.list_approver_candidates(db)


@router.get("/reviewer-candidates", response_model=list[ApproverOptionRead])
def list_reviewer_candidates(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> list[ApproverOptionRead]:
    """Active accounts pickable as reviewers (any active user; no signature gate).

    Declared before ``/{book_id}`` so the literal ``reviewer-candidates`` segment
    isn't swallowed by the int path param."""
    return book_service.list_reviewer_candidates(db)


def _build_versions(db: Session, row: Book) -> list[BookVersionRead]:
    out: list[BookVersionRead] = []
    for v in sorted(row.versions, key=lambda x: x.version_no):
        docx_url = pdf_url = None
        if v.document_id is not None:
            base = f"/api/v1/documents/{v.document_id}/download"
            docx_url = f"{base}?format=docx"
            pdf_url = f"{base}?format=pdf"
        created_by = (
            book_service.resolve_user_name_by_id(db, v.created_by_user_id)
            if v.created_by_user_id is not None
            else None
        )
        signed_pdf_url = _signed_pdf_url_of(v)
        signed_source = _signed_source_of(v)
        out.append(
            BookVersionRead(
                id=v.id,
                version_no=v.version_no,
                trigger=v.trigger,
                status=v.status,
                template_id=v.template_id,
                document_id=v.document_id,
                # bool(): word versions store {} — "has fields" must mean
                # NON-EMPTY, else Word books read as re-renderable.
                has_fields=bool(v.fields),
                created_at=v.created_at,
                created_by_name=created_by,
                docx_url=docx_url,
                pdf_url=pdf_url,
                manager_sig_embedded=v.manager_sig_embedded,
                signed_pdf_url=signed_pdf_url,
                signed_source=signed_source,
                approval_steps=[book_service.build_step_read(db, s) for s in v.approval_steps],
            )
        )
    return out


@router.get("/{book_id}", response_model=BookRead)
def get_book(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.view"))],
    include_deleted: bool = False,
) -> BookRead:
    row = book_service.get_book_detail(db, book_id, include_deleted=include_deleted)
    item = BookRead.model_validate(row)
    item.subject = book_service.derive_subject(row)
    item.submitted_by_name = book_service.submitter_name(db, row)
    item.submitted_by_g = book_service.submitter_g_number(db, row)
    # Resolve the doc's named manager to a login account (auto-route target).
    item.doc_manager_user_id, item.doc_manager_name, item.doc_manager_has_signature = (
        book_service.resolve_doc_manager_user(db, row)
    )
    # Override auto-validated versions with the enriched payload (computed
    # docx_url/pdf_url/has_fields/created_by_name that aren't ORM attributes).
    item.versions = _build_versions(db, row)
    # Per-form signing path from the current (highest-numbered) version's
    # template; None for legacy/imported books without a template_id.
    current = row.versions[-1] if row.versions else None
    item.signing_path = form_policy.signing_path_of(
        current.template_id if current is not None else None
    )
    item.is_word_book = (
        current is not None and not current.fields and current.document_id is not None
    )
    item.imported_doc = book_service.imported_document_of(row)
    item.sms = [
        NotifyMessageRead.model_validate(m) for m in book_service.messages_for_book(db, row)
    ]
    _fill_draft_fields(item, row, db)
    return item


@router.get("/{book_id}/versions/{version_id}/fields")
def get_version_fields(
    book_id: int,
    version_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> dict[str, object]:
    """Return the raw stored ``fields`` blob for one book version — backs the
    ApplicationPage revise-mode prefill. Deliberately not on ``BookRead`` (the
    detail payload only exposes ``has_fields``).

    Requires ``books.manage`` (not ``books.view``) because this backs the
    revise/edit write-path: the caller fetches these fields in order to submit
    a revised generation, which is a managed write operation.
    """
    row = book_service.get_book(db, book_id)  # 404s if book missing
    version = db.get(BookVersion, version_id)
    if version is None or version.book_id != row.id:  # existence + ownership
        raise HTTPException(status_code=404, detail="version not found")
    return {"fields": version.fields or {}}


@router.get(
    "/{book_id}/versions/{version_id}/annotations",
    response_model=list[BookAnnotationRead],
)
def list_annotations(
    book_id: int,
    version_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.view"))],
) -> list[BookAnnotationRead]:
    rows = book_service.list_annotations(db, book_id, version_id)
    out: list[BookAnnotationRead] = []
    for a in rows:
        item = BookAnnotationRead.model_validate(a)
        item.author_name = (
            book_service.resolve_user_name_by_id(db, a.author_user_id)
            if a.author_user_id is not None
            else None
        )
        out.append(item)
    return out


@router.post(
    "/{book_id}/versions/{version_id}/annotations",
    response_model=BookAnnotationRead,
    status_code=status.HTTP_201_CREATED,
)
def create_annotation(
    book_id: int,
    version_id: int,
    payload: BookAnnotationCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.approve"))],
) -> BookAnnotationRead:
    a = book_service.create_annotation(
        db,
        book_id,
        version_id,
        author_user_id=user.id,
        page=payload.page,
        kind=payload.kind,
        geometry=payload.geometry,
        comment=payload.comment,
    )
    item = BookAnnotationRead.model_validate(a)
    item.author_name = book_service.resolve_user_name_by_id(db, user.id)
    return item


@router.delete(
    "/{book_id}/versions/{version_id}/annotations/{annotation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_annotation(
    book_id: int,
    version_id: int,
    annotation_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.approve"))],
) -> Response:
    book_service.delete_annotation(db, book_id, version_id, annotation_id, user_id=user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("", response_model=BookRead, status_code=status.HTTP_201_CREATED)
def create_book(
    payload: BookCreate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> BookRead:
    row = book_service.create_book(db, payload)
    return BookRead.model_validate(row)


@router.patch("/{book_id}", response_model=BookRead)
def update_book(
    book_id: int,
    payload: BookUpdate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> BookRead:
    row = book_service.update_book(db, book_id, payload)
    return BookRead.model_validate(row)


@router.delete("/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_book(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> Response:
    book_service.delete_book(db, book_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Approval chain (plan Tasks 5-8)
# ---------------------------------------------------------------------------


@router.post("/{book_id}/submit", response_model=BookRead)
def submit_for_approval(
    book_id: int,
    payload: BookSubmitRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.manage"))],
) -> BookRead:
    row = book_service.submit_for_approval(
        db,
        book_id,
        priority=payload.priority,
        approver_user_id=payload.approver_user_id,
        reviewer_user_ids=payload.reviewer_user_ids,
        submitted_by_user_id=user.id,
    )
    return BookRead.model_validate(row)


@router.post("/{book_id}/sign", response_model=BookRead)
def sign_book(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.approve"))],
) -> BookRead:
    """Approve == sign: embed the signer's signature into the current version's
    document, store the signed PDF, and mark the book approved."""
    row = book_service.sign_book(db, book_id, user_id=user.id)
    item = BookRead.model_validate(row)
    item.versions = _build_versions(db, row)
    return item


@router.post("/{book_id}/reject", response_model=BookRead)
def reject_step(
    book_id: int,
    payload: BookDecisionRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.approve"))],
) -> BookRead:
    row = book_service.decide_step(
        db, book_id, user_id=user.id, decision="rejected", note=payload.note
    )
    return BookRead.model_validate(row)


@router.post("/{book_id}/return", response_model=BookRead)
def return_step(
    book_id: int,
    payload: BookDecisionRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.approve"))],
) -> BookRead:
    row = book_service.decide_step(
        db, book_id, user_id=user.id, decision="returned", note=payload.note
    )
    return BookRead.model_validate(row)


@router.post("/{book_id}/note", response_model=BookRead)
def add_note(
    book_id: int,
    payload: BookDecisionRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.approve"))],
) -> BookRead:
    row = book_service.add_note(db, book_id, user_id=user.id, note=payload.note)
    return BookRead.model_validate(row)


@router.post("/{book_id}/review", response_model=BookRead)
def review_book(
    book_id: int,
    payload: ReviewRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> BookRead:
    """Advisory reviewer verdict — authorized by assignment (any active account)."""
    row = book_service.record_review(
        db, book_id, user_id=user.id, decision=payload.decision, note=payload.note
    )
    item = BookRead.model_validate(row)
    item.versions = _build_versions(db, row)
    return item


@router.post("/{book_id}/seen", status_code=status.HTTP_204_NO_CONTENT)
def mark_book_seen(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Response:
    """Mark the record seen by the caller. Idempotent; no-op if not a participant."""
    book_service.mark_seen(db, book_id, user_id=user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{book_id}/reviewers", response_model=BookRead)
def add_reviewers(
    book_id: int,
    payload: ReviewersAddRequest,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> BookRead:
    """Append advisory reviewer steps to the current pending version."""
    row = book_service.add_reviewers(db, book_id, user_ids=payload.user_ids)
    item = BookRead.model_validate(row)
    item.versions = _build_versions(db, row)
    return item


@router.delete("/{book_id}/reviewers/{user_id}", response_model=BookRead)
def remove_reviewer(
    book_id: int,
    user_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> BookRead:
    """Remove a pending reviewer step from the current version."""
    row = book_service.remove_reviewer(db, book_id, user_id=user_id)
    item = BookRead.model_validate(row)
    item.versions = _build_versions(db, row)
    return item


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------


@router.post("/{book_id}/attachments", response_model=BookRead)
async def add_book_attachment(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.manage"))],
    upload: Annotated[UploadFile, File(alias="file")],
    as_signed: Annotated[bool, Form()] = False,
) -> BookRead:
    """File an attachment. ``awaiting_scan`` books flip silently (the scan is the
    signature). For a ``none``/``pending`` book, ``as_signed=true`` records the
    upload as the signed copy and approves the record; otherwise it is filed as a
    plain attachment. Authority is ``books.manage`` for every path."""
    data = await upload.read()
    row = book_service.add_attachment(
        db, book_id, upload.filename or "scan", data, user=user, as_signed=as_signed
    )
    item = BookRead.model_validate(row)
    item.versions = _build_versions(db, row)
    return item


@router.get("/{book_id}/attachments/{index}")
def get_book_attachment(
    book_id: int,
    index: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.view"))],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """Serve one stored attachment.

    ``encoding=base64`` returns the bytes base64-encoded as ``text/plain`` so
    the in-app pdf.js viewer can fetch them without Internet Download Manager
    or the browser PDF handler intercepting the response — same trick as
    ``GET /documents/{id}/download`` (see that route's docstring).
    """
    book = book_service.get_book(db, book_id)
    paths = book.attachment_paths or []
    if index < 0 or index >= len(paths):
        raise HTTPException(status_code=404, detail="attachment not found")
    abs_path = book_service.resolve_attachment_path(paths[index])
    if abs_path is None:
        raise HTTPException(status_code=404, detail="attachment file missing")
    name = paths[index].rsplit("/", 1)[-1]
    if (b64 := maybe_base64(abs_path.read_bytes(), encoding)) is not None:
        return b64
    return FileResponse(abs_path, filename=name, media_type="application/octet-stream")


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


@router.put("/{book_id}/attachments/{index}", response_model=BookRead)
async def replace_book_attachment(
    book_id: int,
    index: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> BookRead:
    """Replace one plain attachment's bytes, keeping its index (fix a wrong upload)."""
    data = await upload.read()
    row = book_service.replace_attachment(db, book_id, index, upload.filename or "scan", data)
    item = BookRead.model_validate(row)
    item.versions = _build_versions(db, row)
    return item


@router.put("/{book_id}/signed-copy", response_model=BookRead)
async def replace_signed_copy(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.manage"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> BookRead:
    """Replace the signed copy's bytes, keeping the record approved."""
    data = await upload.read()
    row = book_service.replace_signed_copy(
        db, book_id, upload.filename or "signed", data, user=user
    )
    item = BookRead.model_validate(row)
    item.versions = _build_versions(db, row)
    return item


@router.delete("/{book_id}/signed-copy", response_model=BookRead)
def unfile_signed_copy(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.manage"))],
) -> BookRead:
    """Undo a filed signed copy and revert the record's approval state."""
    row = book_service.unfile_signed_copy(db, book_id, user=user)
    item = BookRead.model_validate(row)
    item.versions = _build_versions(db, row)
    return item


@router.get("/{book_id}/imported-document")
def get_imported_document(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.view"))],
    format: Annotated[Literal["pdf", "original"], Query()] = "pdf",
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """Serve the local vault file backing a v3-imported record.

    Imported books carry a stale absolute ``doc_path`` (the old pre-migration
    location) and have no generated Document/BookVersion, so the normal
    ``GET /documents/{id}/download`` route can't reach their file. This resolves
    ``doc_path`` to the copy already sitting in the employee's vault and serves
    it in place: ``format=pdf`` for inline viewing (with the ``encoding=base64``
    IDM-bypass used by the pdf.js viewer), ``format=original`` to download the
    stored file (e.g. the .docx when no PDF rendition exists).
    """
    book = book_service.get_book(db, book_id)
    abs_path = book_service.resolve_imported_file(book, prefer=format)
    if abs_path is None:
        raise HTTPException(status_code=404, detail="imported document not available")
    if format == "pdf":
        if (b64 := maybe_base64(abs_path.read_bytes(), encoding)) is not None:
            return b64
        return FileResponse(abs_path, filename=abs_path.name, media_type="application/pdf")
    return FileResponse(abs_path, filename=abs_path.name, media_type="application/octet-stream")


__all__ = ["categories_router", "router"]
