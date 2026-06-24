"""VaultFile schemas — file system index entries."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase

# Vault subfolders exposed via the API. Must mirror the directories created by
# ``app.core.vault_manager.Vault.ensure_folder``.
VaultKind = Literal["uae_id", "passport", "other", "leaves", "violations"]


class VaultFileCreate(BaseModel):
    employee_id: str
    kind: str = Field(min_length=1)
    filename: str = Field(min_length=1)
    path: str = Field(min_length=1)
    size_bytes: int | None = Field(default=None, ge=0)


class VaultFileRead(ORMBase):
    id: int
    employee_id: str
    kind: VaultKind
    filename: str
    path: str
    size_bytes: int | None
    created_at: datetime


class VaultEntry(BaseModel):
    """Represents one file inside a vault folder.

    Built directly from filesystem listings since v3 didn't index files in
    SQLite — we follow the same pattern in Phase 03 (vault_files table fills
    up only on POST upload, and the GET tree walks the disk).
    """

    filename: str
    kind: VaultKind
    size_bytes: int
    modified: datetime
    is_pdf: bool


class VaultTree(BaseModel):
    """Tree returned by ``GET /employees/{id}/vault``.

    Each key is a :class:`VaultKind` and the value is the file list. Order is
    stable: ``uae_id``, ``passport``, ``other``, ``leaves``, ``violations``.
    """

    employee_id: str
    folders: dict[VaultKind, list[VaultEntry]]
