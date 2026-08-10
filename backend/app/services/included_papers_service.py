"""Managed Included papers for generated record PDF packages."""

from __future__ import annotations

import contextlib
import json
import shutil
import tempfile
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import fitz
from fastapi import status
from sqlalchemy.orm import Session

from app.api.errors import AppError, ConflictError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core.constants import ALLOWED_DOC_EXTS
from app.core.pdf_merge import PdfPackageSourceError, build_pdf_package
from app.db.models import AuditLog, Book, BookVersion, Document, Employee, User
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
    staged_token: str | None
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

def _relative_data_path(path: Path) -> str:
    return path.resolve().relative_to(get_settings().data_dir.resolve()).as_posix()


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
                staged_token=None,
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


def _check_revision(book: Book, revision: int) -> None:
    if book.included_papers_revision != revision:
        raise ConflictError(
            "INCLUDED_PAPERS_STALE_REVISION",
            "Included papers changed after this workspace was opened; reload the latest version",
            current_revision=book.included_papers_revision,
        )


def _validate_proposal_id(value: str) -> str:
    try:
        parsed = str(uuid.UUID(value))
    except (ValueError, AttributeError) as exc:
        raise ValidationFailedError(
            "INCLUDED_PAPERS_INVALID_ID", "Included paper IDs must be UUIDs"
        ) from exc
    if parsed != value.lower():
        raise ValidationFailedError(
            "INCLUDED_PAPERS_INVALID_ID", "Included paper IDs must use canonical UUID form"
        )
    return parsed


def _resolve_proposal(
    book: Book,
    version: BookVersion,
    proposal: Sequence[PaperProposal],
    *,
    user_id: int,
) -> tuple[list[dict[str, Any]], list[_ResolvedPaper]]:
    old_metadata = _effective_metadata(book, version)
    old_resolved = {paper.id: paper for paper in _resolve_existing(old_metadata)}
    seen_ids: set[str] = set()
    seen_tokens: set[str] = set()
    resolved: list[_ResolvedPaper] = []
    now = datetime.now(UTC).isoformat()
    for item in proposal:
        paper_id = _validate_proposal_id(item.id)
        if paper_id in seen_ids:
            raise ValidationFailedError(
                "INCLUDED_PAPERS_DUPLICATE_ID",
                "An included paper appears more than once",
                paper_id=paper_id,
            )
        seen_ids.add(paper_id)
        existing = old_resolved.get(paper_id)
        if item.staged_token is None:
            if existing is None:
                raise ValidationFailedError(
                    "INCLUDED_PAPERS_UNKNOWN_ID",
                    "An included paper no longer exists",
                    paper_id=paper_id,
                )
            resolved.append(existing)
            continue
        if item.staged_token in seen_tokens:
            raise ValidationFailedError(
                "INCLUDED_PAPERS_DUPLICATE_STAGE",
                "A staged upload appears more than once",
            )
        seen_tokens.add(item.staged_token)
        if existing is not None and existing.embedded:
            raise ValidationFailedError(
                "INCLUDED_PAPERS_EMBEDDED",
                "Replace the signed scan before changing papers already flattened into it",
                paper_id=paper_id,
            )
        source = staging_service.resolve(item.staged_token)
        if source is None:
            raise NotFoundError(
                "INCLUDED_PAPERS_STAGE_MISSING",
                "A staged paper has expired or is missing; add that file again",
                token=item.staged_token,
            )
        original_name = Path(item.original_name or "").name
        if (
            not item.original_name
            or original_name != item.original_name
            or original_name in {".", ".."}
            or Path(original_name).suffix.lower() != source.suffix.lower()
        ):
            raise ValidationFailedError(
                "INCLUDED_PAPERS_INVALID_NAME",
                "A staged paper requires its original safe filename",
                paper_id=paper_id,
            )
        media_type, page_count = inspect_paper(source, display_name=original_name)
        resolved.append(
            _ResolvedPaper(
                id=paper_id,
                original_name=original_name,
                slot_key=existing.slot_key if existing is not None else None,
                media_type=media_type,
                size=source.stat().st_size,
                page_count=page_count,
                source=source,
                stored_path="",
                staged_token=item.staged_token,
                embedded=False,
                added_by_user_id=user_id,
                added_at=now,
            )
        )
    old_embedded = [
        str(item["id"]) for item in old_metadata if bool(item.get("embedded"))
    ]
    proposed_embedded = [paper.id for paper in resolved if paper.embedded]
    if old_embedded != proposed_embedded or (
        old_embedded
        and [paper.id for paper in resolved[: len(old_embedded)]] != old_embedded
    ):
        raise ValidationFailedError(
            "INCLUDED_PAPERS_EMBEDDED",
            "Replace the signed scan before removing or reordering papers already flattened into it",
        )
    return old_metadata, resolved


