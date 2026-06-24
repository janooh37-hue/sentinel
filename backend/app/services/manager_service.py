"""Manager read-only service — picker endpoint support."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError
from app.db.models import Manager


def list_managers(db: Session) -> list[Manager]:
    """Return all managers sorted by name_en."""
    rows = db.execute(select(Manager).order_by(Manager.name_en)).scalars().all()
    return list(rows)


def set_manager_user(db: Session, manager_id: int, user_id: int | None) -> Manager:
    """Link (or unlink) a login account to a manager row.

    Raises ``NotFoundError`` if ``manager_id`` doesn't exist.
    """
    mgr = db.get(Manager, manager_id)
    if mgr is None:
        raise NotFoundError("MANAGER_NOT_FOUND", f"Manager {manager_id} not found", id=manager_id)
    mgr.user_id = user_id
    db.commit()
    db.refresh(mgr)
    return mgr


def manager_user_name(db: Session, manager: Manager) -> str | None:
    """Resolve the display name of the login account linked to ``manager``.

    Returns ``None`` if there is no linked account. Uses a function-local
    import of ``book_service`` to avoid a circular-import at module level
    (manager_service ← managers.py ← book_service imports back through
    services package init).
    """
    if manager.user_id is None:
        return None
    from app.services import book_service  # local import — avoids cycle

    return book_service.resolve_user_name_by_id(db, manager.user_id)
