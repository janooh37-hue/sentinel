"""GET/POST /api/v1/scan-inbox — the ambient OCR triage queue."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import Employee, LedgerEntry, ScanInbox, User
from app.db.session import get_db
from app.schemas.scan_inbox import RouteRequest, ScanInboxCount, ScanInboxItem, ScanInboxList
from app.services import scan_inbox_service

router = APIRouter(prefix="/scan-inbox", tags=["scan-inbox"])


def _to_item(db: Session, row: ScanInbox) -> ScanInboxItem:
    """Map a ScanInbox ORM row to the response schema.

    LedgerEntry columns used:
    - ``counterparty`` (String, not nullable) — the sender name/address
    - ``subject``      (String, not nullable) — the email subject line
    Both are fetched with getattr(..., None) fallbacks for safety.
    """
    sender = subject = None
    if row.ledger_entry_id is not None:
        entry = db.get(LedgerEntry, row.ledger_entry_id)
        if entry is not None:
            sender = getattr(entry, "counterparty", None)
            subject = getattr(entry, "subject", None)
    name_en = name_ar = None
    if row.proposed_employee_id is not None:
        emp = db.get(Employee, row.proposed_employee_id)
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
    )


@router.get("", response_model=ScanInboxList)
def list_scan_inbox(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("documents.scan"))],
    state: str | None = None,
) -> ScanInboxList:
    rows = scan_inbox_service.list_items(db, owner_user_id=user.id, state=state)
    items = [_to_item(db, r) for r in rows]
    return ScanInboxList(items=items, total=len(items))


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
