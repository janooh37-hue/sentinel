"""User-scoped staging for already-approved inmate reports."""

from __future__ import annotations

import json
import logging
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from app.config import get_settings
from app.core.approved_pdf import ApprovedPdfError, normalize_upload_to_pdf
from app.core.extraction.dates import parse_date
from app.core.extraction.ocr import OcrUnavailableError, text_from_pdf
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


class StagedApprovedImportError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


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


def _staging_root() -> Path:
    return get_settings().data_dir / STAGED_DIR_NAME


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _metadata(path: Path) -> dict[str, object]:
    try:
        value = json.loads((path / "metadata.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise StagedApprovedImportError(
            "STAGED_IMPORT_NOT_FOUND", "Staged approved import not found"
        ) from exc
    if not isinstance(value, dict):
        raise StagedApprovedImportError(
            "STAGED_IMPORT_NOT_FOUND", "Staged approved import not found"
        )
    return value


def _created_at(metadata: dict[str, object]) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(metadata["created_at"]))
    except (KeyError, ValueError) as exc:
        raise StagedApprovedImportError(
            "STAGED_IMPORT_NOT_FOUND", "Staged approved import not found"
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
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise StagedApprovedImportError(
            "APPROVED_IMPORT_TOO_LARGE",
            f"File exceeds {MAX_ATTACHMENT_BYTES} bytes",
        )
    try:
        pdf_bytes = normalize_upload_to_pdf(data)
    except ApprovedPdfError as exc:
        raise StagedApprovedImportError("APPROVED_IMPORT_INVALID_FILE", str(exc)) from exc

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
        subject += " - " + ", ".join(item.name for item in inmate_names)

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
            "STAGED_IMPORT_NOT_FOUND", "Staged approved import not found"
        )
    current = now or _utcnow()
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    root = _staging_root().resolve()
    candidate = (root / token).resolve()
    if root not in candidate.parents or not candidate.is_dir():
        raise StagedApprovedImportError(
            "STAGED_IMPORT_NOT_FOUND", "Staged approved import not found"
        )
    metadata = _metadata(candidate)
    try:
        owner_matches = int(metadata["owner_user_id"]) == owner_user_id
    except (KeyError, TypeError, ValueError):
        owner_matches = False
    if not owner_matches:
        raise StagedApprovedImportError(
            "STAGED_IMPORT_NOT_FOUND", "Staged approved import not found"
        )
    if current - _created_at(metadata) >= timedelta(seconds=TTL_SECONDS):
        shutil.rmtree(candidate, ignore_errors=True)
        raise StagedApprovedImportError(
            "STAGED_IMPORT_EXPIRED", "The staged approved import has expired"
        )
    source = candidate / "source.pdf"
    if not source.is_file():
        raise StagedApprovedImportError(
            "STAGED_IMPORT_NOT_FOUND", "Staged approved import not found"
        )

    claimed = root / f"{token}.claimed"
    try:
        candidate.rename(claimed)
    except OSError as exc:
        raise StagedApprovedImportError(
            "STAGED_IMPORT_NOT_FOUND", "Staged approved import not found"
        ) from exc
    return ClaimedApprovedImport(
        token=token,
        path=claimed,
        source_pdf=claimed / "source.pdf",
        owner_user_id=owner_user_id,
        filename=str(metadata.get("filename") or "approved.pdf"),
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


__all__ = [
    "ApprovedImportInspection",
    "ClaimedApprovedImport",
    "ExtractedInmateName",
    "StagedApprovedImportError",
    "claim_staged",
    "consume_claim",
    "inspect_upload",
    "release_claim",
]
