"""User-scoped staging for already-approved inmate reports."""

from __future__ import annotations

import json
import logging
import re
import shutil
import uuid
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from fastapi import status
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.config import get_settings
from app.core.approved_pdf import (
    ApprovedPdfError,
    normalize_upload_to_pdf,
    stamp_approved_pdf,
)
from app.core.book_text import build_search_text
from app.core.constants import STAMP_STYLE_HEADER
from app.core.extraction.dates import parse_date
from app.core.extraction.ocr import OcrUnavailableError, text_from_pdf
from app.db.models import (
    AuditLog,
    Book,
    BookCategory,
    BookVersion,
    Document,
    User,
)
from app.db.repos.refs_repo import allocate_ref_with_retry
from app.services import correspondence_service
from app.services.book_service import MAX_ATTACHMENT_BYTES

log = logging.getLogger(__name__)

STAGED_DIR_NAME = "staged_approved_imports"
TTL_SECONDS = 24 * 3600
_TOKEN_RE = re.compile(r"^[0-9a-f]{32}$")
_DATE_RE = re.compile(r"\b(\d{1,4}[./-]\d{1,2}[./-]\d{1,4})\b")
_NAME_RE = re.compile(
    r"^(?:inmate\s+name|name|اسم\s+(?:النزيل|السجين))\s*[:-]\s*(.+)$",
    re.IGNORECASE,
)
_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


