"""Live record references, derivation, and confidentiality floors."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, cast

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.errors import AppError, NotFoundError
from app.core.subject import _PREFIX_RE
from app.db.models import AuditLog, Book, BookEditSession, BookLink, BookRecipient, User
from app.schemas.book import BookConfidentiality, BookDeriveRequest, BookThreadItem
from app.services import book_service, document_service, perm_service, word_book_service


def require_level_floor(
    db: Session,
    book: Book | None,
    level: str,
    *,
    target: Book | None = None,
    kind: str = "reference",
    attached: bool = True,
) -> None:
    """Check outgoing links, plus a proposed link before it is persisted."""
    links = (
        list(
            db.execute(
                select(BookLink.kind, BookLink.attached, Book.confidentiality)
                .join(Book, Book.id == BookLink.target_book_id)
                .where(BookLink.book_id == book.id)
            )
        )
        if book is not None
        else []
    )
    if target is not None:
        links.append((kind, attached, target.confidentiality))
    minimum = None
    if any(is_attached and target_level == "secret" for _, is_attached, target_level in links):
        if level != "secret":
            minimum = "secret"
    elif level == "general" and any(
        link_kind in ("reply", "based_on") and target_level != "general"
        for link_kind, _, target_level in links
    ):
        minimum = "directed"
    if minimum:
        raise AppError(
            "LEVEL_BELOW_FLOOR",
            "The level cannot be lower than the linked records require.",
            http_status=422,
            details={"min": minimum},
        )


def addressee_user_id(db: Session, original: Book, caller_id: int | None) -> int | None:
    sender_id = (
        db.scalar(
            select(BookRecipient.sent_by_user_id)
            .where(
                BookRecipient.book_id == original.id,
                BookRecipient.user_id == caller_id,
                BookRecipient.revoked_at.is_(None),
            )
            .order_by(BookRecipient.created_at.desc(), BookRecipient.id.desc())
            .limit(1)
        )
        if caller_id is not None
        else None
    )
    return sender_id if sender_id is not None else original.created_by_user_id


def _item(
    db: Session,
    link: BookLink,
    linked: Book,
    *,
    outgoing: bool,
    can_write: bool,
    owner: Book,
) -> BookThreadItem:
    version = max(linked.versions, key=lambda v: v.version_no, default=None)
    return BookThreadItem(
        book_id=linked.id,
        ref_number=linked.ref_number,
        subject=linked.subject,
        confidentiality=cast(BookConfidentiality, linked.confidentiality),
        created_at=linked.created_at,
        approval_state=linked.approval_state,
        direction="outgoing" if outgoing else "incoming",
        kind=cast(Literal["reply", "based_on", "reference"], link.kind),
        attached=link.attached,
        can_unlink=outgoing and link.attached and can_write,
        addressee_user_id=(
            addressee_user_id(db, linked, owner.created_by_user_id)
            if outgoing and link.kind == "reply"
            else None
        ),
        current_document_id=version.document_id if version is not None else None,
    )


def thread(db: Session, user: User, book: Book) -> list[BookThreadItem]:
    book_service.require_full_book_access(db, user, book)
    try:
        book_service.require_full_book_access(db, user, book, write=True)
        can_write = perm_service.has_capability(db, user, "books.edit")
    except AppError:
        can_write = False
    items = []
    for link in db.scalars(
        select(BookLink).where(or_(BookLink.book_id == book.id, BookLink.target_book_id == book.id))
    ):
        outgoing = link.book_id == book.id
        linked = db.get(Book, link.target_book_id if outgoing else link.book_id)
        if linked is None or linked.deleted_at is not None:
            continue
        try:
            book_service.require_full_book_access(db, user, linked)
        except AppError:
            continue
        items.append(_item(db, link, linked, outgoing=outgoing, can_write=can_write, owner=book))
    return sorted(items, key=lambda item: (item.created_at, item.book_id))


def link(db: Session, user: User, book: Book, target_id: int) -> BookThreadItem:
    book_service.require_full_book_access(db, user, book, write=True)
    target = book_service.get_book(db, target_id)
    book_service.require_full_book_access(db, user, target)
    if target.id == book.id:
        raise AppError("LINK_SELF", "A record cannot reference itself.", http_status=422)
    existing = db.scalar(
        select(BookLink).where(BookLink.book_id == book.id, BookLink.target_book_id == target.id)
    )
    if existing is not None and (existing.kind == "reference" or existing.attached):
        raise AppError("LINK_EXISTS", "The reference already exists.", http_status=409)
    require_level_floor(db, book, book.confidentiality, target=target)
    if existing is None:
        existing = BookLink(
            book_id=book.id,
            target_book_id=target.id,
            kind="reference",
            attached=True,
            created_by_user_id=user.id,
        )
        db.add(existing)
    else:
        existing.attached = True
    db.commit()
    return _item(db, existing, target, outgoing=True, can_write=True, owner=book)


def unlink(db: Session, user: User, book: Book, target_id: int) -> None:
    book_service.require_full_book_access(db, user, book, write=True)
    target = db.get(Book, target_id)
    if target is None or target.deleted_at is not None:
        raise NotFoundError("LINK_NOT_FOUND", "Reference not found")
    try:
        book_service.require_full_book_access(db, user, target)
    except AppError:
        raise NotFoundError("LINK_NOT_FOUND", "Reference not found") from None
    row = db.scalar(
        select(BookLink).where(BookLink.book_id == book.id, BookLink.target_book_id == target_id)
    )
    if row is None:
        raise NotFoundError("LINK_NOT_FOUND", "Reference not found")
    if row.kind == "reference":
        db.delete(row)
    else:
        row.attached = False
    db.commit()


def derive(
    db: Session, user: User, original: Book, payload: BookDeriveRequest
) -> word_book_service.WordSessionInfo:
    level = payload.confidentiality or cast(BookConfidentiality, original.confidentiality)
    require_level_floor(
        db, None, level, target=original, kind=payload.kind, attached=payload.attach_reference
    )
    recipient_id = addressee_user_id(db, original, user.id)
    recipient_name = ""
    if recipient_id is not None:
        recipient_name = (
            book_service.resolve_names_ar_by_ids(db, {recipient_id}).get(recipient_id)
            or book_service.resolve_user_name_by_id(db, recipient_id)
            or ""
        )
    version = max(original.versions, key=lambda v: v.version_no, default=None)
    fields = version.fields if version is not None else {}
    fields = fields or {}
    is_general_book = (
        version.template_id == "General Book"
        if version is not None
        else original.category_id == "GS"
        and original.classification_code is not None
        and not original.ref_number.startswith("REPORT-")
    )
    source_docx = None
    session = None
    if is_general_book:
        session = db.scalar(
            select(BookEditSession).where(
                BookEditSession.book_id == original.id,
                BookEditSession.state == "active",
            )
        )
        if session is not None and Path(session.working_path).is_file():
            source_docx = Path(session.working_path)
        elif version is not None:
            source_docx = document_service._authored_docx_of(db, version)
    body_html = (
        str(fields.get("body") or "") if payload.kind == "based_on" and is_general_book else ""
    )
    date = fields.get("date")
    if source_docx is not None and not date:
        from docx import Document as WordDocument
        from docx.oxml.ns import qn

        doc = WordDocument(source_docx)
        for section in doc.sections:
            for header in (section.first_page_header, section.header):
                for paragraph in header._element.iter(qn("w:p")):
                    text = "".join(t.text or "" for t in paragraph.iter(qn("w:t"))).strip()
                    if text.startswith("التاريخ:"):
                        date = text.split(":", 1)[1].strip()
    if isinstance(date, str):
        for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
            try:
                date = datetime.strptime(date, fmt)
                break
            except ValueError:
                continue
    if not isinstance(date, datetime):
        date = original.created_at.replace(tzinfo=UTC).astimezone().replace(tzinfo=None)
    subject = original.subject or ""
    if payload.kind == "reply":
        while _PREFIX_RE.match(subject):
            subject = _PREFIX_RE.sub("", subject, count=1)
        subject = "رد: " + subject
    info = word_book_service.create_word_book(
        db,
        user=user,
        classification_code=(
            payload.classification_code
            if payload.classification_code is not None
            else original.classification_code
        ),
        recipient_id=None,
        recipient_name=recipient_name,
        subject=subject,
        cc=[],
        manager_id=None,
        confidentiality=level,
        body_html=body_html,
        body_docx=(
            source_docx
            if payload.kind == "based_on" and (not body_html or session is not None)
            else None
        ),
        reference_line=f"المرجع: {original.ref_number} في {date:%d-%m-%Y}",
        commit=False,
    )
    db.add(
        BookLink(
            book_id=info.book_id,
            target_book_id=original.id,
            kind=payload.kind,
            attached=payload.attach_reference,
            created_by_user_id=user.id,
        )
    )
    db.add(
        AuditLog(
            actor=user.employee_id,
            action="book_derived",
            entity_type="book",
            entity_id=str(info.book_id),
            payload=json.dumps(
                {
                    "original_book_id": original.id,
                    "kind": payload.kind,
                    "attached": payload.attach_reference,
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return info
