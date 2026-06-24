"""Vault upload + listing + thumbnail rendering.

This is the security-sensitive layer (PRD §13: "File upload paths
sanitized — no traversal"). Three hard rules:

1. **Filename sanitization.** We never trust the client-supplied name. We
   take only ``Path(name).name`` and run it through :func:`_safe_filename`
   so traversal sequences (``..``, absolute paths, leading slashes) are
   stripped before the name is joined with a vault subfolder.

2. **Kind whitelist.** Only the five canonical kinds in
   :data:`VAULT_KINDS` are accepted. Unknown kinds get a 400 instead of
   falling back to ``other`` like the file-system module does — services
   are stricter than the underlying ``Vault`` for the same defense-in-depth
   reason.

3. **Resolved-path containment.** After the join we resolve and assert that
   the resulting path sits under the employee's vault root, so symlink
   traversal or path-confusing edge cases (CVE-ish) get caught here even
   if step (1) regresses.

PDF thumbs go through PyMuPDF (``fitz``); we render page 1 at 144 DPI to a
PNG and cache the result under ``<data_dir>/cache/thumbs/<sha1>.png``. The
cache key is the source file's stat (size + mtime), so editing the PDF in
place invalidates the cache automatically.
"""

from __future__ import annotations

import hashlib
import logging
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Final, get_args

import fitz  # PyMuPDF
from sqlalchemy.orm import Session

from app.api.errors import AppError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core.constants import ALLOWED_DOC_EXTS
from app.core.vault_manager import Vault
from app.db.models import Employee, LedgerEntry, VaultFile
from app.schemas.vault_file import VaultEntry, VaultKind, VaultTree

log = logging.getLogger(__name__)

VAULT_KINDS: Final[tuple[VaultKind, ...]] = get_args(VaultKind)

# Hard upload cap. Keeps a single upload from filling disk and matches v3's
# silent assumption that scanned PDFs stay under this size.
MAX_UPLOAD_BYTES: Final[int] = 25 * 1024 * 1024  # 25 MiB
PDF_THUMB_DPI: Final[int] = 144
PDF_THUMB_FORMAT: Final[str] = "png"

# Anything outside this character class is replaced with an underscore. Keeps
# unicode (Arabic filenames) intact while killing path separators / nulls.
_UNSAFE_CHARS = re.compile(
    # Path separators / control chars PLUS unicode bidi-control, zero-width
    # and BOM codepoints that pass ``isalnum`` but enable display-name
    # spoofing (e.g. U+202E RIGHT-TO-LEFT OVERRIDE in a filename).
    "[\\/:*?\"<>|\x00-\x1f"
    "\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]"
)


def _safe_filename(raw: str) -> str:
    """Strip directory components and forbidden chars from ``raw``.

    Empty results (e.g. user uploaded ``../..``) raise — there's no sane
    default name to fall back to.
    """
    # ``Path(raw).name`` already drops directory components, but only against
    # the OS separator. On POSIX the rule is different from Windows, so we do
    # both before falling back to ``Path``.
    candidate = raw.replace("\\", "/").rsplit("/", 1)[-1]
    candidate = Path(candidate).name
    cleaned = _UNSAFE_CHARS.sub("_", candidate).strip(". ")
    if not cleaned:
        raise ValidationFailedError(
            "VAULT_BAD_FILENAME", "Filename is empty or invalid", raw=raw
        )
    return cleaned


def _vault() -> Vault:
    return Vault(get_settings().vault_dir)


def _ensure_kind(kind: str) -> VaultKind:
    if kind not in VAULT_KINDS:
        raise ValidationFailedError(
            "VAULT_BAD_KIND",
            f"Unknown vault folder {kind!r}",
            allowed=list(VAULT_KINDS),
        )
    return kind


def _kind_dir(vault: Vault, g_number: str, kind: VaultKind) -> Path:
    """Resolve and contain. Raises if the resolved path escapes the root."""
    target = vault.path(g_number, kind).resolve()
    root = vault.root.resolve()
    if root not in target.parents and target != root:
        # Defensive — should be unreachable because Vault.path joins under root.
        raise AppError(
            "VAULT_PATH_ESCAPE",
            "Resolved vault path escaped the vault root",
            http_status=500,
        )
    return target


