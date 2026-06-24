"""Store/clear a user's signature image under data_dir/signatures/<user_id>/."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from app.api.errors import ValidationFailedError
from app.config import get_settings
from app.db.models import User

ALLOWED = {".png", ".jpg", ".jpeg"}
MAX_BYTES = 5 * 1024 * 1024


def _dir(user_id: int) -> Path:
    return get_settings().data_dir / "signatures" / str(user_id)


def save_signature(db: Session, user: User, filename: str, data: bytes) -> User:
    if not data:
        raise ValidationFailedError("SIG_EMPTY", "Uploaded signature is empty")
    if len(data) > MAX_BYTES:
        raise ValidationFailedError("SIG_TOO_LARGE", "Signature exceeds 5 MiB")
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED:
        raise ValidationFailedError(
            "SIG_BAD_TYPE",
            "Signature must be PNG or JPEG",
            allowed=sorted(ALLOWED),
        )
    target = _dir(user.id)
    target.mkdir(parents=True, exist_ok=True)
    dest = target / f"signature{ext}"
    # Remove any prior extension variant so we don't leave a stale file.
    for old in target.glob("signature.*"):
        if old != dest:
            old.unlink(missing_ok=True)
    dest.write_bytes(data)
    user.signature_path = (
        dest.resolve()
        .relative_to(get_settings().data_dir.resolve())
        .as_posix()
    )
    db.commit()
    db.refresh(user)
    return user


def clear_signature(db: Session, user: User) -> User:
    if user.signature_path:
        abs_path = get_settings().data_dir / user.signature_path
        abs_path.unlink(missing_ok=True)
    user.signature_path = None
    db.commit()
    db.refresh(user)
    return user
