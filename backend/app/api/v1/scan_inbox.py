"""GET/POST /api/v1/scan-inbox — the ambient OCR triage queue."""

from __future__ import annotations

import mimetypes
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import Employee, LedgerEntry, ScanInbox, User
from app.db.session import get_db
from app.schemas.scan_inbox import (
    RouteRequest,
    ScanInboxCount,
    ScanInboxItem,
    ScanInboxList,
)
from app.services import scan_inbox_service

# Types safe to render inline in the browser; anything else is forced to
# download so a stored .html/.svg can't execute in the app origin (XSS).
_INLINE_SAFE_TYPES = frozenset(
    {
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/bmp",
        "image/tiff",
    }
)

router = APIRouter(prefix="/scan-inbox", tags=["scan-inbox"])


def _to_item(
    db: Session,
    row: ScanInbox,
    *,
    entries: dict[int, LedgerEntry] | None = None,
    employees: dict[str, Employee] | None = None,
) -> ScanInboxItem:
    """Map a ScanInbox ORM row to the response schema.

    ``entries``/``employees`` are optional id→row maps: when the caller has
    batch-fetched them (the list endpoint), we read from the maps instead of
    issuing a ``db.get`` per row (avoids the N+1). Single-row callers omit them
    and fall back to a direct lookup.
    """
    sender = subject = None
    if row.ledger_entry_id is not None:
        entry = (
            entries.get(row.ledger_entry_id)
            if entries is not None
            else db.get(LedgerEntry, row.ledger_entry_id)
        )
        if entry is not None:
            sender = getattr(entry, "counterparty", None)
            subject = getattr(entry, "subject", None)
    name_en = name_ar = None
    if row.proposed_employee_id is not None:
        emp = (
            employees.get(row.proposed_employee_id)
            if employees is not None
            else db.get(Employee, row.proposed_employee_id)
        )
        if emp is not None:
            name_en = emp.name_en
            name_ar = getattr(emp, "name_ar", None)
    return ScanInboxItem(
        id=row.id,
        created_at=row.created_at,
        source=row.source,
        state=row.state,
        filename=row.filename,
        document_type=row.document_type,
        confidence=row.confidence,
        confidence_tier=row.confidence_tier,
        proposed_route=row.proposed_route,
        proposed_ref=row.proposed_ref,
        proposed_book_id=row.proposed_book_id,
        proposed_employee_id=row.proposed_employee_id,
        proposed_employee_name_en=name_en,
        proposed_employee_name_ar=name_ar,
        match_score=row.match_score,
        ledger_entry_id=row.ledger_entry_id,
        email_sender=sender,
        email_subject=subject,
        error_detail=row.error_detail,
        fields=row.fields or {},
        candidates=row.candidates or [],
    )


@router.get("", response_model=ScanInboxList)
def list_scan_inbox(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("documents.scan"))],
    state: str | None = None,
) -> ScanInboxList:
    rows = scan_inbox_service.list_items(db, owner_user_id=user.id, state=state)
    # Batch-resolve referenced ledger entries + employees in one query each,
    # instead of a db.get per row (the N+1 the audit flagged).
    entry_ids = {r.ledger_entry_id for r in rows if r.ledger_entry_id is not None}
    emp_ids = {r.proposed_employee_id for r in rows if r.proposed_employee_id is not None}
    entries = (
        {
            e.id: e
            for e in db.execute(select(LedgerEntry).where(LedgerEntry.id.in_(entry_ids))).scalars()
        }
        if entry_ids
        else {}
    )
    employees = (
        {e.id: e for e in db.execute(select(Employee).where(Employee.id.in_(emp_ids))).scalars()}
        if emp_ids
        else {}
    )
    items = [_to_item(db, r, entries=entries, employees=employees) for r in rows]
    return ScanInboxList(items=items, total=len(items))


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
    guessed = mimetypes.guess_type(item.filename)[0] or "application/octet-stream"
    if guessed in _INLINE_SAFE_TYPES:
        return FileResponse(
            abs_path,
            filename=item.filename,
            media_type=guessed,
            content_disposition_type="inline",
            headers={"X-Content-Type-Options": "nosniff"},
        )
    return FileResponse(
        abs_path,
        filename=item.filename,
        media_type="application/octet-stream",
        content_disposition_type="attachment",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.get("/count", response_model=ScanInboxCount)
def scan_inbox_count(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("documents.scan"))],
) -> ScanInboxCount:
    c = scan_inbox_service.counts(db, owner_user_id=user.id)
    return ScanInboxCount(
        awaiting_confirmation=c["awaiting_confirmation"],
        unrouted=c["unrouted"],
        total=c["total"],
    )


@router.post("/{item_id}/confirm", response_model=ScanInboxItem)
def confirm_item(
    item_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("documents.scan"))],
) -> ScanInboxItem:
    return _to_item(db, scan_inbox_service.confirm(db, item_id, user=user))


@router.post("/{item_id}/route", response_model=ScanInboxItem)
def route_item(
    item_id: int,
    body: RouteRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("documents.scan"))],
) -> ScanInboxItem:
    return _to_item(
        db,
        scan_inbox_service.route_item(
            db, item_id, user=user, employee_id=body.employee_id, book_id=body.book_id
        ),
    )


@router.post("/{item_id}/dismiss", response_model=ScanInboxItem)
def dismiss_item(
    item_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("documents.scan"))],
) -> ScanInboxItem:
    return _to_item(db, scan_inbox_service.dismiss(db, item_id, user=user))


@router.post("/{item_id}/undo", response_model=ScanInboxItem)
def undo_item(
    item_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("documents.scan"))],
) -> ScanInboxItem:
    return _to_item(db, scan_inbox_service.undo(db, item_id, user=user))