def list_tree(g_number: str) -> VaultTree:
    """Walk the employee's vault folders and return one entry per file."""
    vault = _vault()
    folders: dict[VaultKind, list[VaultEntry]] = {}
    for kind in VAULT_KINDS:
        target = _kind_dir(vault, g_number, kind)
        entries: list[VaultEntry] = []
        if target.is_dir():
            for p in sorted(target.iterdir()):
                if not p.is_file():
                    continue
                if p.suffix.lower() not in ALLOWED_DOC_EXTS:
                    continue
                stat = p.stat()
                entries.append(
                    VaultEntry(
                        filename=p.name,
                        kind=kind,
                        size_bytes=stat.st_size,
                        modified=datetime.fromtimestamp(stat.st_mtime),
                        is_pdf=p.suffix.lower() == ".pdf",
                    )
                )
        folders[kind] = entries
    return VaultTree(employee_id=g_number, folders=folders)


def save_upload(
    g_number: str, kind: str, filename: str, data: bytes
) -> VaultEntry:
    """Persist an uploaded file into the employee's vault."""
    typed_kind = _ensure_kind(kind)
    if len(data) == 0:
        raise ValidationFailedError("VAULT_EMPTY_FILE", "Uploaded file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValidationFailedError(
            "VAULT_FILE_TOO_LARGE",
            f"File exceeds {MAX_UPLOAD_BYTES} bytes",
            max_bytes=MAX_UPLOAD_BYTES,
            size=len(data),
        )

    safe_name = _safe_filename(filename)
    ext = Path(safe_name).suffix.lower()
    if ext not in ALLOWED_DOC_EXTS:
        raise ValidationFailedError(
            "VAULT_BAD_EXTENSION",
            f"File type {ext!r} is not allowed",
            allowed=sorted(ALLOWED_DOC_EXTS),
        )

    vault = _vault()
    target_dir = _kind_dir(vault, g_number, typed_kind)
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = Vault.collision_safe_name(target_dir, safe_name)

    # Final containment check post-join — `collision_safe_name` only appends.
    dest_resolved = dest.resolve()
    if vault.root.resolve() not in dest_resolved.parents:
        raise AppError(
            "VAULT_PATH_ESCAPE",
            "Resolved upload path escaped the vault root",
            http_status=500,
        )

    dest.write_bytes(data)
    stat = dest.stat()
    log.info("vault upload: %s/%s -> %s (%d bytes)", g_number, typed_kind, dest.name, stat.st_size)
    return VaultEntry(
        filename=dest.name,
        kind=typed_kind,
        size_bytes=stat.st_size,
        modified=datetime.fromtimestamp(stat.st_mtime),
        is_pdf=ext == ".pdf",
    )


def resolve_file(g_number: str, kind: str, filename: str) -> Path:
    """Resolve a vault file path. Raises 404 if missing, 422 if traversal."""
    typed_kind = _ensure_kind(kind)
    safe_name = _safe_filename(filename)
    vault = _vault()
    target = _kind_dir(vault, g_number, typed_kind) / safe_name
    resolved = target.resolve()
    if vault.root.resolve() not in resolved.parents:
        raise AppError(
            "VAULT_PATH_ESCAPE", "Resolved path escaped the vault root", http_status=400
        )
    if not resolved.is_file():
        raise NotFoundError(
            "VAULT_FILE_NOT_FOUND",
            f"File {safe_name!r} not found in {typed_kind!r}",
            employee_id=g_number,
            kind=typed_kind,
            filename=safe_name,
        )
    return resolved


def delete_file(db: Session, g_number: str, kind: str, filename: str) -> None:
    path = resolve_file(g_number, kind, filename)
    if not Vault.delete_file(path):
        raise NotFoundError(
            "VAULT_FILE_NOT_FOUND",
            f"File {path.name!r} not found",
            employee_id=g_number,
            filename=path.name,
        )
    # Keep the DB in sync with disk: drop any VaultFile row that tracked this
    # file (imported-from-ledger files persist a row; uploads don't). Without
    # this the row orphans and later 404s when its path is dereferenced.
    rel_to_vault = path.relative_to(_vault().root.resolve()).as_posix()
    db.query(VaultFile).filter(
        VaultFile.employee_id == g_number,
        VaultFile.path == rel_to_vault,
    ).delete(synchronize_session=False)
    db.commit()


