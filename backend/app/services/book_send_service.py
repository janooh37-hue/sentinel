"""Record levels and direct send (send / forward / recall / inbox).

The access rule itself lives in ``book_service`` (``user_visibility_clause``
and ``resolve_book_read_access``); this module owns the recipient rows that
feed it and the level-change flow.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Literal, NamedTuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.errors import AppError, NotFoundError
from app.core.roles import ADMIN_ROLE, INMATE_REPORTER_ROLE, MANAGER_ROLE
from app.db.models import AuditLog, Book, BookEditSession, BookRecipient, Employee, User
from app.schemas.book import (
    BookInboxRead,
    BookRecipientRead,
    BookSendSkipped,
    InboxPurposeCounts,
    InboxSummaryRead,
)
from app.services import book_service, perm_service, word_book_service

log = logging.getLogger(__name__)

INBOX_SECTION_URL = "/books?inbox=received"


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _is_manager_or_admin(user: User) -> bool:
    return user.role in (ADMIN_ROLE, MANAGER_ROLE)


def _audit(db: Session, user: User, action: str, book: Book, payload: dict[str, object]) -> None:
    db.add(
        AuditLog(
            actor=user.employee_id,
            action=action,
            entity_type="book",
            entity_id=str(book.id),
            payload=json.dumps({"ref_number": book.ref_number, **payload}, ensure_ascii=False),
        )
    )


# ---------------------------------------------------------------------------
# Level
# ---------------------------------------------------------------------------


def can_change_confidentiality(user: User, book: Book) -> bool:
    """Creator, manager, or admin (the caller must also be able to open it)."""
    if user.role == INMATE_REPORTER_ROLE:
        return False
    return _is_manager_or_admin(user) or (
        book.created_by_user_id is not None and book.created_by_user_id == user.id
    )


def _change_level(db: Session, user: User, book: Book, level: str) -> None:
    """Stage a level change + its audit row (caller commits)."""
    old = book.confidentiality
    book.confidentiality = level
    _audit(db, user, "book_confidentiality_changed", book, {"old": old, "new": level})


def _discard_inaccessible_word_session(db: Session, book: Book) -> None:
    """Revoke an active editing token when its owner loses write access."""
    session = db.scalar(
        select(BookEditSession).where(
            BookEditSession.book_id == book.id, BookEditSession.state == "active"
        )
    )
    if session is None:
        return
    owner = db.get(User, session.user_id)
    if owner is None:
        return
    try:
        book_service.require_full_book_access(db, owner, book, write=True)
    except AppError:
        word_book_service.discard_word_session(db, user=owner, book_id=book.id)


def set_confidentiality(db: Session, user: User, book: Book, level: str) -> Book:
    book_service.require_full_book_access(db, user, book, write=True)
    if not can_change_confidentiality(user, book):
        raise AppError(
            "FORBIDDEN",
            "Only the creator, a manager, or an admin can change the level.",
            http_status=403,
        )
    book_service.require_confidentiality_clearance(db, user, level)
    if book.confidentiality != level:
        _change_level(db, user, book, level)
        db.flush()
        _discard_inaccessible_word_session(db, book)
        db.commit()
    return book


# ---------------------------------------------------------------------------
# Users (recipient picker + clearance list)
# ---------------------------------------------------------------------------


class DirectoryEntry(NamedTuple):
    user: User
    name: str
    name_ar: str | None
    g_number: str | None
    cleared: bool


def user_directory(db: Session, *, exclude_user_id: int | None = None) -> list[DirectoryEntry]:
    """Active users except inmate reporters, with their Secret clearance.

    # ponytail: one caps resolution per user (cached per instance); fine for
    # tens of accounts, batch the override query if users reach the thousands.
    """
    users = db.scalars(
        select(User)
        .where(User.status == "active", User.role != INMATE_REPORTER_ROLE)
        .order_by(User.id)
    ).all()
    emp_ids = {u.employee_id for u in users if u.employee_id}
    employees = (
        {e.id: e for e in db.scalars(select(Employee).where(Employee.id.in_(emp_ids)))}
        if emp_ids
        else {}
    )
    out: list[DirectoryEntry] = []
    for u in users:
        if u.id == exclude_user_id:
            continue
        emp = employees.get(u.employee_id) if u.employee_id else None
        out.append(
            DirectoryEntry(
                user=u,
                name=emp.name_en if emp is not None else (u.display_name or u.email),
                name_ar=emp.name_ar if emp is not None else None,
                g_number=u.employee_id or None,
                cleared=perm_service.has_capability(db, u, "books.secret"),
            )
        )
    return out


def recipient_candidates(db: Session, user: User, level: str | None) -> list[DirectoryEntry]:
    if user.role == INMATE_REPORTER_ROLE:
        raise AppError("FORBIDDEN", "Inmate reporters cannot send records.", http_status=403)
    entries = user_directory(db, exclude_user_id=user.id)
    if level == "secret":
        entries = [e for e in entries if e.cleared]
    return entries


# ---------------------------------------------------------------------------
# Send / recall
# ---------------------------------------------------------------------------


def _recipient_reads(db: Session, user: User, rows: list[BookRecipient]) -> list[BookRecipientRead]:
    names = book_service.resolve_names_by_ids(
        db, {r.user_id for r in rows} | {r.sent_by_user_id for r in rows}
    )
    return [
        BookRecipientRead(
            id=r.id,
            user_id=r.user_id,
            user_name=names.get(r.user_id),
            sent_by_user_id=r.sent_by_user_id,
            sent_by_name=names.get(r.sent_by_user_id),
            purpose=r.purpose,
            note=r.note,
            created_at=r.created_at,
            read_at=r.read_at,
            revoked_at=r.revoked_at,
            can_recall=r.revoked_at is None
            and (r.sent_by_user_id == user.id or _is_manager_or_admin(user)),
        )
        for r in rows
    ]


def send(
    db: Session,
    user: User,
    book: Book,
    *,
    user_ids: list[int],
    purpose: Literal["info", "action", "reply", "sign"],
    note: str | None,
    make_directed: bool,
) -> tuple[list[BookRecipientRead], list[BookSendSkipped]]:
    """Send (or forward) ``book`` to users. Anyone with full access may send."""
    if user.role == INMATE_REPORTER_ROLE:
        raise AppError("FORBIDDEN", "Inmate reporters cannot send records.", http_status=403)
    book_service.require_full_book_access(db, user, book)
    if book.confidentiality == "personal":
        if not make_directed:
            raise AppError(
                "PERSONAL_REQUIRES_DIRECTED",
                "A Personal record must become Directed before it is sent.",
                http_status=409,
            )
        if user.role != ADMIN_ROLE and book.created_by_user_id != user.id:
            raise AppError(
                "FORBIDDEN",
                "Only the creator or an admin can make this record Directed.",
                http_status=403,
            )

    wanted = list(dict.fromkeys(user_ids))
    skipped = [BookSendSkipped(user_id=uid, reason="self") for uid in wanted if uid == user.id]
    targets = [uid for uid in wanted if uid != user.id]
    found = {u.id: u for u in db.scalars(select(User).where(User.id.in_(targets)))}
    invalid = [
        uid
        for uid in targets
        if uid not in found
        or found[uid].status != "active"
        or found[uid].role == INMATE_REPORTER_ROLE
    ]
    if invalid:
        raise AppError(
            "RECIPIENT_INVALID",
            "Recipients must be active users.",
            http_status=422,
            details={"user_ids": invalid},
        )
    if book.confidentiality == "secret":
        uncleared = [
            uid
            for uid in targets
            if not perm_service.has_capability(db, found[uid], "books.secret")
        ]
        if uncleared:
            raise AppError(
                "RECIPIENT_NOT_CLEARED",
                "Every recipient of a Secret record needs Secret clearance.",
                http_status=422,
                details={"user_ids": uncleared},
            )

    active = set(
        db.scalars(
            select(BookRecipient.user_id).where(
                BookRecipient.book_id == book.id,
                BookRecipient.user_id.in_(targets),
                BookRecipient.revoked_at.is_(None),
            )
        )
    )
    skipped += [
        BookSendSkipped(user_id=uid, reason="already_recipient") for uid in targets if uid in active
    ]
    new_ids = [uid for uid in targets if uid not in active]

    if book.confidentiality == "personal" and new_ids:
        _change_level(db, user, book, "directed")
    now = _now()
    rows = [
        BookRecipient(
            book_id=book.id,
            user_id=uid,
            sent_by_user_id=user.id,
            purpose=purpose,
            note=note or None,
            created_at=now,
        )
        for uid in new_ids
    ]
    db.add_all(rows)
    if rows:
        _audit(db, user, "book_sent", book, {"user_ids": new_ids, "purpose": purpose})
    db.commit()
    _push_new(db, book, rows, user)
    return _recipient_reads(db, user, rows), skipped


def _push_new(db: Session, book: Book, rows: list[BookRecipient], sender: User) -> None:
    """Immediate best-effort push; marks the item sent so the tick won't repeat it."""
    if not rows:
        return
    # Lazy: scheduler_service imports notification_service, which imports us.
    from app.services import notification_service, push_service, scheduler_service

    sender_name = book_service.user_display_name(db, sender)
    for row in rows:
        try:
            item = notification_service.inbox_item(book, row, sender_name)
            messages, url = scheduler_service._build_push("inbox", [item], INBOX_SECTION_URL)
            push_service.send_to_user(db, row.user_id, messages, url)
            push_service.mark_sent(db, row.user_id, "inbox", [item.ref])
        except Exception:
            log.exception("book send: push failed for recipient row %s", row.id)


