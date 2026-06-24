"""Ledger endpoints — Phase 07.

All routes are prefixed ``/ledger`` and wired into ``main.py`` under ``/api/v1``.

Endpoints:
  GET    /ledger                — filtered + paginated list
  GET    /ledger/counterparties — autocomplete helper
  GET    /ledger/{entry_id}     — single entry (full)
  POST   /ledger                — create
  PATCH  /ledger/{entry_id}     — partial update
  DELETE /ledger/{entry_id}     — soft-delete (204)
  POST   /ledger/{entry_id}/attachments — multipart file upload
"""

from __future__ import annotations

import base64
import io
import mimetypes
import re
import zipfile
from datetime import date
from email.utils import parseaddr
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.api.errors import AppError
from app.config import get_settings
from app.db.models import LedgerEntry, User
from app.db.session import get_db
from app.schemas.contacts import AddressBookContactCreate, AddressBookContactRead
from app.schemas.correspondence import CorrespondenceLogItem, CorrespondenceLogRecord
from app.schemas.ledger import (
    DraftWrite,
    LedgerAttachmentMeta,
    LedgerEntryCreate,
    LedgerEntryRead,
    LedgerEntryUpdate,
    LedgerListItem,
    LedgerListResponse,
)
from app.schemas.recipient_lists import (
    RecipientListCreate,
    RecipientListRead,
    RecipientListUpdate,
)
from app.schemas.search import SearchResponse
from app.schemas.vault_file import VaultFileRead
from app.services import (
    contacts_service,
    correspondence_service,
    ledger_service,
    recipient_lists_service,
    search_service,
    vault_service,
)
from app.services.ledger_service import LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT
from app.services.mail_scope import resolve_mail_scope

router = APIRouter(prefix="/ledger", tags=["ledger"])


# ---------------------------------------------------------------------------
# List + autocomplete
# ---------------------------------------------------------------------------


@router.get("", response_model=LedgerListResponse)
def list_entries(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
    from_date: date | None = None,
    to_date: date | None = None,
    since: date | None = None,
    direction: str | None = None,
    channel: str | None = None,
    counterparty: str | None = None,
    q: str | None = None,
    tag: str | None = None,
    related_employee_id: str | None = None,
    related_book_id: int | None = None,
    has_attachment: bool | None = None,
    include_deleted: bool = False,
    include_drafts: bool = False,
    scope: str = Query("mine", description="mine (default) | all (admin only)"),
    limit: int = Query(LIST_DEFAULT_LIMIT, ge=1, le=LIST_MAX_LIMIT),
    offset: int = Query(0, ge=0),
) -> LedgerListResponse:
    rows, total = ledger_service.list_entries(
        db,
        from_date=from_date,
        to_date=to_date,
        since=since,
        direction=direction,
        channel=channel,
        counterparty=counterparty,
        q=q,
        tag=tag,
        related_employee_id=related_employee_id,
        related_book_id=related_book_id,
        has_attachment=has_attachment,
        include_deleted=include_deleted,
        include_drafts=include_drafts,
        owner_user_id=resolve_mail_scope(current_user, scope),
        limit=limit,
        offset=offset,
    )
    return LedgerListResponse(
        items=[
            LedgerListItem.model_validate(r).model_copy(
                update={
                    "attachment_count": len(r.attachment_paths or []),
                    "snippet": _html_to_preview(r.notes_html),
                }
            )
            for r in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/counterparties", response_model=list[str])
def list_counterparties(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("ledger.view"))],
    q: str | None = None,
    limit: int = Query(20, ge=1, le=100),
) -> list[str]:
    return ledger_service.list_counterparties(db, q=q, limit=limit)


@router.get("/contacts", response_model=list[AddressBookContactRead])
def list_contacts(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
    q: str | None = None,
    limit: int = Query(20, ge=1, le=100),
) -> list[AddressBookContactRead]:
    rows = contacts_service.list_contacts(
        db, owner_user_id=current_user.id, q=q, limit=limit
    )
    return [AddressBookContactRead.model_validate(r) for r in rows]


@router.post(
    "/contacts",
    response_model=AddressBookContactRead,
    status_code=status.HTTP_201_CREATED,
)
def save_contact(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.edit"))],
    payload: AddressBookContactCreate,
) -> AddressBookContactRead:
    row = contacts_service.save_contact(
        db,
        owner_user_id=current_user.id,
        display_name=payload.display_name,
        address=payload.address,
    )
    return AddressBookContactRead.model_validate(row)


