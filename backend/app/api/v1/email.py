"""Email integration endpoints — configure IMAP account + trigger sync.

  GET    /email/account          → current config (no password)
  PUT    /email/account          → upsert (password optional on PATCH-like updates)
  DELETE /email/account          → drop the row + forget credentials
  POST   /email/test             → live IMAP login test against saved creds
  POST   /email/sync             → fetch new mail + create LedgerEntries
  GET    /email/sync/status      → live sync state for the Ledger strip
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.email import (
    EmailAccountRead,
    EmailAccountUpsert,
    EmailSendRequest,
    EmailSendResult,
    EmailSyncResult,
    EmailSyncStatus,
)
from app.services import email_service, scheduler_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/email", tags=["email"])


def _to_read(account: object) -> EmailAccountRead:
    """Map the SQLAlchemy row to the public schema (adds ``has_password``)."""
    return EmailAccountRead(
        id=account.id,  # type: ignore[attr-defined]
        email=account.email,  # type: ignore[attr-defined]
        imap_host=account.imap_host,  # type: ignore[attr-defined]
        imap_port=account.imap_port,  # type: ignore[attr-defined]
        use_ssl=account.use_ssl,  # type: ignore[attr-defined]
        username=account.username,  # type: ignore[attr-defined]
        smtp_host=account.smtp_host,  # type: ignore[attr-defined]
        smtp_port=account.smtp_port,  # type: ignore[attr-defined]
        smtp_use_tls=account.smtp_use_tls,  # type: ignore[attr-defined]
        sent_folder=account.sent_folder,  # type: ignore[attr-defined]
        inbox_folder=account.inbox_folder,  # type: ignore[attr-defined]
        enabled=account.enabled,  # type: ignore[attr-defined]
        sync_interval_minutes=account.sync_interval_minutes,  # type: ignore[attr-defined]
        last_synced_at=account.last_synced_at,  # type: ignore[attr-defined]
        last_sync_count=account.last_sync_count,  # type: ignore[attr-defined]
        last_sync_error=account.last_sync_error,  # type: ignore[attr-defined]
        linked_employee_id=account.linked_employee_id,  # type: ignore[attr-defined]
        owner_user_id=account.owner_user_id,  # type: ignore[attr-defined]
        has_password=bool(account.password_encrypted),  # type: ignore[attr-defined]
    )


@router.get("/account", response_model=EmailAccountRead | None)
def get_account(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> EmailAccountRead | None:
    row = email_service.get_account(db, owner_user_id=current_user.id)
    return _to_read(row) if row is not None else None


@router.put("/account", response_model=EmailAccountRead)
def upsert_account(
    payload: EmailAccountUpsert,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("email.manage"))],
) -> EmailAccountRead:
    try:
        row = email_service.upsert_account(db, payload, owner_user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    # Pick up sync_interval_minutes / enabled changes immediately.
    scheduler_service.reschedule_email_sync()
    return _to_read(row)


@router.delete("/account")
def delete_account(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("email.manage"))],
) -> Response:
    email_service.delete_account(db, owner_user_id=current_user.id)
    scheduler_service.reschedule_email_sync()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/test")
def test_connection(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("email.manage"))],
) -> Response:
    account = email_service.get_account(db, owner_user_id=current_user.id)
    if account is None:
        raise HTTPException(status_code=404, detail="no email account configured")
    try:
        email_service.test_connection(account)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"connection failed: {e!s}") from e
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sync", response_model=EmailSyncResult)
def sync_now(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("email.manage"))],
) -> EmailSyncResult:
    try:
        return email_service.sync_now(db, owner_user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except email_service.SyncInProgressError as e:
        raise HTTPException(status_code=409, detail="sync already running") from e
    except Exception as e:
        log.exception("email sync failed")
        raise HTTPException(status_code=500, detail="sync failed") from e


@router.get("/sync/status", response_model=EmailSyncStatus)
def sync_status(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> EmailSyncStatus:
    """Read-only — any signed-in user can see their own mailbox's sync state."""
    return email_service.get_sync_status(db, owner_user_id=current_user.id)


@router.post("/send", response_model=EmailSendResult)
async def send_email(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.send"))],
    to: Annotated[str, Form()],
    subject: Annotated[str, Form()],
    html: Annotated[str, Form()],
    cc: Annotated[str, Form()] = "",
    in_reply_to: Annotated[str | None, Form()] = None,
    references: Annotated[str | None, Form()] = None,
    use_signature: Annotated[bool, Form()] = True,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> EmailSendResult:
    """Multipart endpoint. ``to`` / ``cc`` are comma-separated lists of
    addresses; ``files`` carries optional attachments."""
    to_list = [s.strip() for s in to.split(",") if s.strip()]
    cc_list = [s.strip() for s in cc.split(",") if s.strip()]
    payload = EmailSendRequest(
        to=to_list,
        cc=cc_list,
        subject=subject,
        html=html,
        in_reply_to=in_reply_to,
        references=references,
        use_signature=use_signature,
    )
    attachments: list[tuple[str, bytes]] = []
    if files:
        for up in files:
            data = await up.read()
            if data:
                attachments.append((up.filename or "attachment", data))
    try:
        return email_service.send_email(db, payload, owner_user_id=current_user.id, attachments=attachments)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"send failed: {e!s}") from e
