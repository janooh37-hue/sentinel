"""Managed Included papers for generated record PDF packages."""

from __future__ import annotations

import contextlib
import shutil
import tempfile
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Sequence

import fitz
from fastapi import status
from sqlalchemy.orm import Session

from app.api.errors import AppError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core.constants import ALLOWED_DOC_EXTS
from app.core.pdf_merge import PdfPackageSourceError, build_pdf_package
from app.db.models import Book, BookVersion, Document, Employee, User
from app.services import book_service, document_service, staging_service

_IMAGE_EXTS = {".png", ".jpg", ".jpeg"}
_MIME_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


@dataclass(frozen=True)
class PaperProposal:
    id: str
    staged_token: str | None = None
    original_name: str | None = None


@dataclass(frozen=True)
class PaperView:
    id: str
    original_name: str
    slot_key: str | None
    media_type: str
    size: int
    page_count: int
    added_by_user_id: int | None
    added_at: str
    page_start: int | None
    page_end: int | None
    embedded_in_signed_base: bool = False


@dataclass(frozen=True)
class PackageResult:
    revision: int
    base_page_count: int
    total_page_count: int
    papers: list[PaperView]
    pdf_bytes: bytes
    change_summary: dict[str, Any] | None = None


@dataclass(frozen=True)
class _ResolvedPaper:
    id: str
    original_name: str
    slot_key: str | None
    media_type: str
    size: int
    page_count: int
    source: Path
    stored_path: str
    embedded: bool
    added_by_user_id: int | None
    added_at: str


def _absolute_data_path(raw: str | None) -> Path | None:
    if not raw:
        return None
    data_dir = get_settings().data_dir.resolve()
    path = Path(raw)
    candidate = path.resolve() if path.is_absolute() else (data_dir / path).resolve()
    if candidate != data_dir and data_dir not in candidate.parents:
        return None
    return candidate if candidate.is_file() else None


def _current_version(book: Book) -> BookVersion:
    if not book.versions:
        raise ValidationFailedError(
            "INCLUDED_PAPERS_UNAVAILABLE",
            "Included papers are available only for generated records",
        )
    return max(book.versions, key=lambda item: item.version_no)


def original_creator_user_id(book: Book) -> int | None:
    if not book.versions:
        return None
    return min(book.versions, key=lambda item: item.version_no).created_by_user_id


def _editable_context(
    db: Session, book_id: int, user_id: int
) -> tuple[Book, BookVersion, Document]:
    book = book_service.get_book(db, book_id)
    if book.deleted_at is not None or book.voided_at is not None:
        raise ValidationFailedError(
            "INCLUDED_PAPERS_UNAVAILABLE", "This record cannot be edited"
        )
    creator_id = original_creator_user_id(book)
    if creator_id is None or creator_id != user_id:
        raise AppError(
            "INCLUDED_PAPERS_CREATOR_ONLY",
            "Only the user who originally created this record can manage its included papers",
            http_status=status.HTTP_403_FORBIDDEN,
        )
    version = _current_version(book)
    if version.document_id is None:
        raise ValidationFailedError(
            "INCLUDED_PAPERS_UNAVAILABLE",
            "Included papers are available only for generated records",
        )
    document = db.get(Document, version.document_id)
    if document is None or not document.pdf_path:
        raise NotFoundError(
            "INCLUDED_PAPERS_PDF_MISSING", "The record PDF is not available"
        )
    return book, version, document


