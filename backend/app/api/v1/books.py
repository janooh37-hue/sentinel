"""Books + BookCategories endpoints — Phase 05.

Two routers:
  - ``router``             prefix=/books        tags=[books]
  - ``categories_router``  prefix=/book-categories  tags=[books]

Both are wired into ``main.py`` under ``/api/v1``.
"""

from __future__ import annotations

import base64
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
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api._responses import maybe_base64
from app.api.deps import get_current_user, require_capability
from app.api.errors import AppError
from app.core import form_policy
from app.core.classifications import CLASSIFICATIONS
from app.core.form_kind import OTHER_SERVICE_ID
from app.db.models import (
    Book,
    BookEditSession,
    BookRevisionAccess,
    BookVersion,
    Document,
    User,
)
from app.db.session import get_db
from app.schemas.book import (
    ApprovalLogNeighborsResponse,
    ApprovalLogResponse,
    ApprovalSummaryResponse,
    ApproverOptionRead,
    BookAnnotationCreate,
    BookAnnotationRead,
    BookApprovalStepRead,
    BookCategoryRead,
    BookCreate,
    BookDecisionRequest,
    BookEditSessionRead,
    BookFacetsResponse,
    BookListResponse,
    BookRead,
    BookRevisionAccessRead,
    BookSignRequest,
    BookStateOverrideRequest,
    BookSubmitRequest,
    BookUpdate,
    BookVersionRead,
    ClassificationListResponse,
    ClassificationRead,
    IncludedPaperRead,
    IncludedPaperReplacementRead,
    IncludedPapersHistoryRead,
    IncludedPapersPreviewRead,
    IncludedPapersRequest,
    RenameTemplateRequest,
    RetainedDecisionRead,
    ReviewersAddRequest,
    ReviewRequest,
    RevokeRevisionAccessRequest,
    SaveAsTemplateRequest,
    ServiceFacetRead,
    WordBookCreate,
    WordSessionRead,
    WordTemplateRead,
    WordTemplateTableRead,
)
from app.schemas.notify import NotifyMessageRead as NotifyMessageRead
from app.services import (
    book_service,
    book_template_service,
    included_papers_service,
    perm_service,
    word_book_service,
)
from app.services.book_service import LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT

router = APIRouter(prefix="/books", tags=["books"])
categories_router = APIRouter(prefix="/book-categories", tags=["books"])


def _require_record_type_access(
    db: Session,
    user: User,
    *,
    category_id: str | None = None,
    service_id: str | None = None,
) -> None:
    book_service.require_record_type_access(
        db,
        user,
        category_id=category_id,
        service_id=service_id,
    )


def _require_full_book(db: Session, user: User, book_id: int) -> Book:
    row = book_service.get_book(db, book_id)
    book_service.require_full_book_access(db, user, row)
    return row


def _signed_source_of(v: BookVersion) -> Literal["in_app", "scan"] | None:
    """Classify by the preserved base; packaged scan outputs live elsewhere."""
    if not v.signed_pdf_path:
        return None
    source = v.signed_base_pdf_path or v.signed_pdf_path
    return "scan" if source.replace("\\", "/").startswith("book_attachments/") else "in_app"


def _is_pdf_path(path: str | None) -> bool:
    return path is not None and path.casefold().endswith(".pdf")


def _signed_pdf_url_of(v: BookVersion) -> str | None:
    if v.status == "approved" and _is_pdf_path(v.signed_pdf_path):
        return f"/api/v1/books/{v.book_id}/versions/{v.id}/signed-document"
    return None


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


@categories_router.get("", response_model=list[BookCategoryRead])
def list_book_categories(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.view"))],
) -> list[BookCategoryRead]:
    rows = book_service.list_book_categories(db, user)
    return [BookCategoryRead.model_validate(r) for r in rows]


# ---------------------------------------------------------------------------
# Books — classification list + word-session endpoints
# ---------------------------------------------------------------------------


@router.get("/classifications", response_model=ClassificationListResponse)
def list_classifications(
    _user: Annotated[User, Depends(require_capability("books.view"))],
) -> ClassificationListResponse:
    """Return the full government classification list. Gated on ``books.view``
    like the rest of the register: an operator default, so every role holds it,
    but a per-user deny must actually deny."""
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


@router.get("/facets", response_model=BookFacetsResponse)
def book_facets(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.view"))],
) -> BookFacetsResponse:
    """Per-service counts for the Records rail + per-service approval-state
    counts for the status spine. Global, unpaginated."""
    all_records, services = book_service.service_facets(db, user)
    return BookFacetsResponse(
        total=all_records.count,
        states=all_records.states,
        services=[
            ServiceFacetRead(id=s.service_id, count=s.count, states=s.states) for s in services
        ],
    )


@router.get("/word-templates", response_model=list[WordTemplateRead])
def list_word_templates(
    _user: Annotated[User, Depends(require_capability("books.edit"))],
) -> list[WordTemplateRead]:
    """Shared General Book boilerplate library (Word path). Readable by record
    composers; renaming/deleting stays on ``books.templates``."""
    return [
        WordTemplateRead(name=t.name, modified_at=t.modified_at, kind=t.kind)
        for t in book_template_service.list_templates()
    ]


@router.patch("/word-templates/{name}", response_model=WordTemplateRead)
def rename_word_template(
    name: str,
    payload: RenameTemplateRequest,
    _user: Annotated[User, Depends(require_capability("books.templates"))],
) -> WordTemplateRead:
    """Rename a template in the shared General Book library."""
    info = book_template_service.rename_template(name, payload.new_name)
    return WordTemplateRead(name=info.name, modified_at=info.modified_at)


