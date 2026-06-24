"""Schemas for the v3 → v4 migration endpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class MigrationStatus(BaseModel):
    has_db: bool
    has_data: bool
    v3_data_dir_detected: str | None
    last_migration: datetime | None


class MigrateRequest(BaseModel):
    v3_data_dir: str
    dry_run: bool = False


class MigrationResult(BaseModel):
    dry_run: bool
    employees: int
    leaves: int
    books: int
    vault_files: int
    violations: int
    backup_path: str | None
