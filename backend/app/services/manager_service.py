"""Manager service — CRUD + signature-file management + picker support."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError
from app.config import get_settings
from app.core import signature as signature_core
from app.db.models import Manager
from app.schemas.manager import ManagerCreate, ManagerUpdate


def list_managers(db: Session, *, include_inactive: bool = False) -> list[Manager]:
    """Managers sorted by name_en. Active-only unless ``include_inactive``."""
    stmt = select(Manager).order_by(Manager.name_en)
    if not include_inactive:
        stmt = stmt.where(Manager.active.is_(True))
    return list(db.execute(stmt).scalars().all())


def _get_or_404(db: Session, manager_id: int) -> Manager:
    mgr = db.get(Manager, manager_id)
    if mgr is None:
        raise NotFoundError("MANAGER_NOT_FOUND", f"Manager {manager_id} not found", id=manager_id)
    return mgr


def create_manager(db: Session, data: ManagerCreate) -> Manager:
    mgr = Manager(
        name_en=data.name_en,
        name_ar=data.name_ar,
        title=data.title,
        active=data.active,
        user_id=data.user_id,
    )
    db.add(mgr)
    db.commit()
    db.refresh(mgr)
    return mgr


def update_manager(db: Session, manager_id: int, data: ManagerUpdate) -> Manager:
    """Partial update. Only fields explicitly set on ``data`` are written."""
    mgr = _get_or_404(db, manager_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(mgr, field, value)
    db.commit()
    db.refresh(mgr)
    return mgr


def set_manager_user(db: Session, manager_id: int, user_id: int | None) -> Manager:
    """Back-compat shim for the link-only PATCH path."""
    return update_manager(db, manager_id, ManagerUpdate(user_id=user_id))


def manager_signature_path(manager_id: int) -> Path:
    """Canonical signature file for a manager, with containment guard."""
    root = get_settings().data_dir.resolve()
    path = (root / "signatures" / "managers" / f"manager_{manager_id}.png").resolve()
    if root not in path.parents:
        raise ValueError("invalid manager signature path")
    return path


def has_signature(manager: Manager) -> bool:
    return manager.sig_path is not None and Path(manager.sig_path).is_file()


def save_manager_signature(db: Session, manager_id: int, data: bytes) -> Path:
    """Normalize to PNG, write to the canonical path, record ``sig_path``."""
    mgr = _get_or_404(db, manager_id)
    png = signature_core.normalize_to_png(data)  # raises SignatureError on bad input
    path = manager_signature_path(manager_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    mgr.sig_path = str(path)
    db.commit()
    return path


def delete_manager_signature(db: Session, manager_id: int) -> None:
    """Remove the signature file and null ``sig_path``. Idempotent."""
    mgr = _get_or_404(db, manager_id)
    manager_signature_path(manager_id).unlink(missing_ok=True)
    mgr.sig_path = None
    db.commit()


def manager_user_name(db: Session, manager: Manager) -> str | None:
    """Display name of the linked login account, or None."""
    if manager.user_id is None:
        return None
    from app.services import book_service  # local import — avoids cycle

    return book_service.resolve_user_name_by_id(db, manager.user_id)
