"""Announcements API — list WhatsApp groups + multipart fan-out send."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.announcement import AnnouncementOut, GroupOut, GroupSendOut
from app.services import announce_service

router = APIRouter(prefix="/announcements", tags=["announcements"])


@router.get("/groups", response_model=list[GroupOut])
def list_groups(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("messages.broadcast"))],
) -> list[GroupOut]:
    """Return the WhatsApp groups the connected number belongs to."""
    return [GroupOut(id=g.id, name=g.name) for g in announce_service.groups_available(db)]


@router.post("/send", response_model=AnnouncementOut)
async def send_announcement(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("messages.broadcast"))],
    group_ids: Annotated[list[str], Form()],
    text: Annotated[str, Form()] = "",
    book_id: Annotated[int | None, Form()] = None,
    file: Annotated[UploadFile | None, File()] = None,
) -> AnnouncementOut:
    """Fan-out a text message (with optional attachment) to the given groups."""
    # Resolve attachment.
    attachment: announce_service.Attachment | None = None
    if file is not None:
        attachment = announce_service.Attachment(
            filename=file.filename or "file",
            data=await file.read(),
        )
    elif book_id is not None:
        try:
            filename, data = announce_service.resolve_book_pdf(db, book_id)
        except announce_service.BookPdfError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        attachment = announce_service.Attachment(filename=filename, data=data)

    # Require text or attachment.
    if not text.strip() and attachment is None:
        raise HTTPException(status_code=422, detail="text or attachment required")

    # Resolve matching groups (keyed by id so the log gets real names).
    available = announce_service.groups_available(db)
    target_ids = set(group_ids)
    groups = [(g.id, g.name) for g in available if g.id in target_ids]
    if not groups:
        raise HTTPException(status_code=422, detail="no matching groups found")

    result = announce_service.send_announcement(
        db,
        groups=groups,
        text=text,
        attachment=attachment,
        book_id=(book_id if file is None else None),
        sent_by=user.id,
    )

    return AnnouncementOut(
        announcement_id=result.announcement_id,
        sent=result.sent,
        failed=result.failed,
        results=[
            GroupSendOut(
                group_id=r.group_id,
                group_name=r.group_name,
                ok=r.ok,
                error=r.error,
            )
            for r in result.results
        ],
    )
