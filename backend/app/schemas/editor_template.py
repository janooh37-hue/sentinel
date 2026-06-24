"""Pydantic schemas for EditorTemplate — reusable HugeRTE snippets."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase

# HTML payloads can be large (saved letter bodies, etc.) but a hard cap keeps
# any single row from blowing up the SQLite page cache.
_HTML_MAX_LEN = 1_000_000


# ---------------------------------------------------------------------------
# Write schemas
# ---------------------------------------------------------------------------


class EditorTemplateCreate(BaseModel):
    """Fields accepted when saving a new snippet."""

    name: str = Field(min_length=1, max_length=128)
    html: str = Field(min_length=0, max_length=_HTML_MAX_LEN)


class EditorTemplateUpdate(BaseModel):
    """All fields optional — partial update (PATCH semantics)."""

    name: str | None = Field(default=None, min_length=1, max_length=128)
    html: str | None = Field(default=None, max_length=_HTML_MAX_LEN)


# ---------------------------------------------------------------------------
# Read schemas
# ---------------------------------------------------------------------------


class EditorTemplateRead(ORMBase):
    """Full row — returned by GET /{id}, POST, and PATCH."""

    id: int
    name: str
    html: str
    created_at: datetime
    updated_at: datetime | None
    deleted_at: datetime | None


class EditorTemplateListItem(ORMBase):
    """Slim projection for list views — omits ``html`` (can be large)."""

    id: int
    name: str
    created_at: datetime
    updated_at: datetime | None
    deleted_at: datetime | None


class EditorTemplateListResponse(BaseModel):
    items: list[EditorTemplateListItem]
    total: int
    limit: int
    offset: int


__all__ = [
    "EditorTemplateCreate",
    "EditorTemplateListItem",
    "EditorTemplateListResponse",
    "EditorTemplateRead",
    "EditorTemplateUpdate",
]