@router.get("/word-templates/{name}/table", response_model=WordTemplateTableRead)
def get_word_template_table_schema(
    name: str,
    _user: Annotated[User, Depends(require_capability("books.edit"))],
) -> WordTemplateTableRead:
    """Return table detection result for a shared General Book template
    (read — same gate as the template list)."""
    has_table, columns = book_template_service.table_schema_for(name)
    return WordTemplateTableRead(has_table=has_table, columns=columns)


@router.delete("/word-templates/{name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_word_template(
    name: str,
    _user: Annotated[User, Depends(require_capability("books.templates"))],
) -> Response:
    """Delete a template from the shared General Book library."""
    book_template_service.delete_template(name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/word-sessions", response_model=WordSessionRead, status_code=status.HTTP_201_CREATED)
def create_word_session(
    payload: WordBookCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.create"))],
    _viewer: Annotated[User, Depends(require_capability("books.view"))],
) -> WordSessionRead:
    """Create a General Book, or a no-ref Report when a signer is given, with a
    Word-editable working docx."""
    service_id = "Report" if payload.signer_employee_id is not None else "General Book"
    _require_record_type_access(db, user, category_id="GS", service_id=service_id)
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
    user: Annotated[User, Depends(require_capability("books.edit"))],
) -> BookRead:
    """Finish the active Word editing session: move docx, create BookVersion + Document, optional PDF."""
    _require_full_book(db, user, book_id)
    row = word_book_service.finish_word_session(db, user=user, book_id=book_id)
    return _build_book_response(db, row, user)


