"""Personal and shared desk folders; filing never changes a book's workflow."""

from sqlalchemy import and_, case, delete, exists, func, or_, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.api.errors import AppError, NotFoundError
from app.core.roles import INMATE_REPORTER_ROLE
from app.db.models import Book, BookFolder, BookFolderItem, BookFolderShare, Employee, User
from app.schemas.book import (
    BookFolderBox,
    BookFolderRead,
    BookFolderShareOption,
    BookFolderShareOptions,
    BookFolderSharesUpdate,
    BookFolderShareUser,
)
from app.services import book_send_service, book_service

# Each folder box is the desk scope of the same name; `GET /books?inbox=` filter.
BOX_INBOX: dict[str, book_service.InboxFilter] = {
    "incoming": "received",
    "outgoing": "sent",
    "done": "done",
    "archived": "archived",
}


def book_in_box(db: Session, user: User, book: Book, box: str) -> bool:
    """Whether ``book`` is in the caller's desk ``box``: the desk list predicate."""
    return bool(
        db.scalar(
            select(
                exists().where(Book.id == book.id, book_service.inbox_clause(user, BOX_INBOX[box]))
            )
        )
    )


def visibility_clause(user: User) -> ColumnElement[bool]:
    """One folder access rule shared by lists and every folder operation."""
    team_visible: ColumnElement[bool] = ~exists(
        select(BookFolderShare.id)
        .where(BookFolderShare.folder_id == BookFolder.id)
        .correlate(BookFolder)
    )
    if book_send_service._is_manager_or_admin(user):
        team_visible = BookFolder.owner_user_id.is_(None)
    else:
        department = (
            select(func.lower(func.trim(Employee.department)))
            .where(Employee.id == user.employee_id)
            .scalar_subquery()
        )
        team_visible = or_(
            team_visible,
            exists(
                select(BookFolderShare.id)
                .where(
                    BookFolderShare.folder_id == BookFolder.id,
                    or_(
                        BookFolderShare.user_id == user.id,
                        func.lower(func.trim(BookFolderShare.department)) == department,
                    ),
                )
                .correlate(BookFolder)
            ),
        )
    return or_(
        BookFolder.owner_user_id == user.id,
        and_(BookFolder.owner_user_id.is_(None), team_visible),
    )


def get_folder(db: Session, user: User, folder_id: int, *, manage: bool = False) -> BookFolder:
    folder = db.scalar(
        select(BookFolder).where(BookFolder.id == folder_id, visibility_clause(user))
    )
    if folder is None:
        raise NotFoundError("FOLDER_NOT_FOUND", "Folder not found")
    if manage and folder.owner_user_id is None and not book_send_service._is_manager_or_admin(user):
        raise AppError(
            "FORBIDDEN", "Only managers and admins may manage team folders.", http_status=403
        )
    return folder


def list_folders(
    db: Session, user: User, *, book_id: int | None = None, folder_id: int | None = None
) -> list[BookFolderRead]:
    stmt = select(BookFolder).where(visibility_clause(user))
    if folder_id is not None:
        stmt = stmt.where(BookFolder.id == folder_id)
    folders = db.scalars(
        stmt.order_by(
            BookFolder.owner_user_id.is_(None), func.lower(BookFolder.name), BookFolder.id
        )
    ).all()
    if not folders:
        return []
    counts_stmt = (
        select(
            BookFolderItem.folder_id,
            func.count(Book.id),
            func.max(case((Book.id == book_id, 1), else_=0)),
        )
        .join(Book, Book.id == BookFolderItem.book_id)
        .where(BookFolderItem.folder_id.in_([f.id for f in folders]), Book.deleted_at.is_(None))
        .group_by(BookFolderItem.folder_id)
    )
    visibility = book_service.user_visibility_clause(db, user)
    if visibility is not None:
        counts_stmt = counts_stmt.where(visibility)
    counts = {folder: (count, has_book) for folder, count, has_book in db.execute(counts_stmt)}
    shares: dict[int, list[BookFolderShare]] = {}
    for share in db.scalars(
        select(BookFolderShare)
        .where(BookFolderShare.folder_id.in_([f.id for f in folders]))
        .order_by(BookFolderShare.id)
    ):
        shares.setdefault(share.folder_id, []).append(share)
    user_ids = {f.created_by_user_id for f in folders} | {
        share.user_id for rows in shares.values() for share in rows if share.user_id is not None
    }
    names = book_service.resolve_names_by_ids(db, user_ids)
    names_ar = book_service.resolve_names_ar_by_ids(db, user_ids)
    titles = book_service.resolve_titles_by_ids(db, user_ids)
    return [
        BookFolderRead(
            id=f.id,
            name=f.name,
            box=f.box,
            team=f.owner_user_id is None,
            count=counts.get(f.id, (0, 0))[0],
            can_manage=f.owner_user_id == user.id or book_send_service._is_manager_or_admin(user),
            has_book=bool(counts.get(f.id, (0, 0))[1]) if book_id is not None else None,
            created_by_name=names.get(f.created_by_user_id),
            created_by_name_ar=names_ar.get(f.created_by_user_id),
            everyone=f.owner_user_id is None and not shares.get(f.id),
            shared_users=[
                BookFolderShareUser(
                    id=s.user_id,
                    name=names[s.user_id],
                    name_ar=names_ar.get(s.user_id),
                    title=titles.get(s.user_id, (None, None))[0],
                    title_ar=titles.get(s.user_id, (None, None))[1],
                )
                for s in shares.get(f.id, [])
                if s.user_id is not None and s.user_id in names
            ]
            if f.owner_user_id is None
            else [],
            shared_departments=[
                s.department for s in shares.get(f.id, []) if s.department is not None
            ]
            if f.owner_user_id is None
            else [],
        )
        for f in folders
    ]


