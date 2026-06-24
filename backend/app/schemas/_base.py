"""Shared Pydantic config for ORM-backed Read schemas."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ORMBase(BaseModel):
    """Base for Read schemas — pulls fields off SQLAlchemy rows directly."""

    model_config = ConfigDict(from_attributes=True)
