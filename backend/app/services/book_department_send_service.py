"""Department deliveries reuse direct recipients for access and inbox state."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import AppError, NotFoundError
from app.core.roles import ADMIN_ROLE, INMATE_REPORTER_ROLE
from app.db.models import (
    Book,
    BookDepartmentSend,
    BookRecipient,
    Department,
    DepartmentMember,
    Employee,
    User,
)
from app.schemas.book import (
    BookDepartmentSendRead,
    BookDistributeRequest,
    BookDistributionDepartment,
    BookDistributionMember,
    BookDistributionOptions,
    BookRecipientRead,
    BookSendSkipped,
    SendPurpose,
)
from app.schemas.department import DepartmentRole
from app.services import book_send_service, book_service, department_service, perm_service

# Accounts that can receive a department delivery.
_REACHABLE = (User.status == "active", User.role != INMATE_REPORTER_ROLE)


def receivers(db: Session, department_ids: Sequence[int]) -> dict[int, list[User]]:
    """Reachable head account first, then active deputies, per department."""
    result: dict[int, list[User]] = defaultdict(list)
    if not department_ids:
        return result
    for did, target in db.execute(
        select(Department.id, User)
        .join(User, User.employee_id == Department.head_employee_id)
        .where(Department.id.in_(department_ids))
        .where(*_REACHABLE)
        .order_by(User.id)
    ):
        result[did].append(target)
    for did, target in db.execute(
        select(DepartmentMember.department_id, User)
        .join(User, User.id == DepartmentMember.user_id)
        .where(
            DepartmentMember.department_id.in_(department_ids),
            DepartmentMember.role == "deputy",
        )
        .where(*_REACHABLE)
        .order_by(DepartmentMember.id)
    ):
        if all(existing.id != target.id for existing in result[did]):
            result[did].append(target)
    return result


def head_departments(db: Session, user: User) -> set[int]:
    """Departments this user receives for: the head's account or a deputy."""
    headed = (
        set(
            db.scalars(select(Department.id).where(Department.head_employee_id == user.employee_id))
        )
        if user.employee_id
        else set()
    )
    return headed | set(
        db.scalars(
            select(DepartmentMember.department_id).where(
                DepartmentMember.user_id == user.id,
                DepartmentMember.role == "deputy",
            )
        )
    )


def prepare_sends(
    db: Session,
    book: Book,
    department_ids: list[int],
) -> tuple[list[tuple[Department, list[User]]], list[BookSendSkipped]]:
    """Validate the whole department selection before staging any writes."""
    wanted = list(dict.fromkeys(department_ids))
    if not wanted:
        return [], []
    departments = {did: department_service.require_active_department(db, did) for did in wanted}
    active = set(
        db.scalars(
            select(BookDepartmentSend.department_id).where(
                BookDepartmentSend.book_id == book.id,
                BookDepartmentSend.department_id.in_(wanted),
                BookDepartmentSend.revoked_at.is_(None),
            )
        )
    )
    skipped = [
        BookSendSkipped(department_id=did, reason="already_sent") for did in wanted if did in active
    ]
    heads = receivers(db, [did for did in wanted if did not in active])
    missing = [did for did in wanted if did not in active and not heads[did]]
    if missing:
        raise AppError(
            "DEPARTMENT_HAS_NO_HEAD",
            "Every department needs an active head or deputy.",
            http_status=422,
            details={"department_ids": missing},
        )
    plan = []
    uncleared_departments = []
    for did in wanted:
        if did in active:
            continue
        eligible = []
        for target in heads[did]:
            if book.confidentiality == "secret" and not perm_service.has_capability(
                db, target, "books.secret"
            ):
                skipped.append(
                    BookSendSkipped(user_id=target.id, department_id=did, reason="not_cleared")
                )
            else:
                eligible.append(target)
        if not eligible:
            uncleared_departments.append(did)
        plan.append((departments[did], eligible))
    if uncleared_departments:
        raise AppError(
            "DEPARTMENT_NO_CLEARED_HEAD",
            "Every department needs a cleared head or deputy.",
            http_status=422,
            details={"department_ids": uncleared_departments},
        )
    return plan, skipped