def inspect_paper(path: Path, *, display_name: str | None = None) -> tuple[str, int]:
    """Validate one package source and return media type and page count."""
    name = display_name or path.name
    ext = path.suffix.lower()
    if ext not in ALLOWED_DOC_EXTS:
        raise ValidationFailedError(
            "INCLUDED_PAPERS_BAD_EXTENSION",
            f"File type {ext!r} is not allowed",
            filename=name,
            allowed=sorted(ALLOWED_DOC_EXTS),
        )
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise NotFoundError(
            "INCLUDED_PAPERS_SOURCE_MISSING",
            f"Included paper {name} is missing",
            filename=name,
        ) from exc
    if size == 0:
        raise ValidationFailedError(
            "INCLUDED_PAPERS_EMPTY_FILE",
            f"Included paper {name} is empty",
            filename=name,
        )
    if size > book_service.MAX_ATTACHMENT_BYTES:
        raise ValidationFailedError(
            "INCLUDED_PAPERS_FILE_TOO_LARGE",
            f"File exceeds {book_service.MAX_ATTACHMENT_BYTES} bytes",
            filename=name,
            max_bytes=book_service.MAX_ATTACHMENT_BYTES,
            size=size,
        )
    try:
        if ext in _IMAGE_EXTS:
            with fitz.open(path) as image:
                image.convert_to_pdf()
            return _MIME_TYPES[ext], 1
        with fitz.open(path) as pdf:
            if pdf.page_count < 1:
                raise ValueError("PDF has no pages")
            return _MIME_TYPES[ext], pdf.page_count
    except Exception as exc:
        raise ValidationFailedError(
            "INCLUDED_PAPERS_UNREADABLE",
            f"Could not read {name}; upload a valid PDF, PNG, JPG, or JPEG",
            filename=name,
        ) from exc


def stage_paper(data: bytes, filename: str) -> tuple[staging_service.StagedFile, str, int]:
    if not data:
        raise ValidationFailedError(
            "INCLUDED_PAPERS_EMPTY_FILE", "Included paper files cannot be empty"
        )
    staged = staging_service.stage(data, filename)
    path = staging_service.resolve(staged.token)
    if path is None:
        raise NotFoundError(
            "INCLUDED_PAPERS_STAGE_MISSING", "The staged paper could not be stored"
        )
    try:
        media_type, pages = inspect_paper(path, display_name=staged.filename)
    except Exception:
        with contextlib.suppress(OSError):
            path.unlink()
        raise
    return staged, media_type, pages


def _legacy_id(book_id: int, position: int, path: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"book:{book_id}:paper:{position}:{path}"))


def _physical_signed_scan(version: BookVersion) -> bool:
    source = version.signed_base_pdf_path or version.signed_pdf_path or ""
    return source.replace("\\", "/").startswith("book_attachments/")


def _effective_metadata(book: Book, version: BookVersion) -> list[dict[str, Any]]:
    """Return full metadata without mutating legacy JSON."""
    entries: list[dict[str, Any]] = []
    legacy_embedded = (
        bool(version.signed_pdf_path)
        and version.signed_base_pdf_path is None
        and _physical_signed_scan(version)
    )
    explicit_embedded = set(version.signed_embedded_paper_ids or [])
    creator_id = original_creator_user_id(book)
    for position, raw in enumerate(book.merged_attachment_paths or []):
        stored_path = str(raw.get("path") or "")
        source = book_service.resolve_attachment_path(stored_path)
        if source is None:
            raise NotFoundError(
                "INCLUDED_PAPERS_SOURCE_MISSING",
                "A paper merged when this record was created is missing",
                path=stored_path,
            )
        paper_id = str(raw.get("id") or _legacy_id(book.id, position, stored_path))
        original_name = Path(
            str(raw.get("original_name") or raw.get("filename") or source.name)
        ).name
        media_type, page_count = inspect_paper(source, display_name=original_name)
        stat = source.stat()
        added_at = str(
            raw.get("added_at")
            or raw.get("uploaded_at")
            or datetime.fromtimestamp(stat.st_mtime, UTC).isoformat()
        )
        entries.append(
            {
                "id": paper_id,
                "path": stored_path,
                "original_name": original_name,
                "slot_key": raw.get("slot_key"),
                "media_type": media_type,
                "size": stat.st_size,
                "page_count": page_count,
                "added_by_user_id": raw.get("added_by_user_id", creator_id),
                "added_at": added_at,
                "embedded": legacy_embedded or paper_id in explicit_embedded,
            }
        )
    return entries


