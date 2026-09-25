"""Manager service — CRUD + signature-file management + picker support."""

from __future__ import annotations

import contextlib
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError
from app.config import get_settings
from app.core import signature as signature_core
from app.db.models import Manager, User
from app.schemas.manager import ManagerCreate, ManagerUpdate
from app.services import user_signature_service


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
    db.flush()
    if mgr.user_id is not None:
        linked = db.get(User, mgr.user_id)
        if linked is not None and linked.employee_id:
            user_signature_service.consolidate_or_raise(
                db, linked.employee_id, data_dir=get_settings().data_dir
            )
    db.commit()
    db.refresh(mgr)
    return mgr


def update_manager(db: Session, manager_id: int, data: ManagerUpdate) -> Manager:
    """Partial update. Only fields explicitly set on ``data`` are written."""
    mgr = _get_or_404(db, manager_id)
    changes = data.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(mgr, field, value)
    if "user_id" in changes and mgr.user_id is not None:
        db.flush()
        linked = db.get(User, mgr.user_id)
        if linked is not None and linked.employee_id:
            user_signature_service.consolidate_or_raise(
                db, linked.employee_id, data_dir=get_settings().data_dir
            )
    db.commit()
    db.refresh(mgr)
    return mgr


def manager_signature_path(manager_id: int) -> Path:
    """Canonical STANDALONE signature file for a manager, with containment
    guard. Only used when the manager has no linked-account employee
    profile — see `signature_path`."""
    root = get_settings().data_dir.resolve()
    path = (root / "signatures" / "managers" / f"manager_{manager_id}.png").resolve()
    if root not in path.parents:
        raise ValueError("invalid manager signature path")
    return path


def _profile_path(db: Session, manager: Manager) -> Path | None:
    """Employee profile signature path when `manager` is linked to a login
    account carrying an employee record, else None."""
    if manager.user_id is None:
        return None
    linked = db.get(User, manager.user_id)
    if linked is None or not linked.employee_id:
        return None
    return signature_core.employee_signature_path(get_settings().vault_dir, linked.employee_id)


def signature_path(db: Session, manager: Manager) -> Path:
    """Canonical signature file for `manager`.

    A manager linked to a login account with an employee profile shares that
    employee's saved signature — even when the file doesn't exist yet, so a
    deleted profile signature never falls back to a stale manager-only image.
    An unlinked (names-only) manager keeps its own file: a legacy `sig_path`
    written before the canonical layout still wins while it exists, since
    nothing migrates those rows."""
    profile = _profile_path(db, manager)
    if profile is not None:
        return profile
    if manager.sig_path and Path(manager.sig_path).is_file():
        return Path(manager.sig_path)
    return manager_signature_path(manager.id)


def signature_str(db: Session, manager: Manager) -> str | None:
    """`signature_path` as a string when the file exists, else None — what
    the DOCX templates and the manager-signature gate both need."""
    try:
        path = signature_path(db, manager)
    except signature_core.SignatureError:
        return None
    return str(path) if path.is_file() else None


def has_signature(db: Session, manager: Manager) -> bool:
    return signature_str(db, manager) is not None


def save_manager_signature(db: Session, manager_id: int, data: bytes) -> Path:
    """Normalize to PNG and write to the manager's canonical signature path.

    A manager linked to an account with an employee profile writes THAT file
    (and drops any legacy standalone `sig_path`) instead of a second
    manager-only image. A standalone manager keeps its own file/`sig_path`.
    """
    mgr = _get_or_404(db, manager_id)
    png = signature_core.normalize_to_png(data)  # raises SignatureError on bad input
    signature_core.validate(png)
    profile = _profile_path(db, mgr)
    path = profile or manager_signature_path(manager_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    if profile is not None:
        # Profile file is the only copy now — retire the manager-only one.
        manager_signature_path(manager_id).unlink(missing_ok=True)
    mgr.sig_path = None if profile is not None else str(path)
    db.commit()
    return path


def delete_manager_signature(db: Session, manager_id: int) -> None:
    """Remove the manager's signature file and null `sig_path`. Idempotent.

    A linked manager's delete removes the employee profile file — the SAME
    file the linked account and employee profile use. Any legacy standalone
    file goes either way."""
    mgr = _get_or_404(db, manager_id)
    with contextlib.suppress(signature_core.SignatureError):
        signature_path(db, mgr).unlink(missing_ok=True)
    manager_signature_path(manager_id).unlink(missing_ok=True)
    mgr.sig_path = None
    db.commit()


def manager_user_name(db: Session, manager: Manager) -> str | None:
    """Display name of the linked login account, or None."""
    if manager.user_id is None:
        return None
    from app.services import book_service  # local import — avoids cycle

    return book_service.resolve_user_name_by_id(db, manager.user_id)
