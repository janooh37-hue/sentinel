"""Correspondence-log admin: categories + rules CRUD — Ledger→Outlook Phase 3.

All routes gated ``settings.edit``. The auto-log rows these rules produce are
read via the ledger router (``GET /ledger/log``).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.correspondence import (
    CorrespondenceCategoryCreate,
    CorrespondenceCategoryRead,
    CorrespondenceCategoryUpdate,
    CorrespondenceRuleCreate,
    CorrespondenceRuleRead,
    CorrespondenceRuleUpdate,
)
from app.services import correspondence_service

router = APIRouter(prefix="/correspondence", tags=["correspondence"])


# ─── Categories ──────────────────────────────────────────────────────────────


@router.get("/categories", response_model=list[CorrespondenceCategoryRead])
def list_categories(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> list[CorrespondenceCategoryRead]:
    return [
        CorrespondenceCategoryRead.model_validate(c)
        for c in correspondence_service.list_categories(db)
    ]


@router.post(
    "/categories",
    response_model=CorrespondenceCategoryRead,
    status_code=status.HTTP_201_CREATED,
)
def create_category(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
    payload: CorrespondenceCategoryCreate,
) -> CorrespondenceCategoryRead:
    row = correspondence_service.create_category(
        db,
        key=payload.key,
        name_en=payload.name_en,
        name_ar=payload.name_ar,
        sort=payload.sort,
    )
    return CorrespondenceCategoryRead.model_validate(row)


@router.patch("/categories/{category_id}", response_model=CorrespondenceCategoryRead)
def update_category(
    category_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
    payload: CorrespondenceCategoryUpdate,
) -> CorrespondenceCategoryRead:
    row = correspondence_service.update_category(
        db, category_id, **payload.model_dump(exclude_unset=True)
    )
    return CorrespondenceCategoryRead.model_validate(row)


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> Response:
    correspondence_service.delete_category(db, category_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ─── Rules ───────────────────────────────────────────────────────────────────


@router.get("/rules", response_model=list[CorrespondenceRuleRead])
def list_rules(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> list[CorrespondenceRuleRead]:
    return [
        CorrespondenceRuleRead.model_validate(r)
        for r in correspondence_service.list_rules(db)
    ]


@router.post(
    "/rules",
    response_model=CorrespondenceRuleRead,
    status_code=status.HTTP_201_CREATED,
)
def create_rule(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
    payload: CorrespondenceRuleCreate,
) -> CorrespondenceRuleRead:
    row = correspondence_service.create_rule(
        db,
        trigger=payload.trigger,
        condition_json=payload.condition_json,
        category_id=payload.category_id,
        enabled=payload.enabled,
        sort=payload.sort,
    )
    return CorrespondenceRuleRead.model_validate(row)


@router.patch("/rules/{rule_id}", response_model=CorrespondenceRuleRead)
def update_rule(
    rule_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
    payload: CorrespondenceRuleUpdate,
) -> CorrespondenceRuleRead:
    row = correspondence_service.update_rule(
        db, rule_id, **payload.model_dump(exclude_unset=True)
    )
    return CorrespondenceRuleRead.model_validate(row)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(
    rule_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> Response:
    correspondence_service.delete_rule(db, rule_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
