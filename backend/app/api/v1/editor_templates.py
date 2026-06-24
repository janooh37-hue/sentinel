"""Editor template endpoints — reusable HugeRTE HTML snippets.

All routes are prefixed ``/editor-templates`` and wired into ``main.py`` under
``/api/v1``.

Endpoints:
  GET    /editor-templates           — filtered + paginated list
  GET    /editor-templates/{id}      — single template (full, with html)
  POST   /editor-templates           — create
  PATCH  /editor-templates/{id}      — partial update
  DELETE /editor-templates/{id}      — soft-delete (204)
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.editor_template import (
    EditorTemplateCreate,
    EditorTemplateListItem,
    EditorTemplateListResponse,
    EditorTemplateRead,
    EditorTemplateUpdate,
)
from app.services import editor_template_service
from app.services.editor_template_service import LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT

router = APIRouter(prefix="/editor-templates", tags=["editor-templates"])


@router.get("", response_model=EditorTemplateListResponse)
def list_templates(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("editor_templates.manage"))],
    q: str | None = None,
    include_deleted: bool = False,
    limit: int = Query(LIST_DEFAULT_LIMIT, ge=1, le=LIST_MAX_LIMIT),
    offset: int = Query(0, ge=0),
) -> EditorTemplateListResponse:
    rows, total = editor_template_service.list_templates(
        db,
        q=q,
        include_deleted=include_deleted,
        limit=limit,
        offset=offset,
    )
    return EditorTemplateListResponse(
        items=[EditorTemplateListItem.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{template_id}", response_model=EditorTemplateRead)
def get_template(
    template_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("editor_templates.manage"))],
    include_deleted: bool = False,
) -> EditorTemplateRead:
    row = editor_template_service.get_template(
        db, template_id, include_deleted=include_deleted
    )
    return EditorTemplateRead.model_validate(row)


@router.post(
    "", response_model=EditorTemplateRead, status_code=status.HTTP_201_CREATED
)
def create_template(
    payload: EditorTemplateCreate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("editor_templates.manage"))],
) -> EditorTemplateRead:
    row = editor_template_service.create_template(db, payload)
    return EditorTemplateRead.model_validate(row)


@router.patch("/{template_id}", response_model=EditorTemplateRead)
def update_template(
    template_id: int,
    payload: EditorTemplateUpdate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("editor_templates.manage"))],
) -> EditorTemplateRead:
    row = editor_template_service.update_template(db, template_id, payload)
    return EditorTemplateRead.model_validate(row)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("editor_templates.manage"))],
) -> Response:
    editor_template_service.soft_delete_template(db, template_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