def stage_sends(
    db: Session,
    user: User,
    book: Book,
    plan: list[tuple[Department, list[User]]],
    *,
    purpose: SendPurpose,
    note: str | None,
    parent_send_id: int | None = None,
) -> tuple[list[BookRecipient], list[BookSendSkipped]]:
    rows: list[BookRecipient] = []
    skipped: list[BookSendSkipped] = []
    for department, heads in plan:
        now = book_send_service._now()
        delivery = BookDepartmentSend(
            book_id=book.id,
            department_id=department.id,
            parent_send_id=parent_send_id,
            sent_by_user_id=user.id,
            purpose=purpose,
            note=note or None,
            created_at=now,
        )
        db.add(delivery)
        db.flush()
        active = set(
            db.scalars(
                select(BookRecipient.user_id).where(
                    BookRecipient.book_id == book.id,
                    BookRecipient.revoked_at.is_(None),
                    BookRecipient.user_id.in_([target.id for target in heads]),
                )
            )
        )
        for target in heads:
            reason = (
                "self"
                if target.id == user.id
                else "already_recipient"
                if target.id in active
                else None
            )
            if reason is not None:
                skipped.append(
                    BookSendSkipped(user_id=target.id, department_id=department.id, reason=reason)
                )
                continue
            row = BookRecipient(
                book_id=book.id,
                user_id=target.id,
                sent_by_user_id=user.id,
                department_send_id=delivery.id,
                purpose=purpose,
                note=note or None,
                created_at=now,
            )
            db.add(row)
            rows.append(row)
        book_send_service._audit(
            db,
            user,
            "book_sent_department",
            book,
            {
                "department_id": department.id,
                "department_send_id": delivery.id,
                "parent_send_id": parent_send_id,
                "purpose": purpose,
            },
        )
    return rows, skipped


def _get_send(db: Session, book: Book, send_id: int) -> BookDepartmentSend:
    row = db.get(BookDepartmentSend, send_id)
    if row is None or row.book_id != book.id:
        raise NotFoundError("DEPARTMENT_SEND_NOT_FOUND", "Department send not found.")
    return row


def _require_head(db: Session, user: User, book: Book, send_id: int) -> BookDepartmentSend:
    row = _get_send(db, book, send_id)
    if user.role != ADMIN_ROLE and row.department_id not in head_departments(db, user):
        raise NotFoundError("DEPARTMENT_SEND_NOT_FOUND", "Department send not found.")
    if row.revoked_at is not None:
        raise AppError(
            "DEPARTMENT_SEND_REVOKED", "This department send was recalled.", http_status=409
        )
    book_service.require_full_book_access(db, user, book)
    return row


def _members(db: Session, department_id: int) -> list[tuple[DepartmentRole, User]]:
    """Head, deputies, viewers and derived members, each user once at their strongest role."""
    found: dict[int, tuple[DepartmentRole, User]] = {}
    for target in receivers(db, [department_id])[department_id]:
        found[target.id] = ("deputy", target)
    head_ids = {
        target.id
        for target in db.scalars(
            select(User)
            .join(Department, Department.head_employee_id == User.employee_id)
            .where(Department.id == department_id)
            .where(*_REACHABLE)
        )
    }
    for user_id in head_ids:
        found[user_id] = ("head", found[user_id][1])
    for target in db.scalars(
        select(User)
        .join(DepartmentMember, DepartmentMember.user_id == User.id)
        .where(
            DepartmentMember.department_id == department_id,
            DepartmentMember.role == "viewer",
        )
        .where(*_REACHABLE)
        .order_by(DepartmentMember.id)
    ):
        found.setdefault(target.id, ("viewer", target))
    for target in db.scalars(
        select(User)
        .join(Employee, Employee.id == User.employee_id)
        .where(Employee.department_id == department_id)
        .where(*_REACHABLE)
        .order_by(User.id)
    ):
        found.setdefault(target.id, ("member", target))
    return list(found.values())


def distribution_options(
    db: Session, user: User, book: Book, send_id: int
) -> BookDistributionOptions:
    delivery = _require_head(db, user, book, send_id)
    members = [
        (role, target)
        for role, target in _members(db, delivery.department_id)
        if target.id != user.id
    ]
    ids = {target.id for _, target in members}
    names = book_service.resolve_names_by_ids(db, ids)
    names_ar = book_service.resolve_names_ar_by_ids(db, ids)
    active = set(
        db.scalars(
            select(BookRecipient.user_id).where(
                BookRecipient.book_id == book.id,
                BookRecipient.revoked_at.is_(None),
                BookRecipient.user_id.in_(ids),
            )
        )
    )
    children = list(
        db.scalars(
            select(Department)
            .where(
                Department.parent_id == delivery.department_id,
                Department.active.is_(True),
            )
            .order_by(Department.id)
        )
    )
    with_head = set(receivers(db, [child.id for child in children]))
    return BookDistributionOptions(
        members=[
            BookDistributionMember(
                user_id=target.id,
                name=names.get(target.id) or target.display_name or target.email,
                name_ar=names_ar.get(target.id),
                role=role,
                already_recipient=target.id in active,
                cleared=perm_service.has_capability(db, target, "books.secret"),
            )
            for role, target in members
        ],
        subdepartments=[
            BookDistributionDepartment(
                id=child.id,
                name_en=child.name_en,
                name_ar=child.name_ar,
                has_head=child.id in with_head,
            )
            for child in children
        ],
    )


