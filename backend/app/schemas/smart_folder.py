"""Pydantic schemas for per-user smart folders (saved subject filters)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SmartFolderRead(BaseModel):
    """An active smart folder with its live matching-entry count."""

    id: int
    name_en: str
    name_ar: str
    count: int


class SmartFolderSuggestion(BaseModel):
    """A suggested subject cluster the caller could turn into a folder."""

    cluster_key: str
    name_suggestion: str
    count: int
    correspondent_count: int
    sample_subjects: list[str]


class SmartFolderCreate(BaseModel):
    """Payload to create a folder (confirmed). Owner comes from the session."""

    name_en: str = Field(min_length=1, max_length=128)
    name_ar: str = Field(min_length=1, max_length=128)
    rule_kind: Literal["subject"] = "subject"
    rule_value: str = Field(min_length=1, max_length=255)


class SmartFolderDismiss(BaseModel):
    """Payload to dismiss a suggestion cluster (per-user)."""

    cluster_key: str = Field(min_length=1, max_length=255)


class SmartFolderUpdate(BaseModel):
    """Partial rename — either/both localized names."""

    name_en: str | None = Field(default=None, min_length=1, max_length=128)
    name_ar: str | None = Field(default=None, min_length=1, max_length=128)


__all__ = [
    "SmartFolderCreate",
    "SmartFolderDismiss",
    "SmartFolderRead",
    "SmartFolderSuggestion",
    "SmartFolderUpdate",
]
