"""Shared General Book boilerplate-template library — a flat folder of
tokenized .docx files. Stored templates are UNTRUSTED (see
book_template_retokenize); names are sanitized hard because they become
filenames on a Windows host."""

from __future__ import annotations

import contextlib
import os
import shutil
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from docx import Document as DocxDocument
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.config import get_settings
from app.core.book_table import normalized_table_columns
from app.core.book_template_retokenize import (
    retokenize_general_book,
    validate_book_template,
)
from app.db.models import Book, BookVersion, Document, User
from app.services.vault_service import _safe_filename

_RESERVED = (
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)


@dataclass
class TemplateInfo:
    name: str
    modified_at: datetime


def templates_dir() -> Path:
    d = get_settings().data_dir / "book_templates"
    d.mkdir(parents=True, exist_ok=True)
    return d


def safe_template_name(raw: str) -> str:
    nfc = unicodedata.normalize("NFC", raw)
    # Reject traversal: any path separator or a trailing dot (Windows device/dir risk).
    # ponytail: explicit reject before _safe_filename strips them silently —
    # _safe_filename normalises "a/b"→"b" and "name."→"name", both losing info;
    # callers expect a hard 422 for these inputs per the tests.
    if "/" in nfc or "\\" in nfc or nfc.endswith("."):
        raise AppError("TEMPLATE_BAD_NAME", "اسم القالب غير صالح", http_status=422)
    try:
        cleaned = _safe_filename(nfc)
    except Exception as exc:
        raise AppError("TEMPLATE_BAD_NAME", "اسم القالب غير صالح", http_status=422) from exc
    stem = cleaned.rsplit(".", 1)[0] if "." in cleaned else cleaned
    if not stem or stem.upper() in _RESERVED:
        raise AppError("TEMPLATE_BAD_NAME", "اسم القالب غير صالح", http_status=422)
    if not cleaned.lower().endswith(".docx"):
        cleaned = f"{stem}.docx"
    return cleaned


def list_templates() -> list[TemplateInfo]:
    items = [
        TemplateInfo(
            name=p.name,
            modified_at=datetime.fromtimestamp(p.stat().st_mtime, tz=UTC).replace(tzinfo=None),
        )
        for p in templates_dir().iterdir()
        if p.is_file() and p.suffix.lower() == ".docx"
    ]
    items.sort(key=lambda t: t.modified_at, reverse=True)
    return items


def resolve_template_path(name: str) -> Path:
    return templates_dir() / safe_template_name(name)


def _source_docx_of(db: Session, book: Book) -> Path:
    latest = (
        db.query(BookVersion)
        .filter_by(book_id=book.id)
        .order_by(BookVersion.version_no.desc())
        .first()
    )
    if latest is None or latest.document_id is None:
        raise AppError("NO_SOURCE_DOCX", "الكتاب لا يحتوي نسخة منتهية", http_status=409)
    doc = db.get(Document, latest.document_id)
    if doc is None or not doc.docx_path:
        raise AppError("NO_SOURCE_DOCX", "ملف الكتاب غير موجود", http_status=409)
    if doc.template_id != "General Book":
        raise AppError("NOT_A_GENERAL_BOOK", "حفظ كقالب متاح لكتب عامة فقط", http_status=409)
    p = Path(doc.docx_path)
    if not p.is_absolute():  # rich path stores data_dir-relative
        p = get_settings().data_dir / p
    if not p.exists():
        raise AppError("NO_SOURCE_DOCX", "ملف الكتاب غير موجود", http_status=409)
    return p


def save_book_as_template(db: Session, *, book_id: int, name: str) -> TemplateInfo:
    book = db.get(Book, book_id)
    if book is None:
        raise AppError("BOOK_NOT_FOUND", f"الكتاب {book_id} غير موجود", http_status=404)
    src = _source_docx_of(db, book)

    submitter_g: str | None = None
    if book.submitted_by_user_id is not None:
        submitter = db.get(User, book.submitted_by_user_id)
        submitter_g = submitter.employee_id if submitter else None

    dest = templates_dir() / safe_template_name(name)
    tmp = templates_dir() / f".tmp-{uuid.uuid4().hex}.docx"
    try:
        shutil.copy2(src, tmp)
        try:
            retokenize_general_book(tmp, submitter_g=submitter_g)
            validate_book_template(tmp)
        except ValueError as exc:
            raise AppError("TEMPLATE_INVALID", str(exc), http_status=422) from exc
        # Exclusive create — atomic 409 on collision (NTFS handles case folding).
        try:
            fd = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0))
        except FileExistsError:
            raise AppError("TEMPLATE_EXISTS", "يوجد قالب بهذا الاسم", http_status=409) from None
        with os.fdopen(fd, "wb") as f:
            f.write(tmp.read_bytes())
    finally:
        tmp.unlink(missing_ok=True)
    return TemplateInfo(
        name=dest.name,
        modified_at=datetime.fromtimestamp(dest.stat().st_mtime, tz=UTC).replace(tzinfo=None),
    )


def rename_template(old: str, new: str) -> TemplateInfo:
    """Rename a library template. Same hard name sanitation as save; atomic
    collision check via exclusive create semantics (NTFS case-folds)."""
    src = templates_dir() / safe_template_name(old)
    if not src.is_file():
        raise AppError("TEMPLATE_NOT_FOUND", "القالب غير موجود", http_status=404)
    dest = templates_dir() / safe_template_name(new)
    if dest == src:
        return TemplateInfo(
            name=src.name,
            modified_at=datetime.fromtimestamp(src.stat().st_mtime, tz=UTC).replace(tzinfo=None),
        )
    try:
        fd = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0))
    except FileExistsError:
        raise AppError("TEMPLATE_EXISTS", "يوجد قالب بهذا الاسم", http_status=409) from None
    os.close(fd)
    try:
        os.replace(src, dest)
    except OSError:
        # Don't leave the 0-byte O_EXCL placeholder behind — it would show up
        # as a corrupt "template" and permanently 409 this name.
        with contextlib.suppress(OSError):
            dest.unlink(missing_ok=True)
        raise
    return TemplateInfo(
        name=dest.name,
        modified_at=datetime.fromtimestamp(dest.stat().st_mtime, tz=UTC).replace(tzinfo=None),
    )


def table_schema_for(name: str) -> tuple[bool, list[str]]:
    """Return (has_table, columns) for a library template.

    Uses normalized_table_columns (not detect_table_schema) because stored
    templates are already retokenized — their table has directive rows that
    cause detect_table_schema to return None.

    Raises AppError 404 if the template file does not exist.
    """
    path = resolve_template_path(name)
    if not path.is_file():
        raise AppError("TEMPLATE_NOT_FOUND", "القالب غير موجود", http_status=404)
    doc = DocxDocument(str(path))
    cols = normalized_table_columns(doc)
    if cols is None:
        return (False, [])
    return (True, cols)


def delete_template(name: str) -> None:
    """Delete a library template by name.

    Uses safe_template_name for traversal protection (same guard as rename_template).
    Raises AppError 404 if the file does not exist.
    """
    path = templates_dir() / safe_template_name(name)
    if not path.is_file():
        raise AppError("TEMPLATE_NOT_FOUND", "القالب غير موجود", http_status=404)
    path.unlink()