# --- PDF thumbnails ---------------------------------------------------------


def _thumb_cache_dir() -> Path:
    d = get_settings().data_dir / "cache" / "thumbs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _thumb_cache_key(pdf_path: Path) -> str:
    """Hash size + mtime + absolute path → cache key.

    Editing the PDF in place changes mtime, which invalidates the cache; the
    absolute path means two employees with same-named files don't collide.
    """
    stat = pdf_path.stat()
    fingerprint = f"{pdf_path.resolve()}|{stat.st_size}|{stat.st_mtime_ns}"
    return hashlib.sha1(fingerprint.encode("utf-8"), usedforsecurity=False).hexdigest()


def render_pdf_thumbnail(pdf_path: Path) -> Path:
    """Render page 1 of ``pdf_path`` to a PNG and cache the result."""
    if pdf_path.suffix.lower() != ".pdf":
        raise ValidationFailedError(
            "VAULT_NOT_A_PDF",
            "Thumbnail preview is only available for PDF files",
            filename=pdf_path.name,
        )

    cache_path = _thumb_cache_dir() / f"{_thumb_cache_key(pdf_path)}.{PDF_THUMB_FORMAT}"
    if cache_path.exists():
        return cache_path

    with fitz.open(pdf_path) as doc:
        if doc.page_count == 0:
            raise ValidationFailedError(
                "VAULT_EMPTY_PDF", "PDF has no pages", filename=pdf_path.name
            )
        page = doc.load_page(0)
        zoom = PDF_THUMB_DPI / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        pix.save(cache_path)
    return cache_path


def preview_image_for(g_number: str, kind: str, filename: str) -> Path:
    """Return a PNG path suitable for ``FileResponse``.

    PDFs go through :func:`render_pdf_thumbnail`; PNG/JPEG inputs are
    returned as-is (the route's ``FileResponse`` handles the streaming).
    """
    src = resolve_file(g_number, kind, filename)
    ext = src.suffix.lower()
    if ext == ".pdf":
        return render_pdf_thumbnail(src)
    if ext in {".png", ".jpg", ".jpeg"}:
        return src
    raise ValidationFailedError(
        "VAULT_PREVIEW_UNSUPPORTED",
        f"No preview generator for {ext!r}",
        filename=src.name,
    )


