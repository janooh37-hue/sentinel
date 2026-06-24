"""Employee photo lifecycle — the avatar served by GET /employees/{id}/photo.

Unlike documents (disk-walked by ``vault_service.list_tree``), the avatar is
resolved from a ``VaultFile`` row with ``kind='photo'``. The generic vault
upload path deliberately rejects ``kind='photo'`` and never writes rows, so
photos get their own writer here: it stores the file under
``<vault>/<G>/photo/`` AND upserts a single tracking row, replacing any prior
photo so there is always at most one.
"""

from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import ValidationFailedError
from app.config import get_settings
from app.core.vault_manager import Vault
from app.db.models import VaultFile

log = logging.getLogger(__name__)

PHOTO_KIND = "photo"
ALLOWED_PHOTO_EXTS = frozenset({".png", ".jpg", ".jpeg"})
MAX_PHOTO_BYTES = 25 * 1024 * 1024  # 25 MiB — matches vault_service upload cap


def _vault() -> Vault:
    return Vault(get_settings().vault_dir)


def get_photo_version(db: Session, employee_id: str) -> str | None:
    """Cache-bust token (the photo row id as str), or None when no photo."""
    row_id = db.execute(
        select(VaultFile.id)
        .where(VaultFile.employee_id == employee_id, VaultFile.kind == PHOTO_KIND)
        .order_by(VaultFile.created_at.asc())
        .limit(1)
    ).scalar_one_or_none()
    return str(row_id) if row_id is not None else None


def _purge_existing(db: Session, employee_id: str) -> None:
    """Delete every existing photo row + its on-disk file (within the vault)."""
    root = _vault().root.resolve()
    rows = db.execute(
        select(VaultFile).where(
            VaultFile.employee_id == employee_id, VaultFile.kind == PHOTO_KIND
        )
    ).scalars().all()
    for row in rows:
        abs_path = (root / row.path).resolve()
        if root in abs_path.parents and abs_path.is_file():
            # Best-effort: on Windows the just-served photo can still be locked
            # (FileResponse handle, AV, IDM). A leftover orphan is harmless —
            # the new photo gets a fresh collision-safe name and the row below
            # is removed regardless — so never let an unlink failure abort the
            # replace.
            try:
                abs_path.unlink()
            except OSError:
                log.warning("photo purge: could not unlink %s", abs_path, exc_info=True)
        db.delete(row)


def save_photo(
    db: Session, employee_id: str, filename: str, data: bytes
) -> VaultFile:
    """Replace the employee's photo. Returns the new VaultFile row."""
    if len(data) == 0:
        raise ValidationFailedError("VAULT_EMPTY_FILE", "Uploaded file is empty")
    if len(data) > MAX_PHOTO_BYTES:
        raise ValidationFailedError(
            "VAULT_FILE_TOO_LARGE",
            f"File exceeds {MAX_PHOTO_BYTES} bytes",
            max_bytes=MAX_PHOTO_BYTES,
            size=len(data),
        )
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_PHOTO_EXTS:
        raise ValidationFailedError(
            "PHOTO_BAD_EXTENSION",
            f"Photo type {ext!r} is not allowed",
            allowed=sorted(ALLOWED_PHOTO_EXTS),
        )

    _purge_existing(db, employee_id)

    vault = _vault()
    photo_dir = vault.emp_root(employee_id) / PHOTO_KIND
    photo_dir.mkdir(parents=True, exist_ok=True)
    dest = Vault.collision_safe_name(photo_dir, f"photo{ext}")
    dest.write_bytes(data)

    rel = dest.resolve().relative_to(vault.root.resolve()).as_posix()
    row = VaultFile(
        employee_id=employee_id,
        kind=PHOTO_KIND,
        filename=dest.name,
        path=rel,
        size_bytes=dest.stat().st_size,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_photo(db: Session, employee_id: str) -> None:
    """Remove the employee's photo (file + row). Idempotent."""
    _purge_existing(db, employee_id)
    db.commit()