def _resolve_existing(metadata: Sequence[dict[str, Any]]) -> list[_ResolvedPaper]:
    resolved: list[_ResolvedPaper] = []
    for item in metadata:
        stored_path = str(item["path"])
        source = book_service.resolve_attachment_path(stored_path)
        if source is None:
            raise NotFoundError(
                "INCLUDED_PAPERS_SOURCE_MISSING",
                f"Included paper {item['original_name']} is missing",
                filename=item["original_name"],
            )
        resolved.append(
            _ResolvedPaper(
                id=str(item["id"]),
                original_name=str(item["original_name"]),
                slot_key=(str(item["slot_key"]) if item.get("slot_key") is not None else None),
                media_type=str(item["media_type"]),
                size=int(item["size"]),
                page_count=int(item["page_count"]),
                source=source,
                stored_path=stored_path,
                embedded=bool(item.get("embedded")),
                added_by_user_id=(
                    int(item["added_by_user_id"])
                    if item.get("added_by_user_id") is not None
                    else None
                ),
                added_at=str(item["added_at"]),
            )
        )
    return resolved


def _fixed_from_primary(db: Session, document: Document, primary: Path) -> bytes:
    companions = document_service.companion_pdf_paths(db, document)
    try:
        return build_pdf_package(
            primary,
            [(path, path.name) for path in companions],
        ).pdf_bytes
    except (FileNotFoundError, PdfPackageSourceError) as exc:
        raise ValidationFailedError(
            "INCLUDED_PAPERS_BASE_UNREADABLE",
            "The record's fixed PDF could not be read",
        ) from exc


def _generated_fixed_base(
    db: Session,
    document: Document,
    metadata: Sequence[dict[str, Any]],
    temp_dir: Path,
) -> bytes:
    preserved = _absolute_data_path(document.base_pdf_path)
    if preserved is not None:
        return preserved.read_bytes()
    if metadata:
        docx = _absolute_data_path(document.docx_path)
        if docx is None:
            raise NotFoundError(
                "INCLUDED_PAPERS_SOURCE_DOCX_MISSING",
                "The committed source document is missing",
            )
        temp_docx = temp_dir / docx.name
        shutil.copyfile(docx, temp_docx)
        try:
            primary = document_service.convert_docx_to_pdf(temp_docx)
        except Exception as exc:
            raise ValidationFailedError(
                "INCLUDED_PAPERS_BASE_RECONSTRUCTION_FAILED",
                "The fixed generated form could not be reconstructed",
            ) from exc
        if primary is None or not primary.is_file():
            raise ValidationFailedError(
                "INCLUDED_PAPERS_BASE_RECONSTRUCTION_FAILED",
                "The fixed generated form could not be reconstructed",
            )
        return _fixed_from_primary(db, document, primary)
    published = _absolute_data_path(document.pdf_path)
    if published is None:
        raise NotFoundError(
            "INCLUDED_PAPERS_BASE_MISSING", "The record's fixed PDF is missing"
        )
    return _fixed_from_primary(db, document, published)


def _reconstruct_signed_base(
    db: Session,
    version: BookVersion,
    document: Document,
    temp_dir: Path,
) -> bytes:
    signer = db.get(User, version.signed_by_user_id) if version.signed_by_user_id else None
    signature = (
        book_service._resolve_signer_signature(db, signer) if signer is not None else None
    )
    if signer is None or signature is None:
        raise ValidationFailedError(
            "INCLUDED_PAPERS_SIGNER_UNAVAILABLE",
            "The original signer or signature is no longer available",
        )
    signer_names = [signer.display_name] if signer.display_name else []
    if signer.employee_id:
        employee = db.get(Employee, signer.employee_id)
        if employee is not None:
            signer_names.extend(name for name in (employee.name_ar, employee.name_en) if name)
    rendered = document_service.render_signed_pdf(
        db,
        version=version,
        signer_signature_path=str(signature),
        signer_names=signer_names,
        output_dir=temp_dir,
        merge_included_papers=False,
    )
    primary = Path(rendered)
    if not primary.is_absolute():
        primary = get_settings().data_dir / primary
    if not primary.is_file() or primary.suffix.lower() != ".pdf":
        raise ValidationFailedError(
            "INCLUDED_PAPERS_SIGNED_BASE_RECONSTRUCTION_FAILED",
            "The signed form could not be reconstructed",
        )
    return _fixed_from_primary(db, document, primary)