def _get_row(db: Session, book: Book, recipient_id: int) -> BookRecipient:
    row = db.get(BookRecipient, recipient_id)
    if row is None or row.book_id != book.id:
        raise NotFoundError("RECIPIENT_NOT_FOUND", "Recipient not found")
    return row


def recall(db: Session, user: User, book: Book, recipient_id: int) -> None:
    """Sender, manager, or admin revokes one active send (history row stays)."""
    book_service.require_full_book_access(db, user, book)
    row = _get_row(db, book, recipient_id)
    if row.sent_by_user_id != user.id and not _is_manager_or_admin(user):
        raise AppError(
            "FORBIDDEN",
            "Only the sender, a manager, or an admin can recall a send.",
            http_status=403,
        )
    if row.revoked_at is not None:
        return
    row.revoked_at = _now()
    row.revoked_by_user_id = user.id
    _audit(db, user, "book_send_recalled", book, {"recipient_id": row.id, "user_id": row.user_id})
    db.flush()
    _discard_inaccessible_word_session(db, book)
    db.commit()


def list_recipients(db: Session, user: User, book: Book) -> list[BookRecipientRead]:
    """Creator/manager/admin see every row; others only rows they sent or received."""
    book_service.require_full_book_access(db, user, book)
    stmt = select(BookRecipient).where(BookRecipient.book_id == book.id)
    sees_all = _is_manager_or_admin(user) or book.created_by_user_id == user.id
    if not sees_all:
        stmt = stmt.where(
            (BookRecipient.sent_by_user_id == user.id) | (BookRecipient.user_id == user.id)
        )
    rows = list(db.scalars(stmt.order_by(BookRecipient.created_at, BookRecipient.id)))
    return _recipient_reads(db, user, rows)


