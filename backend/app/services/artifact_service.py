"""Filesystem boundary for producing generated DOCX/PDF artifacts.

Business rows, transactions, packaging, and PDF failure policy belong to the
calling workflow.  This module owns only files created by one production call.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal, Protocol, cast

import fitz

from app.config import get_settings
from app.core.constants import STAMP_STYLE_HEADER
from app.core.docx_engine import DocxEngine

_FORM_SHORT_NAME: dict[str, str] = {
    "Leave Application Form": "LeaveApp",
    "Leave Undertaking": "LeaveUndertaking",
    "Passport Release Form": "PassportRelease",
    "Duty Resumption Form": "DutyResumption",
    "Employee Clearance Form": "Clearance",
    "Salary Deduction Form": "SalaryDeduction",
    "Salary Transfer Request": "SalaryTransfer",
    "Violation Form": "Violation",
    "Warning Form": "Warning",
    "HR Request Form": "HRRequest",
    "Resignation Letter": "ResignationLetter",
    "Resignation Declaration": "ResignationDecl",
    "Acknowledgment Form": "Acknowledgment",
    "Material Request Form": "MRF",
    "Leave Permit Form": "LeavePermit",
    "Administrative Leave Form": "AdminLeave",
    "General Book": "GeneralBook",
    "Security Permit": "SecurityPermit",
    "Passport Release List": "PassportReleaseList",
    "Inmate Conduct Violations": "InmateViolations",
    "Vehicle Fines": "VehicleFines",
    "Vehicle Accident Report": "VehicleAccident",
}


def build_docx_filename(template_id: str, name_en: str, timestamp: datetime) -> str:
    """Build the stable public filename used by generated artifacts."""
    short = _FORM_SHORT_NAME.get(template_id, template_id.replace(" ", ""))
    name_short = name_en.replace(" ", "_")[:20] or "General"
    return f"{short}_{name_short}_{timestamp:%Y%m%d_%H%M}.docx"


def output_dir_for_admin(template_id: str) -> Path:
    """Return and create the configured global output directory for a form."""
    output = get_settings().data_dir / "output" / template_id.replace(" ", "_")
    output.mkdir(parents=True, exist_ok=True)
    return output


class PdfConverter(Protocol):
    def __call__(self, source_docx: Path, /) -> Path | None: ...


@dataclass(frozen=True, slots=True)
class ConversionOutcome:
    status: Literal["success", "unavailable", "error", "skipped"]
    pdf_path: Path | None = None
    error: str | None = None


@dataclass(frozen=True, slots=True)
class SignatureStamp:
    image_path: Path
    anchor_names: tuple[str, ...]
    size_mm: float
    boldness: int
    date_below: str | None = None


@dataclass(frozen=True, slots=True)
class StampPlan:
    reference: str | None = None
    header_reference: bool = False
    aztec_corner: str | None = None
    sync_general_book_footer: bool = False
    signature: SignatureStamp | None = None


EMPTY_STAMP_PLAN = StampPlan()


class ArtifactStampError(RuntimeError):
    def __init__(self, operation: Literal["reference", "aztec", "signature"]) -> None:
        self.operation = operation
        super().__init__(f"Artifact {operation} stamp failed")


@dataclass(frozen=True, slots=True)
class ArtifactResult:
    docx_path: Path
    conversion: ConversionOutcome
    created_paths: tuple[Path, ...]


def _reserve_exact(destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.close(descriptor)
    return destination


def _reserve(
    destination: Path, collision: Literal["suffix", "exact"], *, reserve_pdf: bool
) -> tuple[Path, Path | None]:
    index = 0
    while True:
        candidate = (
            destination
            if index == 0
            else destination.with_name(f"{destination.stem}_{index}{destination.suffix}")
        )
        try:
            target = _reserve_exact(candidate)
        except FileExistsError:
            if collision == "exact":
                raise
            index += 1
            continue
        if not reserve_pdf:
            return target, None
        expected_pdf = candidate.with_suffix(".pdf")
        reserved_pdf = expected_pdf.with_name(f".{expected_pdf.name}.gssg-reserve")
        if expected_pdf.exists():
            target.unlink(missing_ok=True)
            if collision == "exact":
                raise FileExistsError(expected_pdf)
            index += 1
            continue
        try:
            _reserve_exact(reserved_pdf)
        except FileExistsError:
            target.unlink(missing_ok=True)
            if collision == "exact":
                raise
            index += 1
            continue
        return target, reserved_pdf


def _convert(target: Path, converter: PdfConverter | None) -> ConversionOutcome:
    if converter is None:
        from app.services._pdf_executor import convert_docx_to_pdf

        effective_converter = cast(PdfConverter, convert_docx_to_pdf)
    else:
        effective_converter = converter
    try:
        pdf_path = effective_converter(target)
    except Exception as exc:
        diagnostic = f"{type(exc).__name__}: {exc}"[:500]
        return ConversionOutcome(status="error", error=diagnostic)
    if pdf_path is None:
        return ConversionOutcome(status="unavailable")
    resolved = Path(pdf_path)
    if resolved.resolve() != target.with_suffix(".pdf").resolve():
        return ConversionOutcome(status="error", error="Converter returned an unowned PDF path")
    if not resolved.is_file() or resolved.stat().st_size == 0:
        return ConversionOutcome(status="unavailable")
    try:
        with fitz.open(resolved) as pdf:
            if pdf.page_count < 1:
                return ConversionOutcome(status="unavailable")
    except (fitz.FileDataError, RuntimeError, ValueError, OSError):
        return ConversionOutcome(status="unavailable")
    return ConversionOutcome(status="success", pdf_path=resolved)


def _apply_stamps(target: Path, stamps: StampPlan) -> None:
    if stamps.sync_general_book_footer:
        from app.core.docx_engine import _postprocess_general_book_footer

        _postprocess_general_book_footer(target)
    if stamps.header_reference and (
        stamps.reference is None
        or not DocxEngine.stamp_ref_number(target, stamps.reference, STAMP_STYLE_HEADER)
    ):
        raise ArtifactStampError("reference")
    if stamps.aztec_corner is not None and (
        stamps.reference is None
        or not DocxEngine.stamp_aztec_code(target, stamps.reference, corner=stamps.aztec_corner)
    ):
        raise ArtifactStampError("aztec")
    if stamps.signature is not None:
        from app.core import docx_engine

        signature = stamps.signature
        if not docx_engine.stamp_signature_above_name(
            target,
            str(signature.image_path),
            signature.anchor_names,
            size_mm=signature.size_mm,
            boldness=signature.boldness,
            date_below=signature.date_below,
        ):
            raise ArtifactStampError("signature")


def _finish(
    target: Path,
    *,
    stamps: StampPlan,
    convert_pdf: bool,
    converter: PdfConverter | None,
    reserved_pdf: Path | None,
) -> ArtifactResult:
    created: list[Path] = [target]
    try:
        _apply_stamps(target, stamps)
        if not convert_pdf:
            return ArtifactResult(target, ConversionOutcome(status="skipped"), tuple(created))
        expected_pdf = target.with_suffix(".pdf")
        conversion = _convert(target, converter)
        if reserved_pdf is not None:
            if conversion.status == "success":
                created.append(expected_pdf)
            else:
                expected_pdf.unlink(missing_ok=True)
        return ArtifactResult(target, conversion, tuple(created))
    except Exception:
        for path in reversed(created):
            path.unlink(missing_ok=True)
        raise
    finally:
        if reserved_pdf is not None:
            reserved_pdf.unlink(missing_ok=True)


def produce_from_template(
    *,
    template_id: str,
    data: Mapping[str, object],
    destination: Path,
    stamps: StampPlan = EMPTY_STAMP_PLAN,
    convert_pdf: bool = True,
    collision: Literal["suffix", "exact"] = "suffix",
    converter: PdfConverter | None = None,
    template_root: Path | None = None,
    template_path: Path | None = None,
) -> ArtifactResult:
    """Render a registered template into a newly owned artifact path."""
    if template_root is not None and template_path is not None:
        raise ValueError("template_root and template_path are mutually exclusive")
    target, reserved_pdf = _reserve(Path(destination), collision, reserve_pdf=convert_pdf)
    try:
        if template_path is not None:
            DocxEngine(template_path.parent).fill_general_book_path(
                Path(template_path), dict(data), target, sandboxed=True
            )
        else:
            root = (
                Path(template_root) if template_root is not None else get_settings().templates_dir
            )
            DocxEngine(root).fill(template_id, dict(data), target)
    except Exception:
        target.unlink(missing_ok=True)
        if reserved_pdf is not None:
            reserved_pdf.unlink(missing_ok=True)
        raise
    return _finish(
        target,
        stamps=stamps,
        convert_pdf=convert_pdf,
        converter=converter,
        reserved_pdf=reserved_pdf,
    )


def produce_from_docx(
    *,
    source_path: Path,
    destination: Path,
    convert_pdf: bool = True,
    collision: Literal["suffix", "exact"] = "suffix",
    converter: PdfConverter | None = None,
    stamps: StampPlan = EMPTY_STAMP_PLAN,
) -> ArtifactResult:
    """Copy an authoritative DOCX to a newly owned artifact path."""
    source = Path(source_path)
    if not source.is_file() or source.suffix.lower() != ".docx":
        raise FileNotFoundError(source)
    target, reserved_pdf = _reserve(Path(destination), collision, reserve_pdf=convert_pdf)
    try:
        shutil.copy2(source, target)
    except Exception:
        target.unlink(missing_ok=True)
        if reserved_pdf is not None:
            reserved_pdf.unlink(missing_ok=True)
        raise

    return _finish(
        target,
        stamps=stamps,
        convert_pdf=convert_pdf,
        converter=converter,
        reserved_pdf=reserved_pdf,
    )


def cleanup_created(result: ArtifactResult, *, allowed_root: Path) -> None:
    """Remove only files this result created, constrained to ``allowed_root``."""
    root = Path(allowed_root).resolve()
    for path in reversed(result.created_paths):
        resolved = path.resolve()
        if resolved != root and root not in resolved.parents:
            raise ValueError(f"Artifact cleanup path is outside allowed root: {path}")
        resolved.unlink(missing_ok=True)
