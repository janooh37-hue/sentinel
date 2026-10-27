"""Personal and shared desk folders; filing never changes a book's workflow."""

from sqlalchemy import and_, case, delete, exists, func, or_, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.api.errors import AppError, NotFoundError
from app.core.roles import INMATE_REPORTER_ROLE
from app.db.models import (
    Book,
    BookFolder,
    BookFolderItem,
    BookFolderShare,
    Department,
    Employee,
    User,
)
from app.schemas.book import (
    BookFolderDepartment,
    BookFolderRead,
    BookFolderShareOption,
    BookFolderShareOptions,
    BookFolderSharesUpdate,
    BookFolderShareUser,
)
from app.services import (
    book_send_service,
    book_service,
    department_scope_service,
    department_service,
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
                        BookFolderShare.department_id.in_(
                            department_scope_service.user_department_ids_select(user.id)
                        ),
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
    department_ids = {
        share.department_id
        for rows in shares.values()
        for share in rows
        if share.department_id is not None
    }
    departments = {
        department.id: BookFolderDepartment(
            id=department.id, name_en=department.name_en, name_ar=department.name_ar
        )
        for department in db.scalars(select(Department).where(Department.id.in_(department_ids)))
    }
    return [
        BookFolderRead(
            id=f.id,
            name=f.name,
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
                departments[s.department_id]
                for s in shares.get(f.id, [])
                if s.department_id is not None and s.department_id in departments
            ]
            if f.owner_user_id is None
            else [],
            legacy_departments=[
                s.department for s in shares.get(f.id, []) if s.department is not None
            ]
            if f.owner_user_id is None
            else [],
        )
        for f in folders
    ]


def create_folder(db: Session, user: User, *, name: str, team: bool) -> BookFolderRead:
    if team and not book_send_service._is_manager_or_admin(user):
        raise AppError(
            "FORBIDDEN", "Only managers and admins may manage team folders.", http_status=403
        )
    folder = BookFolder(
        owner_user_id=None if team else user.id, name=name, created_by_user_id=user.id
    )
    db.add(folder)
    db.commit()
    return list_folders(db, user, folder_id=folder.id)[0]


def rename_folder(db: Session, user: User, folder_id: int, *, name: str) -> BookFolderRead:
    folder = get_folder(db, user, folder_id, manage=True)
    folder.name = name
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


def _active_departments_exist(db: Session) -> bool:
    return db.scalar(select(Department.id).where(Department.active.is_(True)).limit(1)) is not None


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
            department_id=employee.department_id if employee is not None else None,
            department=(employee.department or "").strip() or None
            if employee is not None
            else None,
        )
        for account, employee in db.execute(
            select(User, Employee)
            .outerjoin(Employee, User.employee_id == Employee.id)
            .where(User.status == "active", User.role != INMATE_REPORTER_ROLE)
        ).tuples()
    ]
    users.sort(key=lambda option: (option.name.casefold(), option.id))
    departments = [
        BookFolderDepartment(
            id=department.id, name_en=department.name_en, name_ar=department.name_ar
        )
        for department in db.scalars(
            select(Department)
            .where(Department.active.is_(True))
            .order_by(func.lower(Department.name_en), Department.id)
        )
    ]
    return BookFolderShareOptions(
        users=users,
        departments=departments,
        # Until departments exist, free-text employee labels stay shareable as before.
        legacy_departments=[]
        if departments
        else sorted({option.department for option in users if option.department}, key=str.casefold),
    )


def update_shares(
    db: Session, user: User, folder_id: int, body: BookFolderSharesUpdate
) -> BookFolderRead:
    folder = get_folder(db, user, folder_id)
    _require_team_manager(user)
    if folder.owner_user_id is not None:
        raise AppError("FOLDER_NOT_TEAM", "Personal folders cannot be shared.", http_status=422)
    user_ids = set(body.user_ids) if not body.everyone else set()
    department_ids = set(body.department_ids) if not body.everyone else set()
    legacy_departments = set(body.legacy_departments) if not body.everyone else set()
    if not body.everyone and not user_ids and not department_ids and not legacy_departments:
        raise AppError(
            "FOLDER_SHARES_EMPTY", "Choose at least one user or department.", http_status=422
        )
    existing = db.execute(
        select(BookFolderShare.department_id, BookFolderShare.department).where(
            BookFolderShare.folder_id == folder.id,
            or_(
                BookFolderShare.department_id.is_not(None), BookFolderShare.department.is_not(None)
            ),
        )
    ).all()
    existing_department_ids = {did for did, _ in existing if did is not None}
    existing_legacy = {text for _, text in existing if text is not None}
    retained_legacy = legacy_departments & existing_legacy
    requested_new = sorted(legacy_departments - existing_legacy)
    if requested_new and _active_departments_exist(db):
        raise AppError(
            "FOLDER_SHARE_LEGACY_INVALID",
            "Legacy department shares may only be retained or removed.",
            http_status=422,
        )
    # With no active departments, new free-text audiences behave as they did before
    # departments: trimmed and matched case-insensitively.
    added_legacy: dict[str, str] = {text.strip().casefold(): text for text in retained_legacy}
    for text in (raw.strip() for raw in requested_new):
        if text:
            added_legacy.setdefault(text.casefold(), text)
    added_legacy = {key: text for key, text in added_legacy.items() if text not in retained_legacy}
    # A department already on the folder may be retained after it is deactivated.
    for department_id in sorted(department_ids - existing_department_ids):
        department_service.require_active_department(db, department_id)
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
    db.execute(
        delete(BookFolderShare).where(
            BookFolderShare.folder_id == folder.id,
            or_(
                BookFolderShare.department.is_(None),
                BookFolderShare.department.not_in(retained_legacy),
            ),
        )
    )
    db.add_all(BookFolderShare(folder_id=folder.id, user_id=uid) for uid in sorted(user_ids))
    db.add_all(
        BookFolderShare(folder_id=folder.id, department_id=department_id)
        for department_id in sorted(department_ids)
    )
    db.add_all(
        BookFolderShare(folder_id=folder.id, department=text)
        for text in sorted(added_legacy.values(), key=str.casefold)
    )
    db.commit()
    return list_folders(db, user, folder_id=folder.id)[0]
