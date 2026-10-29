"""Channel-agnostic employee notification routes (WhatsApp-first, SMS fallback).

  POST /notify/send                    — send a notification for a record
  GET  /notify/status                  — most recent attempt for a record
  POST /notify/{msg_id}/refresh-delivery — re-check delivery for one message

send/status require ``employees.notify``; refresh requires ``books.edit``.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.action_guards import require_template_action
from app.api.deps import get_current_user, require_capability
from app.config import get_settings
from app.db.models import User
from app.db.session import get_db
from app.schemas.notify import (
    MessageRenderRead,
    MessageTemplateRead,
    MessageTextWrite,
    NotifyMessageRead,
    NotifyPreviewRead,
    NotifyPreviewRequest,
    NotifySendRequest,
    NotifySendResponse,
    NotifyStatusItem,
    NotifyStatusResponse,
)
from app.services import (
    book_service,
    document_service,
    message_template_service,
    notify_dispatch,
    sms_templates,
)

router = APIRouter(prefix="/notify", tags=["notify"])


@router.post("/send", response_model=NotifySendResponse)
def send(
    payload: NotifySendRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("employees.notify"))],
) -> NotifySendResponse:
    try:
        row = notify_dispatch.send_for_event(
            db, payload.event_type, payload.record_id, sent_by=user.id
        )
    except notify_dispatch.NotifyDisabledError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    except notify_dispatch.RecordNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    return NotifySendResponse(
        status=row.status,
        channel=row.channel,
        fell_back=row.fell_back,
        fallback_reason=row.fallback_reason,
        message_id=row.provider_msg_id,
        error=row.error,
    )


@router.get("/status", response_model=NotifyStatusResponse)
def get_status(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.notify"))],
    event_type: str = Query(...),
    record_id: int = Query(...),
) -> NotifyStatusResponse:
    cfg = get_settings()
    row = notify_dispatch.last_status(db, event_type, record_id)
    return NotifyStatusResponse(
        enabled=bool(cfg.openwa_enabled or cfg.sms_enabled),
        last=NotifyStatusItem.model_validate(row) if row else None,
    )


@router.post("/{msg_id}/refresh-delivery", response_model=NotifyMessageRead)
def refresh_delivery(
    msg_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.edit"))],
) -> NotifyMessageRead:
    row = notify_dispatch.refresh_delivery(db, msg_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    return NotifyMessageRead.model_validate(row)


@router.get("/templates", response_model=list[MessageTemplateRead])
def templates(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[dict[str, Any]]:
    from app.services import perm_service
    from app.services.action_guard_service import template_decision

    caps = perm_service.effective_caps(db, user)
    return [
        message_template_service.read_template(db, event)
        for event in sms_templates.EVENTS
        if template_decision(caps, "notification_template", "view", event).allowed
    ]


@router.get("/templates/{event}", response_model=MessageTemplateRead)
def read_template(
    event: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_template_action("notification_template", "read"))],
) -> dict[str, Any]:
    return message_template_service.read_template(db, event)


@router.put("/templates/{event}", response_model=MessageTemplateRead)
def update_template(
    event: str,
    payload: MessageTextWrite,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_template_action("notification_template", "edit"))],
) -> dict[str, Any]:
    return message_template_service.save_template(
        db, event, payload, actor=user.employee_id or user.email
    )


@router.delete("/templates/{event}", response_model=MessageTemplateRead)
def reset_template(
    event: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_template_action("notification_template", "reset"))],
) -> dict[str, Any]:
    return message_template_service.save_template(
        db, event, None, actor=user.employee_id or user.email
    )


@router.post("/templates/{event}/render", response_model=MessageRenderRead)
def render_template(
    event: str,
    payload: MessageTextWrite,
    _user: Annotated[User, Depends(require_template_action("notification_template", "view"))],
) -> dict[str, Any]:
    return message_template_service.render_sample(event, payload)


@router.post("/preview", response_model=NotifyPreviewRead)
def preview(
    payload: NotifyPreviewRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict[str, Any]:
    if payload.employee_id is not None:
        require_capability("documents.generate")(user=user, db=db)
        require_capability("books.view")(user=user, db=db)
        book_service.require_record_type_access(
            db,
            user,
            category_id=document_service.record_category_for_template(payload.template_id),
            service_id=document_service.effective_document_service(payload.template_id),
        )
    if payload.revise_of_book_id is not None:
        from app.db.models import Book

        revise_book = db.get(Book, payload.revise_of_book_id)
        if revise_book is not None and revise_book.deleted_at is not None:
            revise_book = None
        from app.services.action_guard_service import book_revise_decision

        book_revise_decision(db, user, revise_book).require()
    return message_template_service.preview(db, payload, user=user)


__all__ = ["router"]