@router.get("/{book_id}/word-sessions/preview")
def word_session_preview(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.edit"))],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """PDF preview of the active Word session's working docx (regenerates on change).

    ``encoding=base64`` mirrors the documents download endpoint — the in-app
    pdf.js canvas fetches base64 text so download accelerators can't hijack
    the PDF byte stream.
    """
    _require_full_book(db, user, book_id)
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
    user: Annotated[User, Depends(require_capability("books.edit"))],
) -> WordSessionRead:
    """Re-open a finished book for Word editing — copies the latest version's docx
    into a fresh working file and returns a new session token + word_url."""
    _require_full_book(db, user, book_id)
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
    user: Annotated[User, Depends(require_capability("books.edit"))],
) -> BookRead:
    """Discard the active Word editing session; void the book if it has no committed versions."""
    _require_full_book(db, user, book_id)
    row = word_book_service.discard_word_session(db, user=user, book_id=book_id)
    return _build_book_response(db, row, user)


@router.post(
    "/{book_id}/save-as-template",
    response_model=WordTemplateRead,
    status_code=status.HTTP_201_CREATED,
)
def save_book_as_template(
    book_id: int,
    payload: SaveAsTemplateRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.templates"))],
) -> WordTemplateRead:
    """Copy a finished General Book into the shared template library
    (retokenized + validated; content becomes visible to all books.templates users)."""
    _require_full_book(db, user, book_id)
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
    user: Annotated[User, Depends(require_capability("books.view"))],
    category_id: str | None = None,
    service_id: str | None = None,
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
        user=user,
        category_id=category_id,
        service_id=service_id,
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
    for row in rows:
        item = _build_book_response(db, row, user, detail=False)
        item.search_snippet = fts_snippets.get(row.id) or None
        _fill_draft_fields(item, row, db, by_book=by_book)
        items.append(item)
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
    *,
    fill_draft: bool = True,
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
        item.approval_steps = item.versions[-1].approval_steps
        item.versions[-1].signed_source = _signed_source_of(current)
        item.versions[-1].signed_pdf_url = _signed_pdf_url_of(current)
    if current is not None and item.versions:
        submitted_at = _version_submitted_at(current, legacy_current=True)
        item.versions[-1].submitted_at = submitted_at
        item.submitted_at = submitted_at
    # v3-imported records: surface the file copied into the employee vault so
    # it's viewable/downloadable (no generated Document on these books).
    item.imported_doc = book_service.imported_document_of(row)
    item.original_creator_user_id = included_papers_service.original_creator_user_id(row)
    item.included_papers_revision = row.included_papers_revision
    if fill_draft:
        _fill_draft_fields(item, row, db, by_book=by_book)
    return item


@router.get("/by-ref/{ref}", response_model=BookRead)
def get_book_by_ref(
    ref: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    version_id: Annotated[int | None, Query(gt=0)] = None,
) -> BookRead:
    """Resolve a book by its reference without bypassing revision-scoped access."""
    row = book_service.get_book_by_ref(db, ref)
    return _build_book_response(db, row, user, version_id=version_id)


@router.get("/awaiting", response_model=list[BookRead])
def list_awaiting(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[BookRead]:
    """Return the caller's actionable signing and advisory assignments."""
    rows = book_service.list_awaiting(db, user_id=user.id)
    return [_build_book_response(db, row, user, detail=False) for row in rows]


@router.get("/awaiting-scan", response_model=list[BookRead])
def list_awaiting_scan(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.edit"))],
    _viewer: Annotated[User, Depends(require_capability("books.view"))],
    scope: Annotated[str, Query(pattern="^(mine|all)$")] = "mine",
) -> list[BookRead]:
    """Records stranded at ``awaiting_scan`` past 24h, oldest first.

    ``scope=mine`` (default) is the caller's own; ``scope=all`` is everyone's,
    so an admin can clear records stranded by a user who lacks books.edit.

    Declared before ``/{book_id}`` so the literal ``awaiting-scan`` segment isn't
    swallowed by the int path param — same reason as ``/awaiting`` above.
    Authority is the same conjunction as filing a scan from the Records surface:
    ``books.view`` and ``books.edit``.
    """
    rows = book_service.list_awaiting_scan(
        db,
        user_id=None if scope == "all" else user.id,
        user=user,
    )
    return [_build_book_response(db, row, user, detail=False) for row in rows]


_SENT_STATUSES = frozenset(
    {"all", "none", "pending", "awaiting_scan", "approved", "rejected", "returned"}
)


def _require_sent_scope(db: Session, user: User) -> None:
    if not perm_service.has_capability(db, user, "books.view"):
        raise AppError(
            "FORBIDDEN",
            "Missing capability: books.view",
            http_status=403,
            details={"capability": "books.view"},
        )


@router.get("/approval-log", response_model=ApprovalLogResponse)
def get_approval_log(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    scope: Annotated[Literal["sent", "received"], Query()] = "received",
    kind: Annotated[Literal["approver", "reviewer"] | None, Query()] = None,
    status: Annotated[str | None, Query()] = None,
    sort: Annotated[Literal["oldest", "newest"], Query()] = "oldest",
    limit: int = Query(LIST_DEFAULT_LIMIT, ge=1, le=LIST_MAX_LIMIT),
    offset: int = Query(0, ge=0),
) -> ApprovalLogResponse:
    """The approvals worklist. ``scope=received`` (default) is authenticated
    and assignment-scoped — a pending signature or review assignment grants
    access without ``books.view``/``books.approve``; signing/reviewing still
    require their own capability at the action endpoint. ``scope=sent``
    requires ``books.view``. ``status`` defaults to ``pending`` for received
    and ``all`` for sent — the outbox is a full submission history.

    Declared before ``/{book_id}`` so the literal ``approval-log`` segment isn't
    swallowed by the int path param — same reason as ``/awaiting`` above.
    """
    if scope == "sent":
        if kind is not None:
            raise AppError(
                "BAD_KIND",
                "kind is only valid for scope=received",
                http_status=422,
            )
        _require_sent_scope(db, user)
        resolved_status = status if status is not None else "all"
        if resolved_status not in _SENT_STATUSES:
            raise AppError(
                "BAD_STATUS",
                f"{resolved_status!r} is not a valid status",
                http_status=422,
            )
        items, total = book_service.approval_log_sent(
            db,
            user=user,
            limit=limit,
            offset=offset,
            status=resolved_status,
            sort=sort,
        )
    else:
        items, total = book_service.approval_log_received(
            db,
            user=user,
            kind=kind or "approver",
            status=status or "pending",
            sort=sort,
            limit=limit,
            offset=offset,
        )
    return ApprovalLogResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/approval-summary", response_model=ApprovalSummaryResponse)
def get_approval_summary(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> ApprovalSummaryResponse:
    """Counts + oldest row driving the generic Approvals landing rule and Home
    summaries — authenticated, no assignments returns an empty summary.

    Declared before ``/{book_id}`` so the literal ``approval-summary`` segment
    isn't swallowed by the int path param."""
    return book_service.approval_summary(db, user)


@router.get(
    "/approval-log/{book_id}/neighbors",
    response_model=ApprovalLogNeighborsResponse,
)
def get_approval_log_neighbors(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    scope: Annotated[Literal["sent", "received"], Query()] = "received",
    kind: Annotated[Literal["approver", "reviewer"] | None, Query()] = None,
    status: Annotated[str, Query()] = "pending",
    sort: Annotated[Literal["oldest", "newest"], Query()] = "oldest",
    version_id: Annotated[int | None, Query(gt=0)] = None,
) -> ApprovalLogNeighborsResponse:
    """Previous/next in the same filtered/ordered worklist the log page uses —
    for header navigation, without a full client-side page download."""
    if scope == "sent":
        if kind is not None:
            raise AppError("BAD_KIND", "kind is only valid for scope=received", http_status=422)
        _require_sent_scope(db, user)
    position, total, previous, following = book_service.approval_log_neighbors(
        db,
        user=user,
        scope=scope,
        kind=kind or "approver",
        status=status,
        sort=sort,
        book_id=book_id,
        version_id=version_id,
    )
    return ApprovalLogNeighborsResponse(
        position=position,
        total=total,
        previous=previous,
        next=following,
    )


@router.get("/approvers", response_model=list[ApproverOptionRead])
def list_approvers(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.edit"))],
) -> list[ApproverOptionRead]:
    """Active users who hold ``books.approve`` — for the submit-for-approval picker.

    Declared before ``/{book_id}`` so the literal ``approvers`` segment isn't
    swallowed by the int path param."""
    return book_service.list_approver_candidates(db)


@router.get("/reviewer-candidates", response_model=list[ApproverOptionRead])
def list_reviewer_candidates(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.edit"))],
) -> list[ApproverOptionRead]:
    """Active accounts pickable as reviewers (any active user; no signature gate).

    Declared before ``/{book_id}`` so the literal ``reviewer-candidates`` segment
    isn't swallowed by the int path param."""
    return book_service.list_reviewer_candidates(db)


def _build_versions(
    db: Session,
    row: Book,
    *,
    version_ids: frozenset[int] | None = None,
) -> list[BookVersionRead]:
    versions = [
        version
        for version in sorted(row.versions, key=lambda item: item.version_no)
        if version_ids is None or version.id in version_ids
    ]
    document_ids = {v.document_id for v in versions if v.document_id is not None}
    documents_by_id = (
        {
            document.id: document
            for document in db.scalars(select(Document).where(Document.id.in_(document_ids)))
        }
        if document_ids
        else {}
    )
    revision_access = (
        list(
            db.scalars(
                select(BookRevisionAccess)
                .where(BookRevisionAccess.version_id.in_([version.id for version in versions]))
                .order_by(BookRevisionAccess.decided_at, BookRevisionAccess.id)
            )
        )
        if versions
        else []
    )
    access_by_version: dict[int, list[BookRevisionAccess]] = {}
    user_ids: set[int] = set()
    for version in versions:
        if version.created_by_user_id is not None:
            user_ids.add(version.created_by_user_id)
        user_ids.update(step.assignee_user_id for step in version.approval_steps)
    user_ids.update(access.user_id for access in revision_access)
    names_by_id = book_service.resolve_names_by_ids(db, user_ids)
    for access in revision_access:
        access_by_version.setdefault(access.version_id, []).append(access)

    out: list[BookVersionRead] = []
    current_version = max(row.versions, key=lambda item: item.version_no, default=None)
    current_version_id = current_version.id if current_version is not None else None
    for version in versions:
        docx_url = pdf_url = None
        document = (
            documents_by_id.get(version.document_id) if version.document_id is not None else None
        )
        if document is not None:
            base = f"/api/v1/documents/{document.id}/download"
            docx_url = (
                f"{base}?format=docx&version_id={version.id}"
                if document.docx_path is not None
                else None
            )
            signed_path = version.signed_pdf_path if version.status == "approved" else None
            if document.pdf_path is not None and (signed_path is None or _is_pdf_path(signed_path)):
                pdf_url = f"{base}?format=pdf&version_id={version.id}"

        step_reads: list[BookApprovalStepRead] = []
        source_decisions: set[tuple[int, str, str, datetime]] = set()
        for step in version.approval_steps:
            item = BookApprovalStepRead.model_validate(step)
            item.assignee_name = names_by_id.get(step.assignee_user_id)
            step_reads.append(item)
            if step.decided_at is not None and step.state != "pending":
                source_decisions.add(
                    (
                        step.assignee_user_id,
                        step.kind or "approver",
                        step.state,
                        step.decided_at,
                    )
                )

        retained_decisions = [
            RetainedDecisionRead(
                kind=access.kind,
                state=access.state,
                note=access.note,
                decided_at=access.decided_at,
                assignee_user_id=access.user_id,
                assignee_name=names_by_id.get(access.user_id),
            )
            for access in access_by_version.get(version.id, [])
            if (
                access.user_id,
                access.kind,
                access.state,
                access.decided_at,
            )
            not in source_decisions
        ]
        out.append(
            BookVersionRead(
                id=version.id,
                version_no=version.version_no,
                trigger=version.trigger,
                status=version.status,
                template_id=version.template_id,
                document_id=version.document_id,
                # Word versions store {}. "Has fields" means non-empty and
                # therefore safe to reopen in the source-form editor.
                has_fields=bool(version.fields),
                submitted_at=_version_submitted_at(
                    version,
                    legacy_current=version.id == current_version_id,
                ),
                created_at=version.created_at,
                created_by_name=(
                    names_by_id.get(version.created_by_user_id)
                    if version.created_by_user_id is not None
                    else None
                ),
                docx_url=docx_url,
                pdf_url=pdf_url,
                manager_sig_embedded=version.manager_sig_embedded,
                signed_pdf_url=_signed_pdf_url_of(version),
                signed_source=_signed_source_of(version),
                approval_steps=step_reads,
                retained_decisions=retained_decisions,
            )
        )
    return out


def _populate_included_papers(item: BookRead, row: Book, db: Session) -> None:
    item.original_creator_user_id = included_papers_service.original_creator_user_id(row)
    item.included_papers_revision = row.included_papers_revision
    try:
        package = included_papers_service.describe_package(db, row)
    except AppError:
        return
    item.included_papers_fixed_page_count = package.fixed_page_count
    item.included_papers_total_page_count = package.total_page_count
    item.included_papers = [
        IncludedPaperRead.model_validate(paper, from_attributes=True) for paper in package.papers
    ]
    item.included_papers_history = [
        IncludedPapersHistoryRead(
            actor_user_id=event.actor_user_id,
            actor_name=event.actor_name,
            revision_before=event.revision_before,
            revision_after=event.revision_after,
            added=event.added,
            removed=event.removed,
            replaced=[
                IncludedPaperReplacementRead(
                    from_name=replacement.from_name,
                    to_name=replacement.to_name,
                )
                for replacement in event.replaced
            ],
            reordered=event.reordered,
            created_at=event.created_at,
        )
        for event in package.history
    ]


def _build_book_detail(db: Session, row: Book) -> BookRead:
    item = BookRead.model_validate(row)
    item.subject = book_service.derive_subject(row)
    item.submitted_by_name = book_service.submitter_name(db, row)
    item.submitted_by_g = book_service.submitter_g_number(db, row)
    item.doc_manager_user_id, item.doc_manager_name, item.doc_manager_has_signature = (
        book_service.resolve_doc_manager_user(db, row)
    )
    item.versions = _build_versions(db, row)
    current = row.versions[-1] if row.versions else None
    current_read = item.versions[-1] if item.versions else None
    item.approval_steps = current_read.approval_steps if current_read is not None else []
    item.submitted_at = current_read.submitted_at if current_read is not None else None
    item.signing_path = form_policy.signing_path_of(
        current.template_id if current is not None else None
    )
    item.is_word_book = (
        current is not None and not current.fields and current.document_id is not None
    )
    item.imported_doc = book_service.imported_document_of(row)
    item.sms = [
        NotifyMessageRead.model_validate(message)
        for message in book_service.messages_for_book(db, row)
    ]
    _populate_included_papers(item, row, db)
    _fill_draft_fields(item, row, db)
    return item


def _context_string(context: dict[str, object], key: str) -> str | None:
    value = context.get(key)
    return value if isinstance(value, str) else None


def _context_user_id(context: dict[str, object], key: str) -> int | None:
    value = context.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _context_datetime(context: dict[str, object], key: str) -> datetime | None:
    value = context.get(key)
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None
    normalized = f"{value[:-1]}+00:00" if value.endswith("Z") else value
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _version_submitted_at(
    version: BookVersion,
    *,
    legacy_current: bool,
) -> datetime | None:
    context = version.approval_context if isinstance(version.approval_context, dict) else {}
    submitted_at = _context_datetime(context, "submitted_at")
    if submitted_at is not None or not legacy_current:
        return submitted_at
    step_times = [
        step.created_at for step in version.approval_steps if isinstance(step.created_at, datetime)
    ]
    return min(step_times, default=None)


def _snapshot_category(
    row: Book,
    context: dict[str, object],
) -> BookCategoryRead | None:
    category_id = _context_string(context, "category_id")
    if category_id is None or row.category is None or row.category.id != category_id:
        return None
    return BookCategoryRead(
        id=category_id,
        name_en=_context_string(context, "category_name_en"),
        name_ar=_context_string(context, "category_name_ar"),
        prefix=row.category.prefix,
        requires_approval=row.category.requires_approval,
    )


def _action_flags(
    db: Session,
    row: Book,
    user: User,
    selected: BookVersion | None,
) -> tuple[bool, bool, str | None]:
    current = max(row.versions, key=lambda item: item.version_no, default=None)
    if (
        selected is None
        or current is None
        or selected.id != current.id
        or row.deleted_at is not None
        or row.voided_at is not None
    ):
        return False, False, None
    pending = [
        step
        for step in selected.approval_steps
        if step.assignee_user_id == user.id and step.state == "pending"
    ]
    approver_pending = any((step.kind or "approver") == "approver" for step in pending)
    reviewer_pending = any(step.kind == "reviewer" for step in pending)
    can_sign = (
        row.approval_state == "pending"
        and approver_pending
        and perm_service.has_capability(db, user, "books.approve")
    )
    can_review = (
        row.approval_state in ("pending", "approved", "returned", "rejected") and reviewer_pending
    )
    your_step_kind = "approver" if approver_pending else "reviewer" if reviewer_pending else None
    return can_sign, can_review, your_step_kind


def _build_scoped_book_response(
    db: Session,
    row: Book,
    user: User,
    *,
    selected: BookVersion,
    allowed_version_ids: frozenset[int],
    access_scope: Literal["full", "assigned_revision"],
) -> BookRead:
    context = selected.approval_context if isinstance(selected.approval_context, dict) else {}
    category_id = _context_string(context, "category_id")
    versions = _build_versions(db, row, version_ids=allowed_version_ids)
    selected_read = next(version for version in versions if version.id == selected.id)
    can_sign, can_review, your_step_kind = _action_flags(db, row, user, selected)
    return BookRead(
        id=row.id,
        ref_number=row.ref_number,
        category_id=category_id,
        category=_snapshot_category(row, context),
        employee_id=_context_string(context, "employee_id"),
        employee_name_snapshot=_context_string(context, "employee_name_snapshot"),
        subject=_context_string(context, "subject"),
        direction=_context_string(context, "direction"),
        stamp_style=_context_string(context, "stamp_style"),
        created_at=row.created_at,
        deleted_at=row.deleted_at if access_scope == "full" else None,
        priority=_context_string(context, "priority"),
        approval_state=selected.status,
        access_scope=access_scope,
        selected_version_id=selected.id,
        can_sign=can_sign,
        can_review=can_review,
        classification_code=None,
        voided_at=None,
        is_draft=False,
        edit_session=None,
        signing_path=form_policy.signing_path_of(selected.template_id),
        submitted_by_user_id=_context_user_id(context, "submitted_by_user_id"),
        submitted_by_name=_context_string(context, "submitted_by_name"),
        submitted_by_g=None,
        submitted_at=selected_read.submitted_at,
        doc_manager_user_id=_context_user_id(context, "doc_manager_user_id"),
        doc_manager_name=_context_string(context, "doc_manager_name"),
        doc_manager_has_signature=False,
        is_word_book=not selected.fields and selected.document_id is not None,
        your_step_kind=your_step_kind,
        approval_steps=selected_read.approval_steps,
        attachment_paths=[],
        versions=versions,
        original_creator_user_id=None,
        included_papers_revision=0,
        included_papers_fixed_page_count=0,
        included_papers_total_page_count=0,
        included_papers=[],
        included_papers_history=[],
        imported_doc=None,
        sms=[],
        search_snippet=None,
    )


def _build_book_response(
    db: Session,
    row: Book,
    user: User,
    *,
    version_id: int | None = None,
    detail: bool = True,
) -> BookRead:
    access = book_service.resolve_book_read_access(
        db,
        user,
        row,
        version_id=version_id,
    )
    selected = next(
        (version for version in row.versions if version.id == access.selected_version_id),
        None,
    )
    current = max(row.versions, key=lambda item: item.version_no, default=None)
    selected_is_current = (selected is None and current is None) or (
        selected is not None and current is not None and selected.id == current.id
    )

    if access.full_access and selected_is_current:
        if detail:
            item = _build_book_detail(db, row)
        else:
            item = BookRead.model_validate(row)
            item.subject = book_service.derive_subject(row)
            item = _enrich_path_fields(item, row, db, fill_draft=False)
        can_sign, can_review, your_step_kind = _action_flags(db, row, user, selected)
        item.access_scope = "full"
        item.selected_version_id = access.selected_version_id
        item.can_sign = can_sign
        item.can_review = can_review
        item.your_step_kind = your_step_kind
        return item

    if selected is None:
        # Assigned access always requires a real revision. A full versionless
        # legacy record was handled by the branch above.
        raise AppError("FORBIDDEN", "You do not have access to this revision.", http_status=403)
    return _build_scoped_book_response(
        db,
        row,
        user,
        selected=selected,
        allowed_version_ids=access.allowed_version_ids,
        access_scope="full" if access.full_access else "assigned_revision",
    )


def _package_proposal(
    request: IncludedPapersRequest,
) -> list[included_papers_service.PaperProposal]:
    return [
        included_papers_service.PaperProposal(
            id=str(item.id),
            staged_token=item.staged_token,
            original_name=item.original_name,
        )
        for item in request.items
    ]


@router.post(
    "/{book_id}/included-papers/preview",
    response_model=IncludedPapersPreviewRead,
)
def preview_included_papers(
    book_id: int,
    request: IncludedPapersRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> IncludedPapersPreviewRead:
    _require_full_book(db, user, book_id)
    package = included_papers_service.preview_package(
        db,
        book_id,
        user_id=user.id,
        revision=request.revision,
        proposal=_package_proposal(request),
    )
    return IncludedPapersPreviewRead(
        revision=package.revision,
        fixed_page_count=package.base_page_count,
        total_page_count=package.total_page_count,
        papers=[
            IncludedPaperRead.model_validate(paper, from_attributes=True)
            for paper in package.papers
        ],
        pdf_base64=base64.b64encode(package.pdf_bytes).decode("ascii"),
    )


@router.put("/{book_id}/included-papers", response_model=BookRead)
def save_included_papers(
    book_id: int,
    request: IncludedPapersRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> BookRead:
    _require_full_book(db, user, book_id)
    package = included_papers_service.save_package(
        db,
        book_id,
        user_id=user.id,
        revision=request.revision,
        proposal=_package_proposal(request),
    )
    row = book_service.get_book_detail(db, book_id)
    version = max(row.versions, key=lambda item: item.version_no)
    included_papers_service.notify_approvers(
        db,
        row,
        version,
        user,
        package.change_summary or {},
    )
    return _build_book_response(db, row, user)


def _require_annotation_write_access(
    db: Session,
    user: User,
    book_id: int,
    version_id: int,
) -> Book:
    row = book_service.get_book_detail(db, book_id)
    access = book_service.resolve_book_read_access(
        db,
        user,
        row,
        version_id=version_id,
    )
    if access.full_access:
        return row
    current = max(row.versions, key=lambda item: item.version_no, default=None)
    if (
        current is not None
        and current.id == version_id
        and row.deleted_at is None
        and row.voided_at is None
        and any(
            step.assignee_user_id == user.id and step.state == "pending"
            for step in current.approval_steps
        )
    ):
        return row
    raise AppError(
        "FORBIDDEN",
        "A current assignment or normal record access is required.",
        http_status=403,
    )


@router.get("/{book_id}", response_model=BookRead)
def get_book(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    include_deleted: bool = False,
    version_id: Annotated[int | None, Query(gt=0)] = None,
) -> BookRead:
    row = book_service.get_book_detail(db, book_id, include_deleted=include_deleted)
    return _build_book_response(db, row, user, version_id=version_id)


@router.get("/{book_id}/versions/{version_id}/fields")
def get_version_fields(
    book_id: int,
    version_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.edit"))],
) -> dict[str, object]:
    """Return the raw stored ``fields`` blob for one book version — backs the
    ApplicationPage revise-mode prefill. Deliberately not on ``BookRead`` (the
    detail payload only exposes ``has_fields``).

    Requires ``books.edit`` (not ``books.view``) because this backs the
    revise/edit write-path: the caller fetches these fields in order to submit
    a revised generation, which is a managed write operation.
    """
    row = book_service.get_book_detail(db, book_id)
    book_service.require_full_book_access(db, user, row)
    book_service.resolve_book_read_access(db, user, row, version_id=version_id)
    version = next(item for item in row.versions if item.id == version_id)
    return {"fields": version.fields or {}}


@router.get(
    "/{book_id}/versions/{version_id}/annotations",
    response_model=list[BookAnnotationRead],
)
def list_annotations(
    book_id: int,
    version_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[BookAnnotationRead]:
    row = book_service.get_book_detail(db, book_id)
    book_service.resolve_book_read_access(db, user, row, version_id=version_id)
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
    _require_annotation_write_access(db, user, book_id, version_id)
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
    _require_annotation_write_access(db, user, book_id, version_id)
    book_service.delete_annotation(db, book_id, version_id, annotation_id, user_id=user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("", response_model=BookRead, status_code=status.HTTP_201_CREATED)
def create_book(
    payload: BookCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.create"))],
    _viewer: Annotated[User, Depends(require_capability("books.view"))],
) -> BookRead:
    # Direct creation persists v1 with template_id=NULL, so read-time
    # classification is always Other regardless of the subject text.
    _require_record_type_access(
        db,
        user,
        category_id=payload.category_id,
        service_id=OTHER_SERVICE_ID,
    )
    row = book_service.create_book(db, payload)
    return _build_book_response(db, row, user)


@router.patch("/{book_id}", response_model=BookRead)
def update_book(
    book_id: int,
    payload: BookUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.edit"))],
) -> BookRead:
    _require_full_book(db, user, book_id)
    row = book_service.update_book(db, book_id, payload)
    return _build_book_response(db, row, user)


@router.delete("/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_book(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.delete"))],
) -> Response:
    _require_full_book(db, user, book_id)
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
    user: Annotated[User, Depends(require_capability("books.submit"))],
) -> BookRead:
    _require_full_book(db, user, book_id)
    row = book_service.submit_for_approval(
        db,
        book_id,
        priority=payload.priority,
        approver_user_id=payload.approver_user_id,
        reviewer_user_ids=payload.reviewer_user_ids,
        submitted_by_user_id=user.id,
    )
    return _build_book_response(db, row, user)


@router.post("/{book_id}/sign", response_model=BookRead)
def sign_book(
    book_id: int,
    payload: BookSignRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.approve"))],
) -> BookRead:
    """Approve == sign: embed the signer's signature into the current version's
    document, store the signed PDF, and mark the book approved."""
    row = book_service.sign_book(
        db,
        book_id,
        user_id=user.id,
        version_id=payload.version_id,
    )
    return _build_book_response(
        db,
        row,
        user,
        version_id=payload.version_id,
    )


@router.post("/{book_id}/reject", response_model=BookRead)
def reject_step(
    book_id: int,
    payload: BookDecisionRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.approve"))],
) -> BookRead:
    row = book_service.decide_step(
        db,
        book_id,
        user_id=user.id,
        version_id=payload.version_id,
        decision="rejected",
        note=payload.note,
    )
    return _build_book_response(
        db,
        row,
        user,
        version_id=payload.version_id,
    )


@router.post("/{book_id}/return", response_model=BookRead)
def return_step(
    book_id: int,
    payload: BookDecisionRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.approve"))],
) -> BookRead:
    row = book_service.decide_step(
        db,
        book_id,
        user_id=user.id,
        version_id=payload.version_id,
        decision="returned",
        note=payload.note,
    )
    return _build_book_response(
        db,
        row,
        user,
        version_id=payload.version_id,
    )


@router.post("/{book_id}/note", response_model=BookRead)
def add_note(
    book_id: int,
    payload: BookDecisionRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.approve"))],
) -> BookRead:
    row = book_service.add_note(
        db,
        book_id,
        user_id=user.id,
        version_id=payload.version_id,
        note=payload.note,
    )
    return _build_book_response(
        db,
        row,
        user,
        version_id=payload.version_id,
    )


@router.put("/{book_id}/state", response_model=BookRead)
def override_book_state(
    book_id: int,
    payload: BookStateOverrideRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.override_state"))],
) -> BookRead:
    """Force this record's state, bypassing the approval chain (admin repair).

    Returns the full detail shape (not the bare row) because the flip moves the
    state pill, the chips, the timeline, and whether the signed PDF is served —
    the record screen re-renders off this response.
    """
    _require_full_book(db, user, book_id)
    book_service.override_state(
        db, book_id, target_state=payload.state, actor=user, reason=payload.reason
    )
    row = book_service.get_book_detail(db, book_id)
    return _build_book_response(db, row, user)


@router.post("/{book_id}/review", response_model=BookRead)
def review_book(
    book_id: int,
    payload: ReviewRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> BookRead:
    """Advisory reviewer verdict — authorized by assignment (any active account)."""
    row = book_service.record_review(
        db,
        book_id,
        user_id=user.id,
        version_id=payload.version_id,
        decision=payload.decision,
        note=payload.note,
    )
    return _build_book_response(
        db,
        row,
        user,
        version_id=payload.version_id,
    )


@router.post("/{book_id}/seen", status_code=status.HTTP_204_NO_CONTENT)
def mark_book_seen(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Response:
    """Mark the record seen by the caller. Idempotent; no-op if not a participant."""
    row = book_service.get_book_detail(db, book_id)
    book_service.resolve_book_read_access(db, user, row)
    book_service.mark_seen(db, book_id, user_id=user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{book_id}/reviewers", response_model=BookRead)
def add_reviewers(
    book_id: int,
    payload: ReviewersAddRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.edit"))],
) -> BookRead:
    """Append advisory reviewer steps to the current pending version."""
    _require_full_book(db, user, book_id)
    row = book_service.add_reviewers(db, book_id, user_ids=payload.user_ids)
    return _build_book_response(db, row, user)


@router.delete("/{book_id}/reviewers/{user_id}", response_model=BookRead)
def remove_reviewer(
    book_id: int,
    user_id: int,
    db: Annotated[Session, Depends(get_db)],
    actor: Annotated[User, Depends(require_capability("books.edit"))],
) -> BookRead:
    """Remove a pending reviewer step from the current version."""
    _require_full_book(db, actor, book_id)
    row = book_service.remove_reviewer(db, book_id, user_id=user_id)
    return _build_book_response(db, row, actor)


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------


@router.post("/{book_id}/attachments", response_model=BookRead)
async def add_book_attachment(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.edit"))],
    upload: Annotated[UploadFile, File(alias="file")],
    as_signed: Annotated[bool, Form()] = False,
) -> BookRead:
    """File an attachment. ``awaiting_scan`` books flip silently (the scan is the
    signature). For a ``none``/``pending`` book, ``as_signed=true`` records the
    upload as the signed copy and approves the record; otherwise it is filed as a
    plain attachment. Authority is ``books.edit`` for every path."""
    _require_full_book(db, user, book_id)
    data = await upload.read()
    row = book_service.add_attachment(
        db, book_id, upload.filename or "scan", data, user=user, as_signed=as_signed
    )
    return _build_book_response(db, row, user)


@router.get("/{book_id}/attachments/{index}")
def get_book_attachment(
    book_id: int,
    index: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """Serve one stored attachment.

    ``encoding=base64`` returns the bytes base64-encoded as ``text/plain`` so
    the in-app pdf.js viewer can fetch them without Internet Download Manager
    or the browser PDF handler intercepting the response — same trick as
    ``GET /documents/{id}/download`` (see that route's docstring).
    """
    book = _require_full_book(db, user, book_id)
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
    user: Annotated[User, Depends(require_capability("books.edit"))],
) -> BookRead:
    """Delete one plain attachment by its ``attachment_paths`` index (undo a
    wrongly-uploaded scan). Does not touch a signed copy — see
    ``DELETE /{book_id}/signed-copy``."""
    book = _require_full_book(db, user, book_id)
    paths = book.attachment_paths or []
    if index < 0 or index >= len(paths):
        raise HTTPException(status_code=404, detail="attachment not found")
    row = book_service.detach_attachment(db, book_id, paths[index])
    return _build_book_response(db, row, user)


@router.put("/{book_id}/attachments/{index}", response_model=BookRead)
async def replace_book_attachment(
    book_id: int,
    index: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.edit"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> BookRead:
    """Replace one plain attachment's bytes, keeping its index (fix a wrong upload)."""
    _require_full_book(db, user, book_id)
    data = await upload.read()
    row = book_service.replace_attachment(db, book_id, index, upload.filename or "scan", data)
    return _build_book_response(db, row, user)


@router.put("/{book_id}/signed-copy", response_model=BookRead)
async def replace_signed_copy(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.edit"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> BookRead:
    """Replace the signed copy's bytes, keeping the record approved."""
    _require_full_book(db, user, book_id)
    data = await upload.read()
    row = book_service.replace_signed_copy(
        db, book_id, upload.filename or "signed", data, user=user
    )
    return _build_book_response(db, row, user)


@router.delete("/{book_id}/signed-copy", response_model=BookRead)
def unfile_signed_copy(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.edit"))],
) -> BookRead:
    """Undo a filed signed copy and revert the record's approval state."""
    _require_full_book(db, user, book_id)
    row = book_service.unfile_signed_copy(db, book_id, user=user)
    return _build_book_response(db, row, user)


@router.get("/{book_id}/imported-document")
def get_imported_document(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
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
    book = _require_full_book(db, user, book_id)
    abs_path = book_service.resolve_imported_file(book, prefer=format)
    if abs_path is None:
        raise HTTPException(status_code=404, detail="imported document not available")
    if format == "pdf":
        if (b64 := maybe_base64(abs_path.read_bytes(), encoding)) is not None:
            return b64
        return FileResponse(abs_path, filename=abs_path.name, media_type="application/pdf")
    return FileResponse(abs_path, filename=abs_path.name, media_type="application/octet-stream")


@router.get("/{book_id}/versions/{version_id}/signed-document")
def get_signed_document(
    book_id: int,
    version_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """Serve a version's own signed artifact directly, for signed revisions
    that carry no generated ``Document`` row to route through (e.g. a scan
    filed straight onto the version, or after a signed-copy replacement).
    Exact-version read access; 404 when no signed rendition exists."""
    row = book_service.get_book_detail(db, book_id)
    book_service.resolve_book_read_access(db, user, row, version_id=version_id)
    version = next(v for v in row.versions if v.id == version_id)
    if not version.signed_pdf_path:
        raise HTTPException(status_code=404, detail="no signed rendition available")
    abs_path = book_service.resolve_attachment_path(version.signed_pdf_path)
    if abs_path is None:
        raise HTTPException(status_code=404, detail="signed rendition missing on disk")
    filename = f"{row.ref_number.replace('/', '-')}-v{version.version_no}-signed.pdf"
    if (b64 := maybe_base64(abs_path.read_bytes(), encoding)) is not None:
        return b64
    return FileResponse(
        abs_path,
        filename=filename,
        media_type="application/pdf",
        content_disposition_type="inline",
    )


@router.get("/{book_id}/revision-access", response_model=list[BookRevisionAccessRead])
def list_revision_access(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("users.manage"))],
) -> list[BookRevisionAccessRead]:
    """Every retained revision grant on this record, for the revocation panel."""
    book_service.get_book(db, book_id)
    grants = book_service.list_revision_access(db, book_id)
    names = book_service.resolve_names_by_ids(db, {grant.user_id for grant in grants})
    version_nos = {grant.version_id: grant.version.version_no for grant in grants}
    return [
        BookRevisionAccessRead(
            id=grant.id,
            version_id=grant.version_id,
            version_no=version_nos[grant.version_id],
            user_id=grant.user_id,
            user_name=names.get(grant.user_id),
            kind=grant.kind,
            state=grant.state,
            note=grant.note,
            assigned_at=grant.assigned_at,
            decided_at=grant.decided_at,
            revoked_at=grant.revoked_at,
            revoked_by_user_id=grant.revoked_by_user_id,
            revocation_reason=grant.revocation_reason,
        )
        for grant in grants
    ]


@router.post(
    "/{book_id}/revision-access/{access_id}/revoke",
    response_model=list[BookRevisionAccessRead],
)
def revoke_revision_access(
    book_id: int,
    access_id: int,
    payload: RevokeRevisionAccessRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("users.manage"))],
) -> list[BookRevisionAccessRead]:
    """Revoke a user's retained revision access, with a required reason."""
    book_service.get_book(db, book_id)
    grants = book_service.revoke_revision_access(
        db,
        book_id=book_id,
        access_id=access_id,
        reason=payload.reason,
        actor=user,
    )
    names = book_service.resolve_names_by_ids(db, {grant.user_id for grant in grants})
    return [
        BookRevisionAccessRead(
            id=grant.id,
            version_id=grant.version_id,
            version_no=grant.version.version_no,
            user_id=grant.user_id,
            user_name=names.get(grant.user_id),
            kind=grant.kind,
            state=grant.state,
            note=grant.note,
            assigned_at=grant.assigned_at,
            decided_at=grant.decided_at,
            revoked_at=grant.revoked_at,
            revoked_by_user_id=grant.revoked_by_user_id,
            revocation_reason=grant.revocation_reason,
        )
        for grant in grants
    ]


__all__ = ["categories_router", "router"]