def distribute(
    db: Session,
    user: User,
    book: Book,
    send_id: int,
    body: BookDistributeRequest,
) -> tuple[list[BookRecipientRead], list[BookSendSkipped]]:
    delivery = _require_head(db, user, book, send_id)
    if body.mode == "keep":
        # The first keep is the one the sender's progress reports; repeats are no-ops.
        if delivery.kept_at is None:
            delivery.kept_at = book_send_service._now()
            delivery.kept_by_user_id = user.id
            book_send_service._audit(
                db, user, "book_department_send_kept", book, {"department_send_id": delivery.id}
            )
            db.commit()
        return [], []
    purpose = body.purpose or cast(SendPurpose, delivery.purpose)
    if body.mode == "subdepartment":
        child = department_service.require_active_department(db, cast(int, body.subdepartment_id))
        if child.parent_id != delivery.department_id:
            raise AppError(
                "DISTRIBUTE_NOT_SUBDEPARTMENT", "Choose a direct subdepartment.", http_status=422
            )
        plan, skipped = prepare_sends(db, book, [child.id])
        rows, duplicate_skips = stage_sends(
            db, user, book, plan, purpose=purpose, note=body.note, parent_send_id=delivery.id
        )
        skipped.extend(duplicate_skips)
        db.commit()
        book_send_service._push_new(db, book, rows, user, department_heads=True)
    else:
        members = {target.id: target for _, target in _members(db, delivery.department_id)}
        wanted = (
            list(dict.fromkeys(body.user_ids))
            if body.mode == "members"
            else [uid for uid in members if uid != user.id]
        )
        invalid = [uid for uid in wanted if uid not in members]
        if invalid:
            raise AppError(
                "DISTRIBUTE_NOT_MEMBER",
                "Every recipient must be a department member.",
                http_status=422,
                details={"user_ids": invalid},
            )
        active = set(
            db.scalars(
                select(BookRecipient.user_id).where(
                    BookRecipient.book_id == book.id,
                    BookRecipient.revoked_at.is_(None),
                    BookRecipient.user_id.in_(wanted),
                )
            )
        )
        rows, skipped = [], []
        for uid in wanted:
            reason = None
            if uid == user.id:
                reason = "self"
            elif book.confidentiality == "secret" and not perm_service.has_capability(
                db, members[uid], "books.secret"
            ):
                reason = "not_cleared"
            elif uid in active:
                reason = "already_recipient"
            if reason:
                skipped.append(
                    BookSendSkipped(
                        user_id=uid, department_id=delivery.department_id, reason=reason
                    )
                )
                continue
            row = BookRecipient(
                book_id=book.id,
                user_id=uid,
                sent_by_user_id=user.id,
                department_send_id=delivery.id,
                purpose=purpose,
                note=body.note or None,
            )
            db.add(row)
            rows.append(row)
        if rows:
            book_send_service._audit(
                db,
                user,
                "book_sent",
                book,
                {
                    "user_ids": [row.user_id for row in rows],
                    "department_send_id": delivery.id,
                    "purpose": purpose,
                },
            )
        db.commit()
        book_send_service._push_new(db, book, rows, user)
    return book_send_service._recipient_reads(db, user, rows), skipped


def _can_recall(
    user: User, delivery: BookDepartmentSend, heads: set[int], by_id: dict[int, BookDepartmentSend]
) -> bool:
    parent = by_id.get(delivery.parent_send_id) if delivery.parent_send_id is not None else None
    return (
        book_send_service._is_manager_or_admin(user)
        or delivery.sent_by_user_id == user.id
        or (parent is not None and parent.department_id in heads)
    )


