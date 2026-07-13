"""Manager schemas."""

from __future__ import annotations

from pydantic import BaseModel, model_validator

from app.schemas._base import ORMBase


class ManagerCreate(BaseModel):
    name_en: str | None = None
    name_ar: str | None = None
    title: str | None = None
    active: bool = True
    user_id: int | None = None

    @model_validator(mode="after")
    def _require_a_name(self) -> ManagerCreate:
        if not (self.name_en or "").strip() and not (self.name_ar or "").strip():
            raise ValueError("A manager needs an English or Arabic name.")
        return self


class ManagerUpdate(BaseModel):
    """Partial update. All fields optional. `sig_path` is NOT client-settable."""

    name_en: str | None = None
    name_ar: str | None = None
    title: str | None = None
    active: bool | None = None
    user_id: int | None = None


class ManagerRead(ORMBase):
    id: int
    name_en: str | None
    name_ar: str | None
    title: str | None
    active: bool
    user_id: int | None = None
    user_name: str | None = None
    has_signature: bool = False
    # `sig_path` (a filesystem path) is intentionally NOT exposed.
