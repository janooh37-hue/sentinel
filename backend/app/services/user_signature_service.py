"""Resolve, save, and clear a person's ONE saved signature.

A user linked to an employee record (``User.employee_id``) has no signature
of their own: their saved signature IS the employee profile file at
``<vault>/<G>/documents/signature.png`` (``signature_core.employee_signature_path``).
An unlinked account keeps its own file under
``data_dir/signatures/<user_id>/signature.png``, tracked by
``User.signature_path`` — until it is linked, at which point
``consolidate_employee_signatures`` migrates it into the profile.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, ValidationFailedError
from app.config import get_settings
from app.core import signature as signature_core
from app.db.models import Manager, Submitter, User

ALLOWED = {".png", ".jpg", ".jpeg"}
MAX_BYTES = signature_core.MAX_BYTES


def _dir(user_id: int) -> Path:
    return get_settings().data_dir / "signatures" / str(user_id)


def _account_path(raw: str | None, data_dir: Path) -> Path | None:
    """Absolute, containment-checked path for an account-scoped/legacy
    pointer, or None if empty, escaped, or missing on disk."""
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute():
        path = data_dir / path
    try:
        resolved = path.resolve()
        root = data_dir.resolve()
    except OSError:
        return None
    if root not in resolved.parents:
        return None
    return resolved if resolved.is_file() else None


def resolve_signature(user: User) -> Path | None:
    """The ONE saved signature file for `user`, or None if it doesn't exist.

    A linked user's signature is always the employee profile file — never the
    account pointer, a manager record, or a submitter row, even if the
    profile file is missing. An unlinked user's signature is its own account
    file, contained under `data_dir`.
    """
    settings = get_settings()
    if not user.employee_id:
        return _account_path(user.signature_path, settings.data_dir)
    try:
        path = signature_core.employee_signature_path(settings.vault_dir, user.employee_id)
    except signature_core.SignatureError:
        return None
    return path if path.is_file() else None


def save_signature(db: Session, user: User, filename: str, data: bytes) -> User:
    """Validate and store `data` as `user`'s saved signature.

    A linked user writes the employee profile file and never recreates
    ``User.signature_path``; an unlinked user writes its own account file.
    Either way, any stale account-scoped file is removed so a later read
    never exposes a superseded signature.
    """
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
    settings = get_settings()
    try:
        png = signature_core.normalize_to_png(data)
        signature_core.validate(png)
        profile = (
            signature_core.employee_signature_path(settings.vault_dir, user.employee_id)
            if user.employee_id
            else None
        )
    except signature_core.SignatureError as exc:
        raise ValidationFailedError("SIG_INVALID", str(exc)) from exc

    stale_account = _account_path(user.signature_path, settings.data_dir)
    if profile is not None:
        profile.parent.mkdir(parents=True, exist_ok=True)
        profile.write_bytes(png)
        user.signature_path = None
    else:
        dest = _dir(user.id) / signature_core.SIGNATURE_FILENAME
        dest.parent.mkdir(parents=True, exist_ok=True)
        # Remove any prior extension variant so we don't leave a stale file.
        for old in dest.parent.glob("signature.*"):
            if old != dest:
                old.unlink(missing_ok=True)
        dest.write_bytes(png)
        profile = dest
        user.signature_path = dest.resolve().relative_to(settings.data_dir.resolve()).as_posix()
    if stale_account is not None and stale_account != profile:
        stale_account.unlink(missing_ok=True)
    db.commit()
    db.refresh(user)
    return user


def clear_signature(db: Session, user: User) -> User:
    """Remove `user`'s saved signature — profile file when linked, account
    file otherwise — and always clear the legacy account pointer/file so a
    delete never leaves a superseded file reachable."""
    stale_account = _account_path(user.signature_path, get_settings().data_dir)
    saved = resolve_signature(user)
    if saved is not None:
        saved.unlink(missing_ok=True)
    if stale_account is not None:
        stale_account.unlink(missing_ok=True)
    user.signature_path = None
    db.commit()
    db.refresh(user)
    return user


def _decode_png(path: Path) -> bytes | None:
    """Normalized+validated PNG bytes for `path`, or None if unreadable."""
    try:
        png = signature_core.normalize_to_png(path.read_bytes())
        signature_core.validate(png)
    except (OSError, signature_core.SignatureError):
        return None
    return png


def _outcome(
    employee_id: str, status: str, *, source: str | None = None, **extra: object
) -> dict[str, object]:
    return {"employee_id": employee_id, "status": status, "source": source, **extra}


def consolidate_employee_signatures(
    db: Session, employee_id: str, *, data_dir: Path, apply: bool = False
) -> dict[str, object]:
    """Reconcile every signature linked to `employee_id` onto ONE profile file.

    An existing profile file always wins byte-for-byte and is never
    overwritten. When absent, precedence among legacy sources is: a linked
    Manager's `sig_path` (also a profile-grade signature) > the linked
    account's `User.signature_path` (an uploaded approval signature) > a
    linked `Submitter.stored_sig_path` (a legacy import). Multiple differing
    valid candidates at the SAME tier are a conflict; an undecodable
    candidate at the highest occupied tier is invalid — neither falls
    through to a lower tier or silently picks one.

    Once a profile is present (pre-existing or freshly migrated) with
    `apply=True`, every discovered linked pointer (manager/user/submitter)
    is cleared, since the profile is now the single source of truth for all
    of them. `apply=False` never touches the filesystem or the session —
    the returned dict predicts the outcome only. Stages changes on the
    passed ORM objects but NEVER commits; the caller controls the
    transaction (and, for a batch run, the backup).

    Uses `data_dir` explicitly (never `get_settings()`/`Vault()`) so a
    read-only dry run never creates a directory as a side effect.
    """
    vault_dir = data_dir / "vault"
    try:
        profile_path = signature_core.employee_signature_path(vault_dir, employee_id)
    except signature_core.SignatureError as exc:
        return _outcome(employee_id, "invalid", reason=str(exc))

    linked_users = list(
        db.execute(select(User).where(User.employee_id == employee_id)).scalars().all()
    )
    linked_managers = (
        list(
            db.execute(select(Manager).where(Manager.user_id.in_([u.id for u in linked_users])))
            .scalars()
            .all()
        )
        if linked_users
        else []
    )
    linked_submitters = list(
        db.execute(select(Submitter).where(Submitter.employee_id == employee_id)).scalars().all()
    )

    def _clear_all() -> list[str]:
        cleared: list[str] = []
        for mgr in linked_managers:
            if mgr.sig_path is not None:
                mgr.sig_path = None
                cleared.append(f"manager:{mgr.id}")
        for usr in linked_users:
            if usr.signature_path is not None:
                usr.signature_path = None
                cleared.append(f"user:{usr.id}")
        for sub in linked_submitters:
            if sub.stored_sig_path is not None:
                sub.stored_sig_path = None
                cleared.append(f"submitter:{sub.id}")
        return cleared

    def _kept(cleared: list[str]) -> dict[str, object]:
        return _outcome(
            employee_id, "profile_kept", profile_path=str(profile_path), cleared=cleared
        )

    if profile_path.is_file():
        return _kept(_clear_all() if apply else [])

    tiers: list[tuple[str, list[str]]] = [
        ("manager", [m.sig_path for m in linked_managers if m.sig_path]),
        ("user", [u.signature_path for u in linked_users if u.signature_path]),
        ("submitter", [s.stored_sig_path for s in linked_submitters if s.stored_sig_path]),
    ]

    for label, raw_pointers in tiers:
        if not raw_pointers:
            continue  # tier genuinely unoccupied — fall through to the next one
        resolved = [p for r in raw_pointers if (p := _account_path(r, data_dir))]
        if not resolved:
            # Occupied but every pointer is dangling (missing/escaped) — report,
            # never silently fall through to a lower tier.
            return _outcome(
                employee_id,
                "invalid",
                source=label,
                reason=f"{len(raw_pointers)} {label} pointer(s) reference missing/escaped file(s)",
            )
        candidates = {png for p in resolved if (png := _decode_png(p)) is not None}
        if not candidates:
            return _outcome(
                employee_id,
                "invalid",
                source=label,
                reason=f"no decodable image among {len(resolved)} {label} candidate(s)",
            )
        if len(candidates) > 1:
            return _outcome(
                employee_id,
                "conflict",
                source=label,
                reason=f"{len(candidates)} differing {label} signatures",
            )
        winner_png = next(iter(candidates))
        migrated = _outcome(
            employee_id, "migrated", source=label, profile_path=str(profile_path), cleared=[]
        )
        if not apply:
            return migrated
        profile_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(profile_path, "xb") as fh:  # exclusive create — never race-overwrite
                fh.write(winner_png)
        except FileExistsError:
            # A profile appeared concurrently — it is now authoritative;
            # leave legacy pointers untouched since we didn't write it.
            return _kept([])
        if profile_path.read_bytes() != winner_png:
            profile_path.unlink(missing_ok=True)
            return _outcome(
                employee_id, "invalid", source=label, reason="write verification failed"
            )
        migrated["cleared"] = _clear_all()
        return migrated

    return _outcome(employee_id, "missing", profile_path=str(profile_path), cleared=[])


def consolidate_or_raise(db: Session, employee_id: str, *, data_dir: Path) -> dict[str, object]:
    """`consolidate_employee_signatures` with `apply=True`; raises 409
    `SIGNATURE_CONSOLIDATION_REQUIRED` instead of silently picking a
    signature when the result is ambiguous or corrupt. Call after staging
    and flushing the employee link, before commit — a raise here discards
    the uncommitted link along with it."""
    result = consolidate_employee_signatures(db, employee_id, data_dir=data_dir, apply=True)
    if result["status"] in ("conflict", "invalid"):
        raise ConflictError(
            "SIGNATURE_CONSOLIDATION_REQUIRED",
            "Multiple differing signatures are linked to this employee; resolve them before linking.",
            employee_id=employee_id,
            reason=result.get("reason"),
        )
    return result