@router.delete("/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.edit"))],
    contact_id: int,
) -> Response:
    contacts_service.delete_contact(
        db, owner_user_id=current_user.id, contact_id=contact_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Recipient (distribution) lists — per-user, owner from session
# ---------------------------------------------------------------------------


@router.get("/recipient-lists", response_model=list[RecipientListRead])
def list_recipient_lists(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
) -> list[RecipientListRead]:
    rows = recipient_lists_service.list_lists(db, owner_user_id=current_user.id)
    return [RecipientListRead.model_validate(r) for r in rows]


@router.post(
    "/recipient-lists",
    response_model=RecipientListRead,
    status_code=status.HTTP_201_CREATED,
)
def create_recipient_list(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.edit"))],
    payload: RecipientListCreate,
) -> RecipientListRead:
    row = recipient_lists_service.create_list(
        db, owner_user_id=current_user.id, payload=payload
    )
    return RecipientListRead.model_validate(row)


@router.patch("/recipient-lists/{list_id}", response_model=RecipientListRead)
def update_recipient_list(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.edit"))],
    list_id: int,
    payload: RecipientListUpdate,
) -> RecipientListRead:
    row = recipient_lists_service.update_list(
        db, owner_user_id=current_user.id, list_id=list_id, payload=payload
    )
    return RecipientListRead.model_validate(row)


@router.delete(
    "/recipient-lists/{list_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_recipient_list(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.edit"))],
    list_id: int,
) -> Response:
    recipient_lists_service.delete_list(
        db, owner_user_id=current_user.id, list_id=list_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/search", response_model=SearchResponse)
def search_entries(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
    q: str = Query(..., description="Free-text search query"),
    limit: int = Query(50, ge=1, le=200),
    scope: str = Query("mine", description="mine (default) | all (admin only)"),
) -> SearchResponse:
    if not q or not q.strip():
        raise HTTPException(status_code=400, detail="q must not be empty")
    hits = search_service.search(db, q, limit=limit, owner_user_id=resolve_mail_scope(current_user, scope))
    return SearchResponse(hits=hits, total=len(hits))


# ---------------------------------------------------------------------------
# Correspondence Log (shared auto-log rows — Phase 3)
# ---------------------------------------------------------------------------


class CorrespondenceLogResponse(BaseModel):
    items: list[CorrespondenceLogItem]
    total: int


@router.get("/log", response_model=CorrespondenceLogResponse)
def list_correspondence_log(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
    category_id: int | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> CorrespondenceLogResponse:
    rows = correspondence_service.list_log(
        db, category_id=category_id, limit=limit, offset=offset
    )
    items = [CorrespondenceLogItem.model_validate(r) for r in rows]
    return CorrespondenceLogResponse(items=items, total=len(items))


@router.get("/log/{entry_id}", response_model=CorrespondenceLogRecord)
def get_correspondence_log_record(
    entry_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
) -> CorrespondenceLogRecord:
    row = correspondence_service.get_log_record(db, entry_id)
    extras = correspondence_service.resolve_record_extras(db, row)
    return CorrespondenceLogRecord.model_validate(row).model_copy(update=extras)


# ---------------------------------------------------------------------------
# Read state (drives the numeric NavBell badge)
# ---------------------------------------------------------------------------


class UnreadCountResponse(BaseModel):
    count: int


class MarkAllReadResponse(BaseModel):
    updated: int


@router.get("/unread-count", response_model=UnreadCountResponse)
def get_unread_count(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
    scope: str = Query("mine", description="mine (default) | all (admin only)"),
) -> UnreadCountResponse:
    """Number of un-opened incoming email entries — drives the NavBell badge.

    Private inbox (Phase 6): counts the caller's own unread by default;
    admins may widen with scope=all to see the whole-office count.
    """
    return UnreadCountResponse(
        count=ledger_service.unread_email_count(db, owner_user_id=resolve_mail_scope(current_user, scope))
    )


class UnreadRecentItem(BaseModel):
    id: int
    subject: str
    counterparty: str
    counterparty_name: str | None
    entry_date: date
    preview: str
    attachment_count: int


class UnreadRecentResponse(BaseModel):
    items: list[UnreadRecentItem]
    total_unread: int


_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")
# Outlook/MS-Office round-trip HTML embeds <style>, <script>, and conditional
# comments full of CSS/VML rules. Stripping tags alone leaves the rule bodies
# behind ("v\:* { behavior:url(#default#VML); }"), so we drop the whole block.
_HTML_BLOCKDROP_RE = re.compile(
    r"<(style|script)\b[^>]*>.*?</\1>|<!--.*?-->",
    re.IGNORECASE | re.DOTALL,
)
_HTML_ENTITIES = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&zwj;": "",
    "&zwnj;": "",
}
_PREVIEW_LIMIT = 120


def _html_to_preview(html: str | None) -> str:
    if not html:
        return ""
    # 1. Drop <style>/<script>/<!-- ... --> blocks entirely.
    text = _HTML_BLOCKDROP_RE.sub(" ", html)
    # 2. Strip remaining tags.
    text = _HTML_TAG_RE.sub(" ", text)
    # 3. Decode the most common entities.
    for entity, replacement in _HTML_ENTITIES.items():
        text = text.replace(entity, replacement)
    # 4. Collapse whitespace + truncate.
    text = _WHITESPACE_RE.sub(" ", text).strip()
    if len(text) > _PREVIEW_LIMIT:
        text = text[: _PREVIEW_LIMIT - 1].rstrip() + "…"
    return text


def _split_address(raw: str) -> tuple[str, str | None]:
    """Return ``(bare_email, display_name_or_None)`` for the sender field.

    Counterparties can be either a bare address or already ``Name <addr>``.
    ``parseaddr`` handles both shapes; an unparseable value falls back to the
    raw string with no display name.
    """
    if not raw:
        return ("", None)
    name, addr = parseaddr(raw)
    bare = addr.strip() or raw.strip()
    display = name.strip() or None
    return (bare, display)


@router.get("/unread-recent", response_model=UnreadRecentResponse)
def get_unread_recent(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
    limit: int = Query(5, ge=1, le=20),
    scope: str = Query("mine", description="mine (default) | all (admin only)"),
) -> UnreadRecentResponse:
    """Preview list of latest unread incoming emails for the NavBell popover.

    Private inbox (Phase 6): scoped to the caller; admins may widen with
    scope=all. (The NavBell itself never passes scope=all — own-scope only.)
    """
    owner = resolve_mail_scope(current_user, scope)
    total_unread = ledger_service.unread_email_count(db, owner_user_id=owner)
    stmt = (
        select(LedgerEntry)
        .where(
            LedgerEntry.channel == "email",
            # Received mail = incoming + internal (intra-office); mirrors the
            # Inbox and unread_email_count. Sent mail is born read.
            LedgerEntry.direction.in_(("incoming", "internal")),
            LedgerEntry.read_at.is_(None),
            LedgerEntry.deleted_at.is_(None),
        )
        .order_by(LedgerEntry.entry_date.desc(), LedgerEntry.id.desc())
        .limit(limit)
    )
    if owner is not None:
        stmt = stmt.where(LedgerEntry.owner_user_id == owner)
    rows = list(db.execute(stmt).scalars())
    items: list[UnreadRecentItem] = []
    for row in rows:
        bare, display = _split_address(row.counterparty or "")
        items.append(
            UnreadRecentItem(
                id=row.id,
                subject=row.subject or "",
                counterparty=bare,
                counterparty_name=display,
                entry_date=row.entry_date,
                preview=_html_to_preview(row.notes_html),
                attachment_count=len(row.attachment_paths or []),
            )
        )
    return UnreadRecentResponse(items=items, total_unread=total_unread)


@router.post("/mark-all-read", response_model=MarkAllReadResponse)
def mark_all_read(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
) -> MarkAllReadResponse:
    """Bulk-mark the caller's own unread incoming email as read.

    Intentionally ignores any ``scope`` query param — mark-all-read is always
    own-scope only.  An admin calling with ``?scope=all`` must not wipe the
    whole office's unread state.
    """
    return MarkAllReadResponse(
        updated=ledger_service.mark_all_emails_read(db, owner_user_id=current_user.id)
    )


@router.post("/entries/{entry_id}/mark-read", response_model=LedgerEntryRead)
def mark_read(
    entry_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
    scope: str = Query("mine", description="mine (default) | all (admin only)"),
) -> LedgerEntryRead:
    """Set ``read_at=utcnow()`` if currently NULL. Idempotent."""
    row = ledger_service.mark_entry_read(db, entry_id, owner_user_id=resolve_mail_scope(current_user, scope))
    return LedgerEntryRead.model_validate(row)


# ---------------------------------------------------------------------------
# Drafts — Phase 16
# ---------------------------------------------------------------------------


@router.get("/drafts", response_model=list[LedgerEntryRead])
def list_drafts(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
    limit: int = Query(LIST_DEFAULT_LIMIT, ge=1, le=LIST_MAX_LIMIT),
    offset: int = Query(0, ge=0),
) -> list[LedgerEntryRead]:
    rows, _ = ledger_service.list_entries(
        db,
        tag=ledger_service.DRAFT_TAG,
        include_drafts=True,
        limit=limit,
        offset=offset,
        owner_user_id=current_user.id,
    )
    return [LedgerEntryRead.model_validate(r) for r in rows]


@router.post(
    "/drafts",
    response_model=LedgerEntryRead,
    status_code=status.HTTP_201_CREATED,
)
def create_draft(
    payload: DraftWrite,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.edit"))],
) -> LedgerEntryRead:
    row = ledger_service.upsert_draft(db, None, payload, author_employee_id=current_user.employee_id, owner_user_id=current_user.id)
    return LedgerEntryRead.model_validate(row)


@router.patch("/drafts/{draft_id}", response_model=LedgerEntryRead)
def update_draft(
    draft_id: int,
    payload: DraftWrite,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.edit"))],
) -> LedgerEntryRead:
    # owner_user_id guard: cross-owner draft is a 404 (don't leak existence).
    existing = ledger_service.get_entry(db, draft_id, owner_user_id=current_user.id)
    # Secondary created_by guard: if the draft has a known author and the caller
    # is a different (linked) employee, deny. Unlinked callers (employee_id=None)
    # are allowed through — they can't be matched, so we don't 403.
    if (
        existing.created_by is not None
        and current_user.employee_id is not None
        and existing.created_by != current_user.employee_id
    ):
        raise AppError(
            "DRAFT_NOT_OWNER",
            "You can only edit your own drafts",
            http_status=403,
        )
    row = ledger_service.upsert_draft(db, draft_id, payload)
    return LedgerEntryRead.model_validate(row)


@router.delete("/drafts/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(
    draft_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.edit"))],
) -> Response:
    # owner_user_id guard: cross-owner draft is a 404 (don't leak existence).
    existing = ledger_service.get_entry(db, draft_id, owner_user_id=current_user.id)
    # Secondary created_by guard — see update_draft. Unlinked callers (employee_id=None)
    # can't be matched, so they're allowed through.
    if (
        existing.created_by is not None
        and current_user.employee_id is not None
        and existing.created_by != current_user.employee_id
    ):
        raise AppError(
            "DRAFT_NOT_OWNER",
            "You can only delete your own drafts",
            http_status=403,
        )
    ledger_service.delete_draft(db, draft_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/drafts/{draft_id}/send", response_model=LedgerEntryRead)
def send_draft(
    draft_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.send"))],
) -> LedgerEntryRead:
    # owner_user_id guard: cross-owner draft is a 404 (don't leak existence).
    existing = ledger_service.get_entry(db, draft_id, owner_user_id=current_user.id)
    # Secondary created_by guard — see update_draft. Unlinked callers (employee_id=None)
    # can't be matched, so they're allowed through.
    if (
        existing.created_by is not None
        and current_user.employee_id is not None
        and existing.created_by != current_user.employee_id
    ):
        raise AppError(
            "DRAFT_NOT_OWNER",
            "You can only send your own drafts",
            http_status=403,
        )
    row = ledger_service.promote_draft_to_sent(db, draft_id)
    return LedgerEntryRead.model_validate(row)


# ---------------------------------------------------------------------------
# Single entry
# ---------------------------------------------------------------------------


@router.get("/{entry_id}", response_model=LedgerEntryRead)
def get_entry(
    entry_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
    include_deleted: bool = False,
) -> LedgerEntryRead:
    row = ledger_service.get_entry(
        db, entry_id, include_deleted=include_deleted, owner_user_id=current_user.id
    )
    result = LedgerEntryRead.model_validate(row)

    # Inline/signature images (referenced by `cid:` in the body) are rendered
    # in the body, not listed as attachments — Outlook's behaviour. Derive the
    # cid->path map from the body so the frontend rewrites `src="cid:.."` even
    # for emails synced before `inline_images` was persisted; exclude those
    # paths from the attachment cards.
    inline_map = ledger_service.derive_inline_map(
        row.notes_html, row.attachment_paths or [], row.inline_images or {}
    )
    inline_paths = set(inline_map.values())

    # Resolve each real (non-inline) attachment's on-disk size so the detail
    # view can label cards with "248 KB". `index` is the position in
    # attachment_paths so the file can be addressed by index (Arabic/spaced
    # names never enter the URL). Missing files report size 0 rather than 404.
    # NOTE (#86): this stat()s every attachment per request (O(attachments)
    # syscalls). `attachment_paths` stores only relative-path strings with no
    # cached size, so eliminating the stat would need a schema/migration +
    # backfill — out of scope for a P4. Left as-is intentionally.
    attachments = [
        LedgerAttachmentMeta(
            index=i,
            name=rel.split("/")[-1],
            size=(abs_path.stat().st_size if (abs_path := ledger_service.resolve_attachment_path(rel)) else 0),
        )
        for i, rel in enumerate(row.attachment_paths or [])
        if rel not in inline_paths
    ]
    update: dict[str, object] = {
        "attachments": attachments,
        "inline_images": inline_map,
    }

    if row.created_by:
        from app.db.models import Employee

        emp = db.get(Employee, row.created_by)
        if emp is not None:
            update["created_by_name_en"] = emp.name_en
            update["created_by_name_ar"] = emp.name_ar

    return result.model_copy(update=update)


@router.get("/{entry_id}/thread", response_model=list[LedgerListItem])
def get_thread(
    entry_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
    limit: int = Query(50, ge=1, le=100),
    scope: str = Query("mine", description="mine (default) | all (admin only)"),
) -> list[LedgerListItem]:
    """Return other email entries that share the same conversation as ``entry_id``.

    Match key = (channel='email', same counterparty, normalised subject). The
    seed entry is excluded; returned oldest-first.
    """
    rows = ledger_service.list_thread(db, entry_id, limit=limit, owner_user_id=resolve_mail_scope(current_user, scope))
    return [
        LedgerListItem.model_validate(r).model_copy(
            update={"attachment_count": len(r.attachment_paths or [])}
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Create / update / delete
# ---------------------------------------------------------------------------


@router.post("", response_model=LedgerEntryRead, status_code=status.HTTP_201_CREATED)
def create_entry(
    payload: LedgerEntryCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.edit"))],
) -> LedgerEntryRead:
    row = ledger_service.create_entry(db, payload, owner_user_id=current_user.id)
    return LedgerEntryRead.model_validate(row)


@router.patch("/{entry_id}", response_model=LedgerEntryRead)
def update_entry(
    entry_id: int,
    payload: LedgerEntryUpdate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("ledger.edit"))],
) -> LedgerEntryRead:
    row = ledger_service.update_entry(db, entry_id, payload)
    return LedgerEntryRead.model_validate(row)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("ledger.edit"))],
) -> Response:
    ledger_service.soft_delete_entry(db, entry_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------


@router.post("/{entry_id}/attachments", response_model=LedgerEntryRead)
async def add_attachment(
    entry_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("ledger.edit"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> LedgerEntryRead:
    data = await upload.read()
    row = ledger_service.add_attachment(
        db,
        entry_id,
        data=data,
        original_filename=upload.filename or "upload",
    )
    return LedgerEntryRead.model_validate(row)


@router.post("/entries/{entry_id}/star", response_model=LedgerEntryRead)
def toggle_star(
    entry_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.edit"))],
) -> LedgerEntryRead:
    """Flip the ★ tag on an entry. Idempotent: a second call removes it."""
    row = ledger_service.toggle_star(db, entry_id, owner_user_id=current_user.id)
    return LedgerEntryRead.model_validate(row)


class SendToVaultRequest(BaseModel):
    employee_id: str = Field(min_length=1)
    kind: str = Field(min_length=1)


@router.post(
    "/entries/{entry_id}/attachments/{attachment_index}/send-to-vault",
    response_model=VaultFileRead,
    status_code=status.HTTP_201_CREATED,
)
def send_attachment_to_vault(
    entry_id: int,
    attachment_index: int,
    payload: SendToVaultRequest,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.edit"))],
) -> VaultFileRead:
    row = vault_service.import_from_ledger_attachment(
        db,
        entry_id=entry_id,
        attachment_index=attachment_index,
        employee_id=payload.employee_id,
        kind=payload.kind,
    )
    return VaultFileRead.model_validate(row)


@router.get("/entries/{entry_id}/attachments.zip")
def download_attachments_zip(
    entry_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("ledger.view"))],
) -> StreamingResponse:
    """Bundle every attachment for an entry into a single zip stream."""
    row = ledger_service.get_entry(db, entry_id)
    data_dir = get_settings().data_dir.resolve()

    # Skip inline/signature images — "save all attachments" excludes them.
    inline_map = ledger_service.derive_inline_map(
        row.notes_html, row.attachment_paths or [], row.inline_images or {}
    )
    real_paths = ledger_service.non_inline_attachments(
        row.attachment_paths or [], inline_map
    )

    buf = io.BytesIO()
    used_names: set[str] = set()
    written = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in real_paths:
            src = (data_dir / rel).resolve()
            # Containment guard: throws ValueError if src escapes data_dir.
            src.relative_to(data_dir)
            if not src.is_file():
                continue
            # De-dupe arcnames so same-basename attachments don't overwrite
            # each other inside the archive.
            base = Path(rel).name
            arcname = base
            counter = 1
            while arcname in used_names:
                stem = Path(base).stem
                suffix = Path(base).suffix
                arcname = f"{stem} ({counter}){suffix}"
                counter += 1
            used_names.add(arcname)
            zf.write(src, arcname=arcname)
            written += 1
    if written == 0:
        raise HTTPException(status_code=404, detail="no attachments to download")
    buf.seek(0)
    headers = {
        "Content-Disposition": f'attachment; filename="ledger-{entry_id}-attachments.zip"'
    }
    return StreamingResponse(buf, media_type="application/zip", headers=headers)


@router.get("/{entry_id}/attachments/by-index/{index}")
def download_attachment_by_index(
    entry_id: int,
    index: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("ledger.view"))],
    disposition: Annotated[str, Query(pattern="^(attachment|inline)$")] = "attachment",
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """Stream the ``index``-th attachment of an entry.

    Addressing by index keeps non-ASCII / spaced filenames out of the URL path
    (they 204 through some proxies). ``index`` is the position in
    ``attachment_paths``.

    ``encoding=base64`` returns the bytes base64-encoded as ``text/plain`` —
    the PDF preview uses this so the browser never sees a ``%PDF`` magic-byte
    body (Chrome's PDF stream handler otherwise claims it and the JS ``fetch``
    receives an empty 204). pdf.js decodes + renders the bytes itself.
    """
    row = ledger_service.get_entry(db, entry_id)
    paths = row.attachment_paths or []
    if index < 0 or index >= len(paths):
        raise HTTPException(status_code=404, detail="attachment not found")
    abs_path = ledger_service.resolve_attachment_path(paths[index])
    if abs_path is None:
        raise HTTPException(status_code=404, detail="attachment file missing")
    name = paths[index].rsplit("/", 1)[-1]

    if encoding == "base64":
        return Response(
            content=base64.b64encode(abs_path.read_bytes()),
            media_type="text/plain",
            headers={"X-Content-Type-Options": "nosniff"},
        )

    guessed = mimetypes.guess_type(name)[0] or "application/octet-stream"
    if guessed.startswith("image/"):
        return FileResponse(
            abs_path, filename=name, media_type=guessed,
            content_disposition_type=disposition,
        )
    return FileResponse(
        abs_path, filename=name, media_type="application/octet-stream",
        content_disposition_type=disposition,
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.get("/{entry_id}/attachments/{filename}")
def download_attachment(
    entry_id: int,
    filename: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("ledger.view"))],
    disposition: Annotated[str, Query(pattern="^(attachment|inline)$")] = "attachment",
) -> FileResponse:
    """Stream an attachment file back to the client.

    Validates that ``filename`` is one of the entry's recorded attachments
    so a caller can't drop "../../etc/passwd" and read arbitrary files.

    ``disposition=inline`` lets the browser render PDFs/images in place (the
    in-app preview); the default ``attachment`` forces a download.
    """
    row = ledger_service.get_entry(db, entry_id)
    # Match on the exact basename. Two attachments can share a basename under
    # different stored paths; a basename here can't disambiguate them, so when
    # the match is ambiguous we 404 and require the index-based route
    # (/attachments/by-index/{index}) — serving an arbitrary one risks the
    # wrong file.
    candidates = [
        p for p in (row.attachment_paths or []) if p.split("/")[-1] == filename
    ]
    if len(candidates) != 1:
        raise HTTPException(status_code=404, detail="attachment not found")
    matching = candidates[0]
    abs_path = ledger_service.resolve_attachment_path(matching)
    if abs_path is None:
        raise HTTPException(status_code=404, detail="attachment file missing")
    return FileResponse(
        abs_path, filename=filename, content_disposition_type=disposition
    )


__all__ = ["router"]