# ---------------------------------------------------------------------------
# Inbox
# ---------------------------------------------------------------------------


def my_inbox(db: Session, user_id: int, book_ids: list[int]) -> dict[int, BookInboxRead]:
    """The caller's newest active received row per book."""
    if not book_ids:
        return {}
    rows = db.scalars(
        select(BookRecipient)
        .where(
            BookRecipient.book_id.in_(book_ids),
            BookRecipient.user_id == user_id,
            BookRecipient.revoked_at.is_(None),
        )
        .order_by(BookRecipient.created_at, BookRecipient.id)
    ).all()
    names = book_service.resolve_names_by_ids(db, {r.sent_by_user_id for r in rows})
    return {
        r.book_id: BookInboxRead(
            id=r.id,
            purpose=r.purpose,
            note=r.note,
            sent_by_user_id=r.sent_by_user_id,
            sent_by_name=names.get(r.sent_by_user_id),
            sent_at=r.created_at,
            read_at=r.read_at,
        )
        for r in rows
    }


def mark_read(db: Session, user_id: int, book_id: int) -> datetime | None:
    """Stamp first open on the caller's unread active rows; returns the stamp."""
    rows = db.scalars(
        select(BookRecipient).where(
            BookRecipient.book_id == book_id,
            BookRecipient.user_id == user_id,
            BookRecipient.revoked_at.is_(None),
            BookRecipient.read_at.is_(None),
        )
    ).all()
    if not rows:
        return None
    now = _now()
    for row in rows:
        row.read_at = now
    db.commit()
    return now


def _received_stmt(db: Session, user: User):  # type: ignore[no-untyped-def]
    stmt = (
        select(BookRecipient, Book)
        .join(Book, Book.id == BookRecipient.book_id)
        .where(
            BookRecipient.user_id == user.id,
            BookRecipient.revoked_at.is_(None),
            Book.deleted_at.is_(None),
        )
    )
    visibility = book_service.user_visibility_clause(db, user)
    return stmt if visibility is None else stmt.where(visibility)


def unread_received(db: Session, user: User) -> list[tuple[BookRecipient, Book]]:
    """Unread active sends to ``user`` on records they can open (push + bell)."""
    stmt = _received_stmt(db, user).where(BookRecipient.read_at.is_(None))
    return [(row, book) for row, book in db.execute(stmt.order_by(BookRecipient.id.desc()))]


def inbox_summary(db: Session, user: User) -> InboxSummaryRead:
    received = [row for row, _book in db.execute(_received_stmt(db, user))]
    by_purpose = InboxPurposeCounts()
    for row in received:
        setattr(by_purpose, row.purpose, getattr(by_purpose, row.purpose) + 1)
    sent_stmt = (
        select(func.count(func.distinct(BookRecipient.book_id)))
        .join(Book, Book.id == BookRecipient.book_id)
        .where(
            BookRecipient.sent_by_user_id == user.id,
            BookRecipient.revoked_at.is_(None),
            Book.deleted_at.is_(None),
        )
    )
    visibility = book_service.user_visibility_clause(db, user)
    if visibility is not None:
        sent_stmt = sent_stmt.where(visibility)
    return InboxSummaryRead(
        unread=sum(row.read_at is None for row in received),
        received=len(received),
        sent=int(db.scalar(sent_stmt) or 0),
        by_purpose=by_purpose,
    )