def import_from_ledger_attachment(
    db: Session,
    *,
    entry_id: int,
    attachment_index: int,
    employee_id: str,
    kind: str,
) -> VaultFile:
    """Copy a ledger attachment into an employee's vault and persist a row.

    Copy semantics (not move): the originating ledger entry keeps its
    attachment on disk so the email still renders correctly. ``kind`` is
    validated against :data:`VAULT_KINDS` and the destination is contained
    under the vault root.
    """
    typed_kind = _ensure_kind(kind)

    employee = db.get(Employee, employee_id)
    if employee is None:
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND",
            f"Employee {employee_id!r} does not exist",
            employee_id=employee_id,
        )

    entry = db.get(LedgerEntry, entry_id)
    if entry is None or entry.deleted_at is not None:
        raise NotFoundError(
            "LEDGER_ENTRY_NOT_FOUND",
            f"Ledger entry {entry_id} does not exist",
            id=entry_id,
        )

    paths = list(entry.attachment_paths or [])
    if attachment_index < 0 or attachment_index >= len(paths):
        raise ValidationFailedError(
            "LEDGER_BAD_ATTACHMENT_INDEX",
            "Attachment index is out of range",
            attachment_index=attachment_index,
            attachment_count=len(paths),
        )

    rel_path = paths[attachment_index]
    data_dir = get_settings().data_dir.resolve()
    source = (data_dir / rel_path).resolve()
    if data_dir not in source.parents:
        raise AppError(
            "LEDGER_PATH_ESCAPE",
            "Resolved source path escaped the data directory",
            http_status=400,
        )
    if not source.is_file():
        raise NotFoundError(
            "LEDGER_ATTACHMENT_FILE_MISSING",
            "Attachment file is missing from disk",
            attachment_index=attachment_index,
        )

    vault = _vault()
    target_dir = _kind_dir(vault, employee_id, typed_kind)
    target_dir.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_filename(source.name)
    dest = Vault.collision_safe_name(target_dir, safe_name)

    dest_resolved_parent = dest.parent.resolve()
    if vault.root.resolve() not in dest_resolved_parent.parents and dest_resolved_parent != vault.root.resolve():
        raise AppError(
            "VAULT_PATH_ESCAPE",
            "Resolved destination path escaped the vault root",
            http_status=500,
        )

    shutil.copy2(source, dest)
    size_bytes = dest.stat().st_size
    rel_to_vault = dest.resolve().relative_to(vault.root.resolve()).as_posix()

    row = VaultFile(
        employee_id=employee_id,
        kind=typed_kind,
        filename=dest.name,
        path=rel_to_vault,
        size_bytes=size_bytes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    log.info(
        "ledger->vault: entry=%d idx=%d -> %s/%s (%d bytes)",
        entry_id, attachment_index, employee_id, typed_kind, size_bytes,
    )
    return row


def import_bytes(
    db: Session, *, employee_id: str, kind: str, filename: str, data: bytes
) -> VaultFile:
    """Write ``data`` into the employee vault AND persist a ``VaultFile`` row.

    Mirrors ``save_upload``'s validation/containment but creates the DB row (which
    ``save_upload`` does not). Used by the Scan Inbox to file an employee document.
    """
    typed_kind = _ensure_kind(kind)
    if len(data) == 0:
        raise ValidationFailedError("VAULT_EMPTY_FILE", "Uploaded file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValidationFailedError(
            "VAULT_FILE_TOO_LARGE", f"File exceeds {MAX_UPLOAD_BYTES} bytes",
            max_bytes=MAX_UPLOAD_BYTES, size=len(data),
        )
    safe_name = _safe_filename(filename)
    ext = Path(safe_name).suffix.lower()
    if ext not in ALLOWED_DOC_EXTS:
        raise ValidationFailedError(
            "VAULT_BAD_EXTENSION", f"File type {ext!r} is not allowed",
            allowed=sorted(ALLOWED_DOC_EXTS),
        )
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise NotFoundError("EMPLOYEE_NOT_FOUND", f"No employee {employee_id!r}")

    vault = _vault()
    target_dir = _kind_dir(vault, employee_id, typed_kind)
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = Vault.collision_safe_name(target_dir, safe_name)
    dest_resolved = dest.resolve()
    if vault.root.resolve() not in dest_resolved.parents:
        raise AppError("VAULT_PATH_ESCAPE", "Resolved upload path escaped the vault root", http_status=500)
    dest.write_bytes(data)
    rel_to_vault = dest_resolved.relative_to(vault.root.resolve()).as_posix()

    row = VaultFile(
        employee_id=employee_id, kind=typed_kind, filename=dest.name,
        path=rel_to_vault, size_bytes=dest.stat().st_size,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    log.info(
        "vault import_bytes: %s/%s -> %s (%d bytes)",
        employee_id, typed_kind, dest.name, dest.stat().st_size,
    )
    return row


def delete_vault_file(db: Session, vault_file_id: int) -> None:
    """Delete a VaultFile row and its on-disk file (UNDO of import_bytes)."""
    row = db.get(VaultFile, vault_file_id)
    if row is None:
        return
    abs_path = (_vault().root / row.path).resolve()
    db.delete(row)
    db.commit()
    try:
        if abs_path.is_file():
            abs_path.unlink()
    except OSError:
        log.warning("delete_vault_file: could not unlink %s", abs_path)


__all__ = [
    "MAX_UPLOAD_BYTES",
    "VAULT_KINDS",
    "delete_file",
    "delete_vault_file",
    "import_bytes",
    "import_from_ledger_attachment",
    "list_tree",
    "preview_image_for",
    "render_pdf_thumbnail",
    "resolve_file",
    "save_upload",
]