def create_folder(
    db: Session, user: User, *, name: str, box: BookFolderBox, team: bool
) -> BookFolderRead:
    if team and not book_send_service._is_manager_or_admin(user):
        raise AppError(
            "FORBIDDEN", "Only managers and admins may manage team folders.", http_status=403
        )
    folder = BookFolder(
        owner_user_id=None if team else user.id,
        name=name,
        box=box,
        created_by_user_id=user.id,
    )
    db.add(folder)
    db.commit()
    return list_folders(db, user, folder_id=folder.id)[0]


def update_folder(
    db: Session,
    user: User,
    folder_id: int,
    *,
    name: str | None = None,
    box: BookFolderBox | None = None,
) -> BookFolderRead:
    """Rename and/or move a folder to another box; filed books stay filed."""
    folder = get_folder(db, user, folder_id, manage=True)
    if name is not None:
        folder.name = name
    if box is not None:
        folder.box = box
    db.commit()
    return list_folders(db, user, folder_id=folder.id)[0]


def delete_folder(db: Session, user: User, folder_id: int) -> None:
    folder = get_folder(db, user, folder_id, manage=True)
    db.execute(delete(BookFolderItem).where(BookFolderItem.folder_id == folder.id))
    db.execute(delete(BookFolderShare).where(BookFolderShare.folder_id == folder.id))
    db.delete(folder)
    db.commit()


def file_book(
    db: Session, user: User, book_id: int, folder_id: int, *, remove: bool = False
) -> None:
    folder = get_folder(db, user, folder_id)
    book = book_service.get_book(db, book_id)
    book_service.require_full_book_access(db, user, book)
    if not remove and not book_in_box(db, user, book, folder.box):
        raise AppError(
            "FOLDER_BOX_MISMATCH",
            "This book is not in the folder's box. / هذا الكتاب ليس في صندوق هذا المجلد.",
            http_status=409,
            details={"box": folder.box},
        )
    if remove:
        db.execute(
            delete(BookFolderItem).where(
                BookFolderItem.folder_id == folder.id, BookFolderItem.book_id == book.id
            )
        )
    else:
        db.execute(
            insert(BookFolderItem)
            .values(folder_id=folder.id, book_id=book.id, added_by_user_id=user.id)
            .on_conflict_do_nothing(index_elements=["folder_id", "book_id"])
        )
    db.commit()


def _require_team_manager(user: User) -> None:
    if not book_send_service._is_manager_or_admin(user):
        raise AppError(
            "FORBIDDEN", "Only managers and admins may manage team folders.", http_status=403
        )


def share_options(db: Session, user: User) -> BookFolderShareOptions:
    _require_team_manager(user)
    users = [
        BookFolderShareOption(
            id=account.id,
            name=employee.name_en
            if employee is not None
            else (account.display_name or account.email),
            name_ar=employee.name_ar if employee is not None else None,
            title=employee.position if employee is not None else None,
            title_ar=employee.position_ar if employee is not None else None,
            department=(employee.department or "").strip() or None
            if employee is not None
            else None,
        )
        for account, employee in db.execute(
            select(User, Employee)
            .outerjoin(Employee, User.employee_id == Employee.id)
            .where(User.status == "active", User.role != INMATE_REPORTER_ROLE)
        )
    ]
    users.sort(key=lambda option: (option.name.casefold(), option.id))
    return BookFolderShareOptions(
        users=users,
        departments=sorted(
            {option.department for option in users if option.department}, key=str.casefold
        ),
    )


def update_shares(
    db: Session, user: User, folder_id: int, body: BookFolderSharesUpdate
) -> BookFolderRead:
    folder = get_folder(db, user, folder_id)
    _require_team_manager(user)
    if folder.owner_user_id is not None:
        raise AppError("FOLDER_NOT_TEAM", "Personal folders cannot be shared.", http_status=422)
    user_ids = set(body.user_ids) if not body.everyone else set()
    departments = (
        {department.casefold(): department for department in body.departments}
        if not body.everyone
        else {}
    )
    if not body.everyone and not user_ids and not departments:
        raise AppError(
            "FOLDER_SHARES_EMPTY", "Choose at least one user or department.", http_status=422
        )
    valid_ids = (
        set(
            db.scalars(
                select(User.id).where(
                    User.id.in_(user_ids),
                    User.status == "active",
                    User.role != INMATE_REPORTER_ROLE,
                )
            )
        )
        if user_ids
        else set()
    )
    if user_ids != valid_ids:
        raise AppError(
            "FOLDER_SHARE_USER_INVALID", "Shared users must be active users.", http_status=422
        )
    db.execute(delete(BookFolderShare).where(BookFolderShare.folder_id == folder.id))
    db.add_all(BookFolderShare(folder_id=folder.id, user_id=uid) for uid in sorted(user_ids))
    db.add_all(
        BookFolderShare(folder_id=folder.id, department=department)
        for department in sorted(departments.values(), key=str.casefold)
    )
    db.commit()
    return list_folders(db, user, folder_id=folder.id)[0]
