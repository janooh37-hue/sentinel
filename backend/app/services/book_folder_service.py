"""Personal and shared desk folders; filing never changes a book's workflow."""

from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from app.api.errors import AppError, NotFoundError
from app.db.models import Book, BookFolder, BookFolderItem, User
from app.schemas.book import BookFolderRead
from app.services import book_send_service, book_service


def get_folder(db: Session, user: User, folder_id: int, *, manage: bool = False) -> BookFolder:
    folder = db.get(BookFolder, folder_id)
    if folder is None or folder.owner_user_id not in (None, user.id):
        raise NotFoundError("FOLDER_NOT_FOUND", "Folder not found")
    if manage and folder.owner_user_id is None and not book_send_service._is_manager_or_admin(user):
        raise AppError(
            "FORBIDDEN", "Only managers and admins may manage team folders.", http_status=403
        )
    return folder


def list_folders(
    db: Session, user: User, *, book_id: int | None = None, folder_id: int | None = None
) -> list[BookFolderRead]:
    stmt = select(BookFolder).where(
        or_(BookFolder.owner_user_id == user.id, BookFolder.owner_user_id.is_(None))
    )
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
    return [
        BookFolderRead(
            id=f.id,
            name=f.name,
            team=f.owner_user_id is None,
            count=counts.get(f.id, (0, 0))[0],
            can_manage=f.owner_user_id == user.id or book_send_service._is_manager_or_admin(user),
            has_book=bool(counts.get(f.id, (0, 0))[1]) if book_id is not None else None,
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