def preview_package(
    db: Session,
    book_id: int,
    *,
    user_id: int,
    revision: int,
    proposal: Sequence[PaperProposal],
) -> PackageResult:
    book, version, document = _editable_context(db, book_id, user_id)
    _check_revision(book, revision)
    old_metadata, papers = _resolve_proposal(
        book, version, proposal, user_id=user_id
    )
    with tempfile.TemporaryDirectory(prefix="included-base-") as raw_temp:
        base = _fixed_base_bytes(
            db, version, document, old_metadata, Path(raw_temp)
        )
    return _build_result(revision, base, papers)


def _change_summary(
    old: Sequence[dict[str, Any]], new: Sequence[_ResolvedPaper]
) -> dict[str, Any]:
    old_by_id = {str(item["id"]): item for item in old}
    new_by_id = {item.id: item for item in new}
    added = [item.original_name for item in new if item.id not in old_by_id]
    removed = [
        str(item["original_name"])
        for item in old
        if str(item["id"]) not in new_by_id
    ]
    replaced = [
        {
            "from": str(old_by_id[item.id]["original_name"]),
            "to": item.original_name,
        }
        for item in new
        if item.id in old_by_id and item.staged_token is not None
    ]
    old_common = [str(item["id"]) for item in old if str(item["id"]) in new_by_id]
    new_common = [item.id for item in new if item.id in old_by_id]
    reordered = [item.original_name for item in new] if old_common != new_common else []
    return {
        "added": added,
        "removed": removed,
        "replaced": replaced,
        "reordered": reordered,
    }


def _persisted_metadata(papers: Sequence[_ResolvedPaper]) -> list[dict[str, Any]]:
    return [
        {
            "id": paper.id,
            "path": paper.stored_path,
            "original_name": paper.original_name,
            "slot_key": paper.slot_key,
            "media_type": paper.media_type,
            "size": paper.size,
            "page_count": paper.page_count,
            "added_by_user_id": paper.added_by_user_id,
            "added_at": paper.added_at,
        }
        for paper in papers
    ]