def recall(db: Session, user: User, book: Book, send_id: int) -> None:
    book_service.require_full_book_access(db, user, book)
    delivery = _get_send(db, book, send_id)
    all_sends = list(
        db.scalars(select(BookDepartmentSend).where(BookDepartmentSend.book_id == book.id))
    )
    by_id = {row.id: row for row in all_sends}
    if not _can_recall(user, delivery, head_departments(db, user), by_id):
        raise AppError(
            "FORBIDDEN",
            "Only the sender, parent heads, a manager or an admin can recall this send.",
            http_status=403,
        )
    if delivery.revoked_at is not None:
        return
    children: dict[int, list[int]] = defaultdict(list)
    for row in all_sends:
        if row.parent_send_id is not None:
            children[row.parent_send_id].append(row.id)
    ids = {delivery.id}
    pending = [delivery.id]
    while pending:
        for child in children[pending.pop()]:
            if child not in ids:
                ids.add(child)
                pending.append(child)
    now = book_send_service._now()
    for did in ids:
        if by_id[did].revoked_at is None:
            by_id[did].revoked_at = now
            by_id[did].revoked_by_user_id = user.id
    for recipient in db.scalars(
        select(BookRecipient).where(
            BookRecipient.department_send_id.in_(ids),
            BookRecipient.revoked_at.is_(None),
        )
    ):
        recipient.revoked_at = now
        recipient.revoked_by_user_id = user.id
    book_send_service._audit(
        db,
        user,
        "book_department_send_recalled",
        book,
        {"department_send_id": delivery.id, "send_ids": sorted(ids)},
    )
    db.flush()
    book_send_service._discard_inaccessible_word_session(db, book)
    db.commit()


def sends_by_book(
    db: Session, user: User, books: Sequence[Book]
) -> dict[int, list[BookDepartmentSendRead]]:
    """Batch department labels, sender names and progress for detail/desk rows."""
    if not books:
        return {}
    heads = head_departments(db, user)
    creators = {book.id: book.created_by_user_id for book in books}
    sends = list(
        db.execute(
            select(BookDepartmentSend, Department)
            .join(Department, Department.id == BookDepartmentSend.department_id)
            .where(BookDepartmentSend.book_id.in_(creators))
            .order_by(BookDepartmentSend.id)
        ).tuples()
    )
    by_id = {row.id: row for row, _ in sends}
    visible = [
        (row, dept)
        for row, dept in sends
        if book_send_service._is_manager_or_admin(user)
        or creators[row.book_id] == user.id
        or row.sent_by_user_id == user.id
        or row.department_id in heads
    ]
    recipients: dict[int, list[BookRecipient]] = defaultdict(list)
    if visible:
        for recipient in db.scalars(
            select(BookRecipient).where(
                BookRecipient.department_send_id.in_([row.id for row, _ in visible]),
                BookRecipient.revoked_at.is_(None),
            )
        ):
            recipients[cast(int, recipient.department_send_id)].append(recipient)
    sender_ids = {row.sent_by_user_id for row, _ in visible} | {
        row.kept_by_user_id for row, _ in visible if row.kept_by_user_id is not None
    }
    names = book_service.resolve_names_by_ids(db, sender_ids)
    names_ar = book_service.resolve_names_ar_by_ids(db, sender_ids)
    result: dict[int, list[BookDepartmentSendRead]] = {book.id: [] for book in books}
    for row, dept in visible:
        reached = recipients[row.id]
        initial = [
            recipient
            for recipient in reached
            if recipient.sent_by_user_id == row.sent_by_user_id
            and recipient.created_at == row.created_at
        ]
        result[row.book_id].append(
            BookDepartmentSendRead(
                id=row.id,
                department_id=dept.id,
                department_name_en=dept.name_en,
                department_name_ar=dept.name_ar,
                parent_send_id=row.parent_send_id,
                sent_by_user_id=row.sent_by_user_id,
                sent_by_name=names.get(row.sent_by_user_id),
                sent_by_name_ar=names_ar.get(row.sent_by_user_id),
                purpose=cast(SendPurpose, row.purpose),
                note=row.note,
                created_at=row.created_at,
                revoked_at=row.revoked_at,
                kept_at=row.kept_at,
                kept_by_user_id=row.kept_by_user_id,
                kept_by_name=names.get(row.kept_by_user_id) if row.kept_by_user_id else None,
                kept_by_name_ar=names_ar.get(row.kept_by_user_id) if row.kept_by_user_id else None,
                heads_total=len(initial),
                heads_read=sum(recipient.read_at is not None for recipient in initial),
                members_reached=len(reached) - len(initial),
                done_count=sum(recipient.done_at is not None for recipient in reached),
                can_recall=row.revoked_at is None and _can_recall(user, row, heads, by_id),
                can_distribute=row.revoked_at is None
                and (user.role == ADMIN_ROLE or row.department_id in heads),
            )
        )
    return result