class StagedApprovedImportError(AppError):
    def __init__(self, code: str, message: str) -> None:
        http_status = {
            "APPROVED_IMPORT_TOKEN_NOT_FOUND": status.HTTP_404_NOT_FOUND,
            "APPROVED_IMPORT_TOKEN_EXPIRED": status.HTTP_410_GONE,
            "APPROVED_IMPORT_TOKEN_FORBIDDEN": status.HTTP_403_FORBIDDEN,
            "APPROVED_IMPORT_TOKEN_IN_USE": status.HTTP_409_CONFLICT,
        }.get(code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        super().__init__(code, message, http_status=http_status)


@dataclass(frozen=True)
class ExtractedInmateName:
    name: str
    confidence: float


@dataclass(frozen=True)
class ApprovedImportInspection:
    token: str
    filename: str
    size: int
    expires_at: datetime
    report_date: date | None
    inmate_names: list[ExtractedInmateName]
    proposed_subject: str
    warnings: list[str]


@dataclass(frozen=True)
class ClaimedApprovedImport:
    token: str
    path: Path
    source_pdf: Path
    owner_user_id: int
    filename: str
    ocr_text: str


def _staging_root() -> Path:
    return get_settings().data_dir / STAGED_DIR_NAME


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _metadata(path: Path) -> dict[str, object]:
    try:
        value = json.loads((path / "metadata.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise StagedApprovedImportError(
            "APPROVED_IMPORT_TOKEN_NOT_FOUND", "Staged approved import not found"
        ) from exc
    if not isinstance(value, dict):
        raise StagedApprovedImportError(
            "APPROVED_IMPORT_TOKEN_NOT_FOUND", "Staged approved import not found"
        )
    return value


def _created_at(metadata: dict[str, object]) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(metadata["created_at"]))
    except (KeyError, ValueError) as exc:
        raise StagedApprovedImportError(
            "APPROVED_IMPORT_TOKEN_NOT_FOUND", "Staged approved import not found"
        ) from exc
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _purge_stale(root: Path, *, now: datetime) -> None:
    cutoff = now - timedelta(seconds=TTL_SECONDS)
    for path in root.iterdir():
        if not path.is_dir() or not _TOKEN_RE.fullmatch(path.name):
            continue
        try:
            if _created_at(_metadata(path)) < cutoff:
                shutil.rmtree(path)
        except (OSError, StagedApprovedImportError):
            log.warning("could not purge staged approved import %s", path, exc_info=True)


def _report_date(text: str) -> date | None:
    for candidate in _DATE_RE.findall(text.translate(_ARABIC_DIGITS)):
        parsed = parse_date(candidate)
        if parsed is not None:
            return parsed
        try:
            return date.fromisoformat(candidate.replace("/", "-").replace(".", "-"))
        except ValueError:
            continue
    return None


def _inmate_names(text: str) -> list[ExtractedInmateName]:
    result: list[ExtractedInmateName] = []
    seen: set[str] = set()
    for raw_line in text.splitlines():
        match = _NAME_RE.match(raw_line.strip())
        if match is None:
            continue
        name = " ".join(match.group(1).split()).strip(" ,;:-")
        folded = name.casefold()
        if name and folded not in seen:
            seen.add(folded)
            result.append(ExtractedInmateName(name=name, confidence=0.9))
    return result


def inspect_upload(
    *,
    owner_user_id: int,
    filename: str,
    data: bytes,
    now: datetime | None = None,
) -> ApprovedImportInspection:
    """Normalize, OCR, and stage an approved report without creating DB rows."""
    if not data:
        raise StagedApprovedImportError("APPROVED_IMPORT_FILE_EMPTY", "The uploaded file is empty")
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise StagedApprovedImportError(
            "APPROVED_IMPORT_FILE_TOO_LARGE",
            f"File exceeds {MAX_ATTACHMENT_BYTES} bytes",
        )
    try:
        pdf_bytes = normalize_upload_to_pdf(data)
    except ApprovedPdfError as exc:
        raise StagedApprovedImportError("APPROVED_IMPORT_BAD_FILE", str(exc)) from exc

    warnings: list[str] = []
    try:
        extracted_text = text_from_pdf(pdf_bytes)
    except OcrUnavailableError:
        extracted_text = ""
        warnings.append("OCR is unavailable; enter the report date and inmate names.")

    report_date = _report_date(extracted_text)
    inmate_names = _inmate_names(extracted_text)
    if report_date is None:
        warnings.append("Confirm the report date before saving.")
    if not inmate_names:
        warnings.append("Confirm at least one inmate name before saving.")
    subject = "Inmate Conduct Violations"
    if inmate_names:
        subject += " — " + ", ".join(item.name for item in inmate_names)

    current = now or _utcnow()
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    root = _staging_root()
    root.mkdir(parents=True, exist_ok=True)
    _purge_stale(root, now=current)
    token = uuid.uuid4().hex
    temporary = root / f".{token}.tmp"
    target = root / token
    safe_filename = Path(filename).name or "approved.pdf"
    expires_at = current + timedelta(seconds=TTL_SECONDS)
    try:
        temporary.mkdir()
        (temporary / "source.pdf").write_bytes(pdf_bytes)
        (temporary / "metadata.json").write_text(
            json.dumps(
                {
                    "owner_user_id": owner_user_id,
                    "filename": safe_filename,
                    "created_at": current.isoformat(),
                    "ocr_text": extracted_text,
                }
            ),
            encoding="utf-8",
        )
        temporary.rename(target)
    except OSError as exc:
        shutil.rmtree(temporary, ignore_errors=True)
        raise StagedApprovedImportError(
            "APPROVED_IMPORT_STAGE_FAILED", "Could not stage the approved import"
        ) from exc

    return ApprovedImportInspection(
        token=token,
        filename=safe_filename,
        size=len(pdf_bytes),
        expires_at=expires_at,
        report_date=report_date,
        inmate_names=inmate_names,
        proposed_subject=subject,
        warnings=warnings,
    )


def claim_staged(
    token: str,
    *,
    owner_user_id: int,
    now: datetime | None = None,
) -> ClaimedApprovedImport:
    """Atomically claim one staged report for a single commit attempt."""
    if not _TOKEN_RE.fullmatch(token):
        raise StagedApprovedImportError(
            "APPROVED_IMPORT_TOKEN_NOT_FOUND", "Staged approved import not found"
        )
    current = now or _utcnow()
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    root = _staging_root().resolve()
    candidate = (root / token).resolve()
    claimed = (root / f"{token}.claimed").resolve()
    if root not in candidate.parents:
        raise StagedApprovedImportError(
            "APPROVED_IMPORT_TOKEN_NOT_FOUND", "Staged approved import not found"
        )
    if not candidate.is_dir():
        if root in claimed.parents and claimed.is_dir():
            raise StagedApprovedImportError(
                "APPROVED_IMPORT_TOKEN_IN_USE",
                "The staged approved import is already being saved",
            )
        raise StagedApprovedImportError(
            "APPROVED_IMPORT_TOKEN_NOT_FOUND", "Staged approved import not found"
        )
    metadata = _metadata(candidate)
    try:
        owner_matches = int(metadata["owner_user_id"]) == owner_user_id
    except (KeyError, TypeError, ValueError):
        owner_matches = False
    if not owner_matches:
        raise StagedApprovedImportError(
            "APPROVED_IMPORT_TOKEN_FORBIDDEN",
            "The staged approved import belongs to another user",
        )
    if current - _created_at(metadata) >= timedelta(seconds=TTL_SECONDS):
        shutil.rmtree(candidate, ignore_errors=True)
        raise StagedApprovedImportError(
            "APPROVED_IMPORT_TOKEN_EXPIRED", "The staged approved import has expired"
        )
    source = candidate / "source.pdf"
    if not source.is_file():
        raise StagedApprovedImportError(
            "APPROVED_IMPORT_TOKEN_NOT_FOUND", "Staged approved import not found"
        )

    claimed = root / f"{token}.claimed"
    try:
        candidate.rename(claimed)
    except OSError as exc:
        code = (
            "APPROVED_IMPORT_TOKEN_IN_USE"
            if claimed.is_dir()
            else "APPROVED_IMPORT_TOKEN_NOT_FOUND"
        )
        raise StagedApprovedImportError(code, "Staged approved import is unavailable") from exc
    return ClaimedApprovedImport(
        token=token,
        path=claimed,
        source_pdf=claimed / "source.pdf",
        owner_user_id=owner_user_id,
        filename=str(metadata.get("filename") or "approved.pdf"),
        ocr_text=str(metadata.get("ocr_text") or ""),
    )


def release_claim(claim: ClaimedApprovedImport) -> None:
    """Make a claimed report retryable after a failed database commit."""
    target = claim.path.with_name(claim.token)
    try:
        claim.path.rename(target)
    except OSError:
        log.warning("could not release staged approved import %s", claim.token, exc_info=True)


def consume_claim(claim: ClaimedApprovedImport) -> None:
    """Delete a claim after its record and final PDF commit successfully."""
    shutil.rmtree(claim.path, ignore_errors=True)


@dataclass(frozen=True)
class ApprovedImportResult:
    book_id: int
    doc_id: int
    ref_number: str


def commit_approved_import(
    db: Session,
    *,
    owner: User,
    token: str,
    report_date: date,
    inmate_names: list[str],
    subject: str,
) -> ApprovedImportResult:
    """File one staged report as an approved, versioned NAT record."""
    cleaned_subject = subject.strip()
    cleaned_names = [name.strip() for name in inmate_names if name.strip()]
    if not cleaned_subject or not cleaned_names:
        raise StagedApprovedImportError(
            "APPROVED_IMPORT_METADATA_REQUIRED",
            "Report date, inmate names, and subject are required",
        )

    claim = claim_staged(token, owner_user_id=owner.id)
    final_path: Path | None = None
    temporary_path: Path | None = None
    try:
        if db.get(BookCategory, "NAT") is None:
            raise StagedApprovedImportError(
                "APPROVED_IMPORT_CATEGORY_MISSING",
                "The NAT Records category is not configured",
            )
        source_pdf = claim.source_pdf.read_bytes()
        ref_number = allocate_ref_with_retry(db, "NAT")
        stamped_pdf = stamp_approved_pdf(source_pdf, ref_number)
        created_at = datetime.now(UTC).replace(tzinfo=None)
        relative_pdf = Path("book_attachments")

        book = Book(
            category_id="NAT",
            ref_number=ref_number,
            subject=cleaned_subject,
            direction="outgoing",
            stamp_style=STAMP_STYLE_HEADER,
            employee_id=None,
            employee_name_snapshot=None,
            notes=None,
            created_at=created_at,
            deleted_at=None,
            approval_state="approved",
            submitted_by_user_id=owner.id,
            search_text=build_search_text(
                subject=cleaned_subject,
                ref=ref_number,
                body=claim.ocr_text,
            ),
        )
        db.add(book)
        db.flush()

        relative_pdf /= str(book.id)
        relative_pdf /= "approved-v1.pdf"
        final_path = get_settings().data_dir / relative_pdf
        final_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = final_path.with_name(f".{token}.tmp")
        temporary_path.write_bytes(stamped_pdf)
        if final_path.exists():
            raise StagedApprovedImportError(
                "APPROVED_IMPORT_FILE_EXISTS",
                "The approved record file already exists",
            )
        temporary_path.rename(final_path)
        temporary_path = None

        document = Document(
            employee_id=None,
            template_id="Inmate Conduct Violations",
            ref_number=ref_number,
            docx_path=None,
            pdf_path=relative_pdf.as_posix(),
            created_at=created_at,
            submission_id=str(uuid.uuid4()),
            role="primary",
        )
        db.add(document)
        db.flush()
        fields: dict[str, object] = {
            "report_date": report_date.isoformat(),
            "inmate_names": cleaned_names,
            "subject": cleaned_subject,
            "imported_approved": True,
        }
        db.add(
            BookVersion(
                book_id=book.id,
                version_no=1,
                document_id=document.id,
                template_id="Inmate Conduct Violations",
                fields=fields,
                trigger="initial",
                status="approved",
                created_by_user_id=owner.id,
                created_at=created_at,
                signed_pdf_path=relative_pdf.as_posix(),
                manager_sig_embedded=False,
                signed_by_user_id=owner.id,
                signed_at=created_at,
            )
        )
        book.doc_path = relative_pdf.as_posix()
        correspondence_service.log_event(
            db,
            trigger="document_generated",
            source_kind="generated_doc",
            source_book_id=book.id,
            subject=cleaned_subject,
            employee_id=None,
            submitter=owner.display_name or owner.email,
            entry_date=report_date,
            condition_fields={"category": "NAT"},
        )
        db.add(
            AuditLog(
                actor=owner.email,
                action="approved_violation_imported",
                entity_type="book",
                entity_id=str(book.id),
                payload=json.dumps(
                    {
                        "book_id": book.id,
                        "document_id": document.id,
                        "ref_number": ref_number,
                        "source_filename": claim.filename,
                    }
                ),
                ts=created_at,
            )
        )
        db.commit()
        result = ApprovedImportResult(
            book_id=book.id,
            doc_id=document.id,
            ref_number=ref_number,
        )
    except Exception:
        db.rollback()
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        if final_path is not None:
            final_path.unlink(missing_ok=True)
            with suppress(OSError):
                final_path.parent.rmdir()
        release_claim(claim)
        raise

    consume_claim(claim)
    return result


__all__ = [
    "ApprovedImportInspection",
    "ApprovedImportResult",
    "ClaimedApprovedImport",
    "ExtractedInmateName",
    "StagedApprovedImportError",
    "claim_staged",
    "commit_approved_import",
    "consume_claim",
    "inspect_upload",
    "release_claim",
]