def save_package(
    db: Session,
    book_id: int,
    *,
    user_id: int,
    revision: int,
    proposal: Sequence[PaperProposal],
) -> PackageResult:
    book, version, document = _editable_context(db, book_id, user_id)
    _check_revision(book, revision)
    old_metadata, proposed = _resolve_proposal(
        book, version, proposal, user_id=user_id
    )
    with tempfile.TemporaryDirectory(prefix="included-base-") as raw_temp:
        base_bytes = _fixed_base_bytes(
            db, version, document, old_metadata, Path(raw_temp)
        )

    data_dir = get_settings().data_dir.resolve()
    attachment_dir = data_dir / "book_attachments" / str(book.id)
    package_dir = data_dir / "book_packages" / str(book.id)
    attachment_dir.mkdir(parents=True, exist_ok=True)
    package_dir.mkdir(parents=True, exist_ok=True)
    created: list[Path] = []
    consumed_staged: list[Path] = []
    persisted: list[_ResolvedPaper] = []
    active_signed = bool(version.status == "approved" and version.signed_pdf_path)
    old_published = _absolute_data_path(
        version.signed_pdf_path if active_signed else document.pdf_path
    )
    try:
        for paper in proposed:
            if paper.staged_token is None:
                persisted.append(paper)
                continue
            destination = attachment_dir / (
                f"included-{paper.id}{paper.source.suffix.lower()}"
            )
            if destination.exists():
                destination = attachment_dir / (
                    f"included-{paper.id}-{uuid.uuid4().hex[:8]}"
                    f"{paper.source.suffix.lower()}"
                )
            shutil.copyfile(paper.source, destination)
            created.append(destination)
            consumed_staged.append(paper.source)
            persisted.append(
                _ResolvedPaper(
                    id=paper.id,
                    original_name=paper.original_name,
                    slot_key=paper.slot_key,
                    media_type=paper.media_type,
                    size=paper.size,
                    page_count=paper.page_count,
                    source=destination,
                    stored_path=_relative_data_path(destination),
                    staged_token=paper.staged_token,
                    embedded=False,
                    added_by_user_id=paper.added_by_user_id,
                    added_at=paper.added_at,
                )
            )

        built = _build_result(revision + 1, base_bytes, persisted)
        output = package_dir / (
            f"v{version.version_no}-package-r{revision + 1}-"
            f"{uuid.uuid4().hex[:10]}.pdf"
        )
        output.write_bytes(built.pdf_bytes)
        created.append(output)
        output_rel = _relative_data_path(output)

        if active_signed:
            if not version.signed_base_pdf_path:
                base_output = package_dir / (
                    f"v{version.version_no}-signed-base-{uuid.uuid4().hex[:10]}.pdf"
                )
                base_output.write_bytes(base_bytes)
                created.append(base_output)
                version.signed_base_pdf_path = _relative_data_path(base_output)
            version.signed_pdf_path = output_rel
            version.signed_embedded_paper_ids = [
                paper.id for paper in persisted if paper.embedded
            ]
        else:
            if not document.base_pdf_path:
                base_output = package_dir / (
                    f"v{version.version_no}-generated-base-{uuid.uuid4().hex[:10]}.pdf"
                )
                base_output.write_bytes(base_bytes)
                created.append(base_output)
                document.base_pdf_path = _relative_data_path(base_output)
            document.pdf_path = output_rel

        summary = _change_summary(old_metadata, persisted)
        book.merged_attachment_paths = _persisted_metadata(persisted)
        book.included_papers_revision = revision + 1
        actor = db.get(User, user_id)
        db.add(
            AuditLog(
                actor=(actor.display_name or actor.email) if actor else str(user_id),
                action="update_included_papers",
                entity_type="book",
                entity_id=str(book.id),
                payload=json.dumps(
                    {
                        "actor_user_id": user_id,
                        "actor_name": (
                            (actor.display_name or actor.email) if actor else str(user_id)
                        ),
                        "revision_before": revision,
                        "revision_after": revision + 1,
                        **summary,
                    },
                    ensure_ascii=False,
                ),
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        for path in created:
            with contextlib.suppress(OSError):
                path.unlink()
        raise

    referenced = {paper.source.resolve() for paper in persisted}
    for item in old_metadata:
        source = _absolute_data_path(str(item.get("path") or ""))
        if (
            source is not None
            and attachment_dir in source.parents
            and source.resolve() not in referenced
        ):
            with contextlib.suppress(OSError):
                source.unlink()
    if old_published is not None and old_published.resolve() != output.resolve():
        fixed = {
            path.resolve()
            for path in (
                _absolute_data_path(document.base_pdf_path),
                _absolute_data_path(version.signed_base_pdf_path),
            )
            if path is not None
        }
        if old_published.resolve() not in fixed:
            with contextlib.suppress(OSError):
                old_published.unlink()
    for path in consumed_staged:
        with contextlib.suppress(OSError):
            path.unlink()

    return PackageResult(
        revision=built.revision,
        base_page_count=built.base_page_count,
        total_page_count=built.total_page_count,
        papers=built.papers,
        pdf_bytes=built.pdf_bytes,
        change_summary=summary,
    )


__all__ = [
    "PackageResult",
    "PaperProposal",
    "PaperView",
    "get_package",
    "inspect_paper",
    "original_creator_user_id",
    "preview_package",
    "save_package",
    "stage_paper",
]
