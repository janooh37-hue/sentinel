"""Editor template service — CRUD for reusable HugeRTE HTML snippets.

Pure functions (no class wrapper) so call-sites can compose freely.  Name
uniqueness is enforced at the application layer against non-deleted rows so a
soft-deleted name can be re-used by a fresh row (matches the partial unique
index in migration 0008).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError, ValidationFailedError
from app.db.models import EditorTemplate
from app.schemas.editor_template import EditorTemplateCreate, EditorTemplateUpdate

log = logging.getLogger(__name__)

LIST_DEFAULT_LIMIT = 100
LIST_MAX_LIMIT = 500


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------


def list_templates(
    db: Session,
    *,
    q: str | None = None,
    include_deleted: bool = False,
    limit: int = LIST_DEFAULT_LIMIT,
    offset: int = 0,
) -> tuple[list[EditorTemplate], int]:
    """Filtered + paginated list. Returns ``(rows, total_count)``."""
    limit = max(1, min(limit, LIST_MAX_LIMIT))
    offset = max(0, offset)

    stmt = select(EditorTemplate)
    count_stmt = select(func.count()).select_from(EditorTemplate)

    if not include_deleted:
        stmt = stmt.where(EditorTemplate.deleted_at.is_(None))
        count_stmt = count_stmt.where(EditorTemplate.deleted_at.is_(None))

    if q:
        needle = f"%{q.strip()}%"
        stmt = stmt.where(EditorTemplate.name.ilike(needle))
        count_stmt = count_stmt.where(EditorTemplate.name.ilike(needle))

    stmt = stmt.order_by(EditorTemplate.name.asc()).limit(limit).offset(offset)

    rows = list(db.execute(stmt).scalars().all())
    total = int(db.execute(count_stmt).scalar_one())
    return rows, total


def get_template(
    db: Session,
    template_id: int,
    *,
    include_deleted: bool = False,
) -> EditorTemplate:
    row = db.get(EditorTemplate, template_id)
    if row is None:
        raise NotFoundError(
            "EDITOR_TEMPLATE_NOT_FOUND",
            f"Editor template {template_id} does not exist",
            id=template_id,
        )
    if not include_deleted and row.deleted_at is not None:
        raise NotFoundError(
            "EDITOR_TEMPLATE_NOT_FOUND",
            f"Editor template {template_id} has been deleted",
            id=template_id,
        )
    return row


# ---------------------------------------------------------------------------
# Write helpers
# ---------------------------------------------------------------------------


def _assert_name_available(
    db: Session,
    name: str,
    *,
    exclude_id: int | None = None,
) -> None:
    """Raise if ``name`` is taken by an active (non-deleted) row."""
    stmt = select(EditorTemplate.id).where(
        EditorTemplate.name == name,
        EditorTemplate.deleted_at.is_(None),
    )
    if exclude_id is not None:
        stmt = stmt.where(EditorTemplate.id != exclude_id)
    existing = db.execute(stmt).scalar_one_or_none()
    if existing is not None:
        raise ValidationFailedError(
            "EDITOR_TEMPLATE_NAME_TAKEN",
            f"An editor template with name {name!r} already exists",
            name=name,
        )


def create_template(db: Session, payload: EditorTemplateCreate) -> EditorTemplate:
    _assert_name_available(db, payload.name)

    row = EditorTemplate(
        name=payload.name,
        html=payload.html,
        created_at=_utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_template(
    db: Session,
    template_id: int,
    payload: EditorTemplateUpdate,
) -> EditorTemplate:
    row = get_template(db, template_id)
    data: dict[str, Any] = payload.model_dump(exclude_unset=True)

    if "name" in data and data["name"] is not None and data["name"] != row.name:
        _assert_name_available(db, data["name"], exclude_id=row.id)

    for k, v in data.items():
        if v is None:
            # PATCH semantics: skip explicit-None fields so callers can't blank
            # required columns (name/html are NOT NULL).
            continue
        setattr(row, k, v)
    row.updated_at = _utcnow()
    db.commit()
    db.refresh(row)
    return row


def soft_delete_template(db: Session, template_id: int) -> None:
    row = get_template(db, template_id)
    row.deleted_at = _utcnow()
    db.commit()


__all__ = [
    "LIST_DEFAULT_LIMIT",
    "LIST_MAX_LIMIT",
    "create_template",
    "get_template",
    "list_templates",
    "soft_delete_template",
    "update_template",
]