def _fixed_base_bytes(
    db: Session,
    version: BookVersion,
    document: Document,
    metadata: Sequence[dict[str, Any]],
    temp_dir: Path,
) -> bytes:
    if version.signed_pdf_path and version.status == "approved":
        preserved = _absolute_data_path(version.signed_base_pdf_path)
        if preserved is not None:
            return preserved.read_bytes()
        if _physical_signed_scan(version):
            scan = _absolute_data_path(version.signed_pdf_path)
            if scan is None:
                raise NotFoundError(
                    "INCLUDED_PAPERS_BASE_MISSING", "The signed scan is missing"
                )
            return scan.read_bytes()
        return _reconstruct_signed_base(db, version, document, temp_dir)
    return _generated_fixed_base(db, document, metadata, temp_dir)


def _paper_views(papers: Sequence[_ResolvedPaper], base_pages: int) -> list[PaperView]:
    cursor = base_pages + 1
    views: list[PaperView] = []
    for paper in papers:
        if paper.embedded:
            start = end = None
        else:
            start = cursor
            end = cursor + paper.page_count - 1
            cursor = end + 1
        views.append(
            PaperView(
                id=paper.id,
                original_name=paper.original_name,
                slot_key=paper.slot_key,
                media_type=paper.media_type,
                size=paper.size,
                page_count=paper.page_count,
                added_by_user_id=paper.added_by_user_id,
                added_at=paper.added_at,
                page_start=start,
                page_end=end,
                embedded_in_signed_base=paper.embedded,
            )
        )
    return views


def _build_result(
    revision: int,
    base_bytes: bytes,
    papers: Sequence[_ResolvedPaper],
) -> PackageResult:
    with tempfile.TemporaryDirectory(prefix="included-papers-") as raw_temp:
        fixed = Path(raw_temp) / "fixed.pdf"
        fixed.write_bytes(base_bytes)
        editable = [paper for paper in papers if not paper.embedded]
        try:
            built = build_pdf_package(
                fixed,
                [(paper.source, paper.original_name) for paper in editable],
            )
        except FileNotFoundError as exc:
            raise NotFoundError(
                "INCLUDED_PAPERS_SOURCE_MISSING",
                f"Included paper {exc} is missing",
            ) from exc
        except PdfPackageSourceError as exc:
            raise ValidationFailedError(
                "INCLUDED_PAPERS_UNREADABLE",
                f"Could not read {exc.filename}",
                filename=exc.filename,
            ) from exc
    return PackageResult(
        revision=revision,
        base_page_count=built.fixed_page_count,
        total_page_count=built.total_page_count,
        papers=_paper_views(papers, built.fixed_page_count),
        pdf_bytes=built.pdf_bytes,
    )


def get_package(db: Session, book_id: int, *, user_id: int) -> PackageResult:
    book, version, document = _editable_context(db, book_id, user_id)
    metadata = _effective_metadata(book, version)
    papers = _resolve_existing(metadata)
    with tempfile.TemporaryDirectory(prefix="included-base-") as raw_temp:
        base = _fixed_base_bytes(db, version, document, metadata, Path(raw_temp))
    return _build_result(book.included_papers_revision, base, papers)


__all__ = [
    "PackageResult",
    "PaperProposal",
    "PaperView",
    "get_package",
    "inspect_paper",
    "original_creator_user_id",
    "stage_paper",
]
