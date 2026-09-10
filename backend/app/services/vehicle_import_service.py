"""Owner-scoped staging, review, and atomic application of vehicle workbooks."""

from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import uuid
from collections.abc import Iterable, Mapping
from contextlib import suppress
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, selectinload

from app.api.errors import AppError
from app.config import get_settings
from app.core.vehicle_xlsx import (
    MAX_COMPRESSED_BYTES,
    ParsedVehicleWorkbook,
    VehicleXlsxError,
    build_vehicle_import_template,
    normalize_import_values,
    parse_vehicle_workbook,
)
from app.db.models import User, Vehicle, VehicleFile, VehicleSite
from app.schemas.vehicle import (
    VehicleCreate,
    VehicleImportChange,
    VehicleImportConfirmRequest,
    VehicleImportCounts,
    VehicleImportImage,
    VehicleImportInspection,
    VehicleImportInspectRow,
    VehicleImportIssue,
    VehicleImportPreview,
    VehicleImportPreviewDraftRow,
    VehicleImportPreviewRequest,
    VehicleImportPreviewRow,
    VehicleImportResult,
    VehicleImportSection,
    VehicleProfileScan,
    VehicleUpdate,
)
from app.services import vehicle_profile_scan_service, vehicle_service

log = logging.getLogger(__name__)

STAGED_DIR_NAME = "staged_vehicle_imports"
TTL_SECONDS = 24 * 3600
_TOKEN_RE = re.compile(r"^[0-9a-f]{32}$")
_IMAGE_ID_RE = re.compile(r"^image-[1-9]\d*$")
_STAGING_DIR_RE = re.compile(r"^(?:[0-9a-f]{32}(?:\.claimed)?|\.[0-9a-f]{32}\.tmp)$")
_PROFILE_FIELDS = (
    "plate_code",
    "plate_number",
    "traffic_code",
    "type_ar",
    "type_en",
    "class_ar",
    "class_en",
    "vin",
    "site_id",
    "contract_note_ar",
    "contract_note_en",
    "license_start",
    "license_expiry",
    "make",
    "model",
    "model_year",
    "colour",
    "insurance_expiry",
    "inmate_capacity",
    "passenger_capacity",
    "accessories_ar",
    "accessories_en",
    "notes_ar",
    "notes_en",
)
_REQUIRED_FIELDS = (
    "plate_number",
    "traffic_code",
    "type_ar",
    "type_en",
    "class_ar",
    "class_en",
    "site_id",
    "license_start",
    "license_expiry",
)
_OCR_FIELDS = (
    "plate_code",
    "plate_number",
    "traffic_code",
    "vin",
    "make",
    "model",
    "model_year",
    "colour",
    "type_ar",
    "type_en",
    "class_ar",
    "class_en",
    "license_start",
    "license_expiry",
    "insurance_expiry",
)


class VehicleImportError(AppError):
    """Stable vehicle-import error envelope."""

    def __init__(self, code: str, message: str, **details: Any) -> None:
        http_status = {
            "VEHICLE_IMPORT_TOKEN_NOT_FOUND": status.HTTP_404_NOT_FOUND,
            "VEHICLE_IMPORT_TOKEN_FORBIDDEN": status.HTTP_403_FORBIDDEN,
            "VEHICLE_IMPORT_TOKEN_EXPIRED": status.HTTP_410_GONE,
            "VEHICLE_IMPORT_TOKEN_CLAIMED": status.HTTP_409_CONFLICT,
            "VEHICLE_IMPORT_UNKNOWN_REVISION": status.HTTP_409_CONFLICT,
            "VEHICLE_IMPORT_STALE": status.HTTP_409_CONFLICT,
            "VEHICLE_IMPORT_BUSY": status.HTTP_409_CONFLICT,
            "VEHICLE_IMPORT_TOO_LARGE": status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        }.get(code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        super().__init__(code, message, http_status=http_status, details=details)


def _staging_root() -> Path:
    return get_settings().data_dir / STAGED_DIR_NAME


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError) as exc:
        raise VehicleImportError(
            "VEHICLE_IMPORT_TOKEN_NOT_FOUND", "Staged vehicle import not found."
        ) from exc
    if not isinstance(value, dict):
        raise VehicleImportError(
            "VEHICLE_IMPORT_TOKEN_NOT_FOUND", "Staged vehicle import not found."
        )
    return value


def _write_json(path: Path, value: object) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(
            json.dumps(value, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _created_at(metadata: Mapping[str, object]) -> datetime:
    try:
        created = datetime.fromisoformat(str(metadata["created_at"]))
    except (KeyError, ValueError) as exc:
        raise VehicleImportError(
            "VEHICLE_IMPORT_TOKEN_NOT_FOUND", "Staged vehicle import not found."
        ) from exc
    return created if created.tzinfo is not None else created.replace(tzinfo=UTC)


def _purge_stale(root: Path, *, now: datetime) -> None:
    cutoff = now - timedelta(seconds=TTL_SECONDS)
    for path in root.iterdir():
        if not path.is_dir() or not _STAGING_DIR_RE.fullmatch(path.name):
            continue
        try:
            try:
                created = _created_at(_json(path / "metadata.json"))
            except VehicleImportError:
                created = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
            if created < cutoff:
                shutil.rmtree(path)
        except OSError:
            log.warning("could not purge staged vehicle import %s", path, exc_info=True)


def _owner_matches(metadata: Mapping[str, object], owner: User) -> bool:
    try:
        return int(str(metadata["owner_user_id"])) == owner.id and str(metadata["owner_email"]) == owner.email
    except (KeyError, TypeError, ValueError):
        return False


def _stage_path(token: str, *, owner: User, now: datetime | None = None) -> Path:
    if not _TOKEN_RE.fullmatch(token):
        raise VehicleImportError(
            "VEHICLE_IMPORT_TOKEN_NOT_FOUND", "Staged vehicle import not found."
        )
    current = now or _utcnow()
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    root = _staging_root().resolve()
    candidate = (root / token).resolve()
    claimed = (root / f"{token}.claimed").resolve()
    if root not in candidate.parents or root not in claimed.parents:
        raise VehicleImportError(
            "VEHICLE_IMPORT_TOKEN_NOT_FOUND", "Staged vehicle import not found."
        )
    path = candidate if candidate.is_dir() else claimed if claimed.is_dir() else None
    if path is None:
        raise VehicleImportError(
            "VEHICLE_IMPORT_TOKEN_NOT_FOUND", "Staged vehicle import not found."
        )
    metadata = _json(path / "metadata.json")
    if not _owner_matches(metadata, owner):
        raise VehicleImportError(
            "VEHICLE_IMPORT_TOKEN_FORBIDDEN",
            "The staged vehicle import belongs to another user.",
        )
    if current - _created_at(metadata) >= timedelta(seconds=TTL_SECONDS):
        shutil.rmtree(path, ignore_errors=True)
        raise VehicleImportError(
            "VEHICLE_IMPORT_TOKEN_EXPIRED", "The staged vehicle import has expired."
        )
    if path == claimed:
        raise VehicleImportError(
            "VEHICLE_IMPORT_TOKEN_CLAIMED",
            "The staged vehicle import is being confirmed or was already consumed.",
        )
    return candidate


def _claim_stage(token: str, *, owner: User) -> Path:
    candidate = _stage_path(token, owner=owner)
    claimed = candidate.with_name(f"{token}.claimed")
    try:
        candidate.rename(claimed)
    except OSError as exc:
        raise VehicleImportError(
            "VEHICLE_IMPORT_TOKEN_CLAIMED",
            "The staged vehicle import is already being confirmed.",
        ) from exc
    return claimed


def _release_claim(path: Path, token: str) -> None:
    target = path.with_name(token)
    try:
        path.rename(target)
    except OSError:
        log.warning("could not release staged vehicle import %s", token, exc_info=True)


def _safe_upload_name(filename: str) -> str:
    return filename.replace("\\", "/").rsplit("/", 1)[-1] or "vehicles.xlsx"


def _issue(
    row_id: str | None,
    field: str | None,
    code: str,
    message: str,
) -> VehicleImportIssue:
    return VehicleImportIssue(row_id=row_id, field=field, code=code, message=message)


def _image_url(token: str, image_id: str) -> str:
    return f"/api/v1/vehicles/imports/{token}/images/{image_id}"


def _serialized_workbook(parsed: ParsedVehicleWorkbook, token: str) -> dict[str, Any]:
    return {
        "layout": parsed.layout,
        "sections": [
            {"id": section.id, "sheet": section.sheet, "title": section.title}
            for section in parsed.sections
        ],
        "rows": [
            {
                "row_id": row.row_id,
                "section_id": row.section_id,
                "sheet": row.sheet,
                "row_number": row.row_number,
                "raw": row.raw,
                "values": row.values,
                "image_ids": row.image_ids,
            }
            for row in parsed.rows
        ],
        "images": [
            {
                "image_id": image.image_id,
                "url": _image_url(token, image.image_id),
                "row_id": image.row_id,
                "original_name": image.original_name,
                "media_type": image.media_type,
                "kind": image.kind,
                "sha256": hashlib.sha256(image.data).hexdigest(),
                "staged_name": f"{image.image_id}{Path(image.original_name).suffix.lower() or '.bin'}",
            }
            for image in parsed.images
        ],
        "warnings": [
            {
                "row_id": warning.row_id,
                "field": warning.field,
                "code": warning.code,
                "message": warning.message,
            }
            for warning in parsed.warnings
        ],
    }


def _inspection(stage: Path, token: str, metadata: Mapping[str, object]) -> VehicleImportInspection:
    parsed = _json(stage / "inspection.json")
    expires_at = _created_at(metadata) + timedelta(seconds=TTL_SECONDS)
    return VehicleImportInspection(
        token=token,
        expires_at=expires_at,
        filename=str(metadata["filename"]),
        sections=[VehicleImportSection.model_validate(item) for item in parsed["sections"]],
        rows=[VehicleImportInspectRow.model_validate(item) for item in parsed["rows"]],
        images=[VehicleImportImage.model_validate(item) for item in parsed["images"]],
        warnings=[VehicleImportIssue.model_validate(item) for item in parsed["warnings"]],
    )


def inspect_upload(
    *,
    owner: User,
    filename: str,
    data: bytes,
    now: datetime | None = None,
) -> VehicleImportInspection:
    """Validate, parse, and stage one workbook without touching fleet tables."""
    safe_filename = _safe_upload_name(filename)
    if Path(safe_filename).suffix.lower() != ".xlsx":
        raise VehicleImportError(
            "VEHICLE_IMPORT_BAD_FILE", "Only .xlsx vehicle workbooks are supported."
        )
    if len(data) > MAX_COMPRESSED_BYTES:
        raise VehicleImportError(
            "VEHICLE_IMPORT_TOO_LARGE",
            f"Workbook exceeds {MAX_COMPRESSED_BYTES // (1024 * 1024)} MiB.",
        )
    try:
        parsed = parse_vehicle_workbook(data)
    except VehicleXlsxError as exc:
        raise VehicleImportError(exc.code, exc.message) from exc

    current = now or _utcnow()
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    root = _staging_root()
    root.mkdir(parents=True, exist_ok=True)
    _purge_stale(root, now=current)
    token = uuid.uuid4().hex
    temporary = root / f".{token}.tmp"
    target = root / token
    serialized = _serialized_workbook(parsed, token)
    try:
        temporary.mkdir()
        (temporary / "images").mkdir()
        (temporary / "ocr").mkdir()
        (temporary / "source.xlsx").write_bytes(data)
        for image, image_metadata in zip(parsed.images, serialized["images"], strict=True):
            (temporary / "images" / image_metadata["staged_name"]).write_bytes(image.data)
        _write_json(
            temporary / "metadata.json",
            {
                "owner_user_id": owner.id,
                "owner_email": owner.email,
                "filename": safe_filename,
                "created_at": current.isoformat(),
            },
        )
        _write_json(temporary / "inspection.json", serialized)
        temporary.rename(target)
    except OSError as exc:
        shutil.rmtree(temporary, ignore_errors=True)
        raise VehicleImportError(
            "VEHICLE_IMPORT_BAD_FILE", "Could not stage the vehicle workbook."
        ) from exc
    return _inspection(target, token, _json(target / "metadata.json"))


def _image_metadata(inspection: Mapping[str, Any], image_id: str) -> dict[str, Any]:
    if not _IMAGE_ID_RE.fullmatch(image_id):
        raise VehicleImportError(
            "VEHICLE_IMPORT_TOKEN_NOT_FOUND", "Staged vehicle image not found."
        )
    for value in inspection.get("images", []):
        if isinstance(value, dict) and value.get("image_id") == image_id:
            return value
    raise VehicleImportError(
        "VEHICLE_IMPORT_TOKEN_NOT_FOUND", "Staged vehicle image not found."
    )


def _staged_image_path(stage: Path, image: Mapping[str, Any]) -> Path:
    image_root = (stage / "images").resolve()
    path = (image_root / str(image.get("staged_name", ""))).resolve()
    if image_root not in path.parents or not path.is_file():
        raise VehicleImportError(
            "VEHICLE_IMPORT_TOKEN_NOT_FOUND", "Staged vehicle image not found."
        )
    return path


def resolve_image(
    token: str,
    image_id: str,
    *,
    owner: User,
) -> tuple[Path, str, str]:
    stage = _stage_path(token, owner=owner)
    inspection = _json(stage / "inspection.json")
    image = _image_metadata(inspection, image_id)
    return (
        _staged_image_path(stage, image),
        str(image.get("media_type") or "application/octet-stream"),
        str(image.get("original_name") or "vehicle-image"),
    )


def _scan_cache_path(stage: Path, image: Mapping[str, Any]) -> Path:
    digest = str(image["sha256"])
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise VehicleImportError(
            "VEHICLE_IMPORT_TOKEN_NOT_FOUND", "Staged vehicle image not found."
        )
    return stage / "ocr" / f"{digest}.json"


def _preview_image_role(stage: Path, image_id: str) -> str | None:
    draft_path = stage / "preview-draft.json"
    if not draft_path.is_file():
        return None
    stored = _json(draft_path)
    plan = stored.get("plans")
    if not isinstance(plan, dict):
        return None
    for row in plan.values():
        if not isinstance(row, dict):
            continue
        for image in row.get("image_plan", []):
            if isinstance(image, dict) and image.get("image_id") == image_id:
                role = image.get("role")
                return str(role) if role in {"photo", "license"} else None
    return None


def scan_image(token: str, image_id: str, *, owner: User) -> VehicleProfileScan:
    """OCR a staged licence image, caching only its independent suggestion."""
    stage = _stage_path(token, owner=owner)
    inspection = _json(stage / "inspection.json")
    image = _image_metadata(inspection, image_id)
    role = image.get("kind") or _preview_image_role(stage, image_id)
    if role != "license":
        raise VehicleImportError(
            "VEHICLE_IMPORT_IMAGE_ROLE_REQUIRED",
            "The image must be classified as a licence before it can be scanned.",
            image_id=image_id,
        )
    cache = _scan_cache_path(stage, image)
    if cache.is_file():
        return VehicleProfileScan.model_validate(_json(cache))
    result = vehicle_profile_scan_service.scan_vehicle_profile(_staged_image_path(stage, image).read_bytes())
    if "OCR_UNAVAILABLE" not in result.warnings:
        _write_json(cache, result.model_dump(mode="json"))
    return result


def _scalar(value: object) -> str | int | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int | str):
        return value
    return str(value)


def _vehicle_values(vehicle: Vehicle) -> dict[str, str | int | None]:
    return {field: _scalar(getattr(vehicle, field)) for field in _PROFILE_FIELDS}


def _file_url(vehicle_id: int, file_id: int | None) -> str | None:
    return f"/api/v1/vehicles/{vehicle_id}/files/{file_id}" if file_id is not None else None


def _vehicle_stmt() -> Any:
    return select(Vehicle).options(selectinload(Vehicle.files), selectinload(Vehicle.site))


def _files_snapshot(vehicle: Vehicle) -> list[dict[str, object]]:
    return [
        {
            "id": file.id,
            "kind": file.kind,
            "path": file.path,
            "size": file.size,
        }
        for file in sorted(vehicle.files, key=lambda item: item.id)
    ]


def _site_snapshot(site: VehicleSite) -> dict[str, object]:
    return {
        "id": site.id,
        "name_ar": site.name_ar,
        "name_en": site.name_en,
        "active": site.active,
    }


def _vehicle_fingerprint(vehicle: Vehicle) -> dict[str, object]:
    return {
        "vehicle": {
            **_vehicle_values(vehicle),
            "archived_at": _scalar(vehicle.archived_at),
            "updated_at": _scalar(vehicle.updated_at),
            "photo_file_id": vehicle.photo_file_id,
            "license_file_id": vehicle.license_file_id,
            "files": _files_snapshot(vehicle),
        },
        "site": _site_snapshot(vehicle.site),
    }


def _create_fingerprint(
    *, plate_code: str | None, plate_number: str, site: VehicleSite
) -> dict[str, object]:
    return {
        "vehicle": None,
        "plate_code": plate_code,
        "plate_number": plate_number,
        "site": _site_snapshot(site),
    }


def _file_digest(file: VehicleFile) -> str | None:
    data_root = get_settings().data_dir.resolve()
    path = (data_root / file.path).resolve()
    if not path.is_relative_to(data_root) or not path.is_file():
        return None
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def _existing_hashes(vehicle: Vehicle, role: str) -> dict[str, VehicleFile]:
    allowed = {"photo", "gallery"} if role == "photo" else {"license"}
    result: dict[str, VehicleFile] = {}
    for file in vehicle.files:
        if file.kind not in allowed:
            continue
        digest = _file_digest(file)
        if digest is not None:
            result.setdefault(digest, file)
    return result


def _row_issues(
    inspection: Mapping[str, Any], row_id: str
) -> tuple[list[VehicleImportIssue], list[VehicleImportIssue]]:
    errors: list[VehicleImportIssue] = []
    warnings: list[VehicleImportIssue] = []
    for item in inspection.get("warnings", []):
        if not isinstance(item, dict) or item.get("row_id") != row_id:
            continue
        issue = VehicleImportIssue.model_validate(item)
        if issue.code == "VEHICLE_IMPORT_INVALID_FIELD":
            errors.append(issue)
        else:
            warnings.append(issue)
    return errors, warnings


def _duplicates(values_by_row: Mapping[str, Mapping[str, object]]) -> set[str]:
    rows_by_plate: dict[tuple[str | None, str], list[str]] = {}
    for row_id, values in values_by_row.items():
        number = values.get("plate_number")
        code = values.get("plate_code")
        if isinstance(number, str) and (code is None or isinstance(code, str)):
            rows_by_plate.setdefault((code, number), []).append(row_id)
    return {
        row_id
        for row_ids in rows_by_plate.values()
        if len(row_ids) > 1
        for row_id in row_ids
    }


def _validate_request_shape(
    inspection: Mapping[str, Any], payload: VehicleImportPreviewRequest
) -> tuple[dict[str, VehicleImportPreviewDraftRow], set[str]]:
    stage_rows = {
        str(row["row_id"]): row for row in inspection.get("rows", []) if isinstance(row, dict)
    }
    draft_rows: dict[str, VehicleImportPreviewDraftRow] = {}
    for row in payload.rows:
        if row.row_id in draft_rows or row.row_id not in stage_rows:
            raise VehicleImportError(
                "VEHICLE_IMPORT_INVALID_FIELD", "Preview rows must be unique staged row ids."
            )
        draft_rows[row.row_id] = row
    if set(draft_rows) != set(stage_rows):
        raise VehicleImportError(
            "VEHICLE_IMPORT_INVALID_FIELD", "Preview must include every staged workbook row."
        )

    image_ids = {
        str(image["image_id"])
        for image in inspection.get("images", [])
        if isinstance(image, dict)
    }
    excluded = set(payload.excluded_image_ids)
    if len(excluded) != len(payload.excluded_image_ids) or not excluded.issubset(image_ids):
        raise VehicleImportError(
            "VEHICLE_IMPORT_INVALID_FIELD", "Excluded image ids must be unique staged images."
        )
    assigned: dict[str, str] = {}
    for row in payload.rows:
        if len(set(row.image_ids)) != len(row.image_ids) or not set(row.image_ids).issubset(image_ids):
            raise VehicleImportError(
                "VEHICLE_IMPORT_INVALID_FIELD", "Row image ids must be unique staged images."
            )
        for image_id in row.image_ids:
            if image_id in excluded or image_id in assigned:
                raise VehicleImportError(
                    "VEHICLE_IMPORT_INVALID_FIELD",
                    "Each staged image must be assigned once or explicitly excluded.",
                )
            assigned[image_id] = row.row_id
    return draft_rows, excluded


def _cached_scan(stage: Path, image: Mapping[str, Any]) -> VehicleProfileScan | None:
    cache = _scan_cache_path(stage, image)
    return VehicleProfileScan.model_validate(_json(cache)) if cache.is_file() else None


def _scan_has_values(scan: VehicleProfileScan) -> bool:
    return any(getattr(scan, field) is not None for field in _OCR_FIELDS)


def _scan_identity_conflicts(
    scan: VehicleProfileScan, values: Mapping[str, str | int | None]
) -> bool:
    resolved_number = values.get("plate_number")
    resolved_code = values.get("plate_code")
    if scan.plate_number is not None and isinstance(resolved_number, str):
        if scan.plate_number != resolved_number:
            return True
        if scan.plate_code is not None and scan.plate_code != resolved_code:
            return True
    resolved_vin = values.get("vin")
    return bool(
        scan.vin is not None
        and isinstance(resolved_vin, str)
        and scan.vin.casefold() != resolved_vin.casefold()
    )


def _pydantic_issues(row_id: str, exc: ValidationError) -> list[VehicleImportIssue]:
    result: list[VehicleImportIssue] = []
    for error in exc.errors():
        location = error.get("loc", ())
        field = str(location[0]) if location else None
        result.append(
            _issue(
                row_id,
                field,
                "VEHICLE_IMPORT_INVALID_FIELD",
                str(error.get("msg") or "Invalid vehicle value."),
            )
        )
    return result


def _profile_payload(values: Mapping[str, str | int | None]) -> dict[str, object]:
    return {field: values.get(field) for field in _PROFILE_FIELDS}


def _image_response(token: str, image: Mapping[str, Any], role: str | None) -> VehicleImportImage:
    return VehicleImportImage(
        image_id=str(image["image_id"]),
        url=_image_url(token, str(image["image_id"])),
        row_id=str(image["row_id"]) if image.get("row_id") is not None else None,
        original_name=str(image["original_name"]),
        kind=role if role in {"photo", "license"} else None,
    )


def _choice_plan(
    *,
    row_id: str,
    draft: VehicleImportPreviewDraftRow,
    images: list[tuple[dict[str, Any], str]],
    existing: Vehicle | None,
) -> tuple[list[dict[str, object]], list[VehicleImportIssue], bool, bool, list[VehicleImportChange]]:
    errors: list[VehicleImportIssue] = []
    changes: list[VehicleImportChange] = []
    photo_ids = [str(image["image_id"]) for image, role in images if role == "photo"]
    license_ids = [str(image["image_id"]) for image, role in images if role == "license"]
    photo_required = bool(photo_ids) and (
        draft.photo_action is None
        or (draft.photo_action == "use_imported" and draft.primary_image_id not in photo_ids)
    )
    license_required = bool(license_ids) and (
        draft.license_action is None
        or (draft.license_action == "use_imported" and draft.license_image_id not in license_ids)
    )
    if photo_required:
        errors.append(
            _issue(
                row_id,
                "photo_file_id",
                "VEHICLE_IMPORT_PHOTO_CHOICE_REQUIRED",
                "Choose whether to keep the current photo or use an imported photo.",
            )
        )
    if license_required:
        errors.append(
            _issue(
                row_id,
                "license_file_id",
                "VEHICLE_IMPORT_LICENSE_CHOICE_REQUIRED",
                "Choose whether to keep the current licence or use an imported licence image.",
            )
        )
    if draft.primary_image_id is not None and draft.primary_image_id not in photo_ids:
        errors.append(
            _issue(
                row_id,
                "photo_file_id",
                "VEHICLE_IMPORT_INVALID_FIELD",
                "The primary image must be a photo assigned to this row.",
            )
        )
    if draft.license_image_id is not None and draft.license_image_id not in license_ids:
        errors.append(
            _issue(
                row_id,
                "license_file_id",
                "VEHICLE_IMPORT_INVALID_FIELD",
                "The primary licence image must be a licence assigned to this row.",
            )
        )

    hashes = {
        "photo": _existing_hashes(existing, "photo") if existing is not None else {},
        "license": _existing_hashes(existing, "license") if existing is not None else {},
    }
    imported_hashes: dict[tuple[str, str], str] = {}
    plan: list[dict[str, object]] = []
    for image, role in images:
        digest = str(image["sha256"])
        duplicate = hashes[role].get(digest)
        duplicate_image_id = imported_hashes.get((role, digest))
        plan.append(
            {
                "image_id": image["image_id"],
                "role": role,
                "sha256": digest,
                "dedup_file_id": duplicate.id if duplicate is not None else None,
                "dedup_image_id": duplicate_image_id,
                "is_primary": (
                    role == "photo"
                    and draft.photo_action == "use_imported"
                    and draft.primary_image_id == image["image_id"]
                ),
                "is_license_primary": (
                    role == "license"
                    and draft.license_action == "use_imported"
                    and draft.license_image_id == image["image_id"]
                ),
            }
        )
        if duplicate is None and duplicate_image_id is None:
            imported_hashes[(role, digest)] = str(image["image_id"])

    if existing is not None and not photo_required and draft.photo_action == "use_imported":
        target = next((item for item in plan if item["is_primary"]), None)
        after = target["dedup_file_id"] if target and target["dedup_file_id"] else draft.primary_image_id
        if existing.photo_file_id != after:
            changes.append(
                VehicleImportChange(
                    field="photo_file_id", before=existing.photo_file_id, after=after
                )
            )
    if existing is not None and not license_required and draft.license_action == "use_imported":
        target = next((item for item in plan if item["is_license_primary"]), None)
        after = target["dedup_file_id"] if target and target["dedup_file_id"] else draft.license_image_id
        if existing.license_file_id != after:
            changes.append(
                VehicleImportChange(
                    field="license_file_id", before=existing.license_file_id, after=after
                )
            )
    return plan, errors, photo_required, license_required, changes


def preview(
    db: Session,
    token: str,
    payload: VehicleImportPreviewRequest,
    *,
    owner: User,
) -> VehicleImportPreview:
    """Replace a stage's reviewed draft and issue a new immutable revision."""
    stage = _stage_path(token, owner=owner)
    inspection = _json(stage / "inspection.json")
    draft_rows, excluded_images = _validate_request_shape(inspection, payload)
    sections = {str(section["id"]) for section in inspection.get("sections", [])}
    if not set(payload.site_mappings).issubset(sections):
        raise VehicleImportError(
            "VEHICLE_IMPORT_INVALID_FIELD", "Site mappings contain an unknown section id."
        )
    image_by_id = {
        str(image["image_id"]): image
        for image in inspection.get("images", [])
        if isinstance(image, dict)
    }

    normalized_by_row: dict[str, dict[str, str | int | None]] = {}
    normalization_errors: dict[str, list[tuple[str, str]]] = {}
    for row_id, draft in draft_rows.items():
        normalized, field_errors = normalize_import_values(draft.values)
        normalized_by_row[row_id] = normalized
        normalization_errors[row_id] = field_errors
    duplicate_rows = _duplicates(normalized_by_row)

    vehicles = list(db.scalars(_vehicle_stmt()).unique().all())
    vehicles_by_plate = {(row.plate_code, row.plate_number): row for row in vehicles}
    site_ids = set(payload.site_mappings.values())
    sites = {
        site.id: site
        for site in db.scalars(select(VehicleSite).where(VehicleSite.id.in_(site_ids))).all()
    }
    response_rows: list[VehicleImportPreviewRow] = []
    plans: dict[str, dict[str, object]] = {}

    for source in inspection.get("rows", []):
        if not isinstance(source, dict):
            continue
        row_id = str(source["row_id"])
        draft = draft_rows[row_id]
        errors, warnings = _row_issues(inspection, row_id)
        errors.extend(
            _issue(row_id, field, "VEHICLE_IMPORT_INVALID_FIELD", message)
            for field, message in normalization_errors[row_id]
        )
        values = dict(normalized_by_row[row_id])
        values.pop("site", None)
        section_id = str(source["section_id"])
        site_id = payload.site_mappings.get(section_id)
        site = sites.get(site_id) if site_id is not None else None
        values["site_id"] = site_id
        if site is None:
            errors.append(
                _issue(
                    row_id,
                    "site_id",
                    "VEHICLE_IMPORT_SITE_REQUIRED",
                    "Choose an existing site for this workbook section.",
                )
            )
        if row_id in duplicate_rows:
            errors.append(
                _issue(
                    row_id,
                    "plate_number",
                    "VEHICLE_IMPORT_DUPLICATE_PLATE",
                    "This plate appears more than once in the workbook.",
                )
            )

        code = values.get("plate_code")
        number = values.get("plate_number")
        key = (code if isinstance(code, str) else None, number) if isinstance(number, str) else None
        existing = vehicles_by_plate.get(key) if key is not None else None
        if existing is not None:
            current = _vehicle_values(existing)
            values = {
                field: (current.get(field) if values.get(field) is None else values.get(field))
                for field in _PROFILE_FIELDS
            }
            values["site_id"] = site_id
        else:
            values = {field: values.get(field) for field in _PROFILE_FIELDS}

        selected_images: list[tuple[dict[str, Any], str]] = []
        missing_roles: list[str] = []
        for image_id in draft.image_ids:
            image = image_by_id[image_id]
            role = draft.image_roles.get(image_id) or image.get("kind")
            if role not in {"photo", "license"}:
                missing_roles.append(image_id)
                continue
            selected_images.append((image, str(role)))
        if missing_roles:
            errors.extend(
                _issue(
                    row_id,
                    None,
                    "VEHICLE_IMPORT_IMAGE_ROLE_REQUIRED",
                    f"Choose photo or licence for image {image_id}.",
                )
                for image_id in missing_roles
            )

        reviewed = set(draft.ocr_reviewed_image_ids)
        manual = set(draft.ocr_manual_image_ids)
        identity_confirmed = set(draft.ocr_identity_confirmed_image_ids)
        allowed_license_ids = {
            str(image["image_id"]) for image, role in selected_images if role == "license"
        }
        if not (reviewed | manual | identity_confirmed).issubset(allowed_license_ids):
            errors.append(
                _issue(
                    row_id,
                    None,
                    "VEHICLE_IMPORT_INVALID_FIELD",
                    "OCR review ids must refer to licence images assigned to this row.",
                )
            )
        ocr_review_required = False
        for image, role in selected_images:
            if role != "license":
                continue
            image_id = str(image["image_id"])
            scan = _cached_scan(stage, image)
            if scan is None:
                continue
            # Identity conflicts block the row regardless of "manual" status —
            # manual only opts a row out of value auto-fill/review-required,
            # never out of confirming a scan actually belongs to this vehicle.
            if _scan_identity_conflicts(scan, values) and image_id not in identity_confirmed:
                errors.append(
                    _issue(
                        row_id,
                        None,
                        "VEHICLE_IMPORT_SCAN_IDENTITY_CONFLICT",
                        f"Scanned identity conflicts with the row for image {image_id}.",
                    )
                )
            if image_id in manual:
                continue
            if _scan_has_values(scan) and image_id not in reviewed:
                ocr_review_required = True
            for field in _OCR_FIELDS:
                if values.get(field) is not None:
                    continue
                suggestion = getattr(scan, field)
                if suggestion is not None:
                    values[field] = _scalar(suggestion)

        for required in _REQUIRED_FIELDS:
            if values.get(required) is None:
                errors.append(
                    _issue(
                        row_id,
                        required,
                        "VEHICLE_IMPORT_REQUIRED_FIELD",
                        f"{required} is required.",
                    )
                )

        try:
            VehicleCreate.model_validate({**_profile_payload(values), "new_site": None})
        except ValidationError as exc:
            errors.extend(_pydantic_issues(row_id, exc))

        changes: list[VehicleImportChange] = []
        if existing is not None:
            current = _vehicle_values(existing)
            changes.extend(
                VehicleImportChange(field=field, before=current.get(field), after=values.get(field))
                for field in _PROFILE_FIELDS
                if current.get(field) != values.get(field)
            )
        image_plan, choice_errors, photo_required, license_required, pointer_changes = _choice_plan(
            row_id=row_id,
            draft=draft,
            images=selected_images,
            existing=existing,
        )
        errors.extend(choice_errors)
        changes.extend(pointer_changes)

        assigned_ids = {image_id for row in payload.rows for image_id in row.image_ids}
        for image_id, image in image_by_id.items():
            if image_id in assigned_ids or image_id in excluded_images:
                continue
            if image.get("row_id") == row_id:
                errors.append(
                    _issue(
                        row_id,
                        None,
                        "VEHICLE_IMPORT_UNASSIGNED_IMAGE",
                        f"Image {image_id} must be assigned or excluded.",
                    )
                )

        if draft.excluded:
            action = "excluded"
        elif existing is not None and existing.archived_at is not None:
            errors.append(
                _issue(
                    row_id,
                    "plate_number",
                    "VEHICLE_IMPORT_ARCHIVED_MATCH",
                    "This plate belongs to an archived vehicle; restore it separately.",
                )
            )
            action = "archived"
        elif errors or photo_required or license_required or ocr_review_required:
            action = "invalid"
        elif existing is None:
            action = "create"
        elif changes or any(
            item["dedup_file_id"] is None and item["dedup_image_id"] is None
            for item in image_plan
        ):
            action = "update"
        else:
            action = "unchanged"

        current_photo = _file_url(existing.id, existing.photo_file_id) if existing is not None else None
        current_license = (
            _file_url(existing.id, existing.license_file_id) if existing is not None else None
        )
        response = VehicleImportPreviewRow(
            row_id=row_id,
            action=action,
            vehicle_id=existing.id if existing is not None else None,
            values=values,
            changes=changes,
            errors=errors,
            warnings=warnings,
            current_photo_url=current_photo,
            current_license_url=current_license,
            images=[_image_response(token, image, role) for image, role in selected_images],
            photo_choice_required=photo_required,
            license_choice_required=license_required,
            ocr_review_required=ocr_review_required,
        )
        response_rows.append(response)
        fingerprint = (
            _vehicle_fingerprint(existing)
            if existing is not None
            else _create_fingerprint(
                plate_code=code if isinstance(code, str) else None,
                plate_number=number if isinstance(number, str) else "",
                site=site,
            )
            if site is not None and isinstance(number, str)
            else None
        )
        plans[row_id] = {
            "response": response.model_dump(mode="json"),
            "fingerprint": fingerprint,
            "image_plan": image_plan,
            "photo_action": draft.photo_action,
            "license_action": draft.license_action,
        }

    unresolved = [
        image_id
        for image_id, image in image_by_id.items()
        if image_id not in {value for row in payload.rows for value in row.image_ids}
        and image_id not in excluded_images
        and image.get("row_id") is None
    ]
    if unresolved:
        raise VehicleImportError(
            "VEHICLE_IMPORT_UNASSIGNED_IMAGE",
            "Every unanchored image must be reassigned or excluded.",
            image_ids=unresolved,
        )

    counts = VehicleImportCounts()
    for row in response_rows:
        setattr(counts, row.action, getattr(counts, row.action) + 1)
    revision = uuid.uuid4().hex
    result = VehicleImportPreview(revision=revision, rows=response_rows, counts=counts)
    _write_json(
        stage / "preview-draft.json",
        {
            "revision": revision,
            "response": result.model_dump(mode="json"),
            "plans": plans,
        },
    )
    return result


def _load_preview(stage: Path, revision: str) -> dict[str, Any]:
    path = stage / "preview-draft.json"
    if not path.is_file():
        raise VehicleImportError(
            "VEHICLE_IMPORT_UNKNOWN_REVISION", "The preview revision is unknown or obsolete."
        )
    stored = _json(path)
    if stored.get("revision") != revision:
        raise VehicleImportError(
            "VEHICLE_IMPORT_UNKNOWN_REVISION", "The preview revision is unknown or obsolete."
        )
    return stored


def _selected_plans(
    stored: Mapping[str, Any], request: VehicleImportConfirmRequest
) -> list[dict[str, Any]]:
    if not request.row_ids or len(set(request.row_ids)) != len(request.row_ids):
        raise VehicleImportError(
            "VEHICLE_IMPORT_INVALID_FIELD", "Select one or more unique preview row ids."
        )
    plans = stored.get("plans")
    if not isinstance(plans, dict) or any(row_id not in plans for row_id in request.row_ids):
        raise VehicleImportError(
            "VEHICLE_IMPORT_UNKNOWN_REVISION",
            "A selected row does not belong to this preview revision.",
        )
    selected: list[dict[str, Any]] = []
    for row_id in request.row_ids:
        plan = plans[row_id]
        if not isinstance(plan, dict) or not isinstance(plan.get("response"), dict):
            raise VehicleImportError(
                "VEHICLE_IMPORT_UNKNOWN_REVISION", "The stored preview is invalid."
            )
        response = VehicleImportPreviewRow.model_validate(plan["response"])
        if response.action in {"invalid", "archived", "excluded"}:
            raise VehicleImportError(
                "VEHICLE_IMPORT_INVALID_FIELD",
                f"Row {row_id} cannot be confirmed while its action is {response.action}.",
                row_id=row_id,
            )
        if (
            response.photo_choice_required
            or response.license_choice_required
            or response.ocr_review_required
        ):
            raise VehicleImportError(
                "VEHICLE_IMPORT_INVALID_FIELD",
                f"Row {row_id} still requires review.",
                row_id=row_id,
            )
        selected.append(plan)
    return selected


def _live_fingerprint(db: Session, plan: Mapping[str, Any]) -> dict[str, object] | None:
    response = VehicleImportPreviewRow.model_validate(plan["response"])
    expected = plan.get("fingerprint")
    if not isinstance(expected, dict):
        return None
    if response.vehicle_id is not None:
        vehicle = db.scalars(_vehicle_stmt().where(Vehicle.id == response.vehicle_id)).unique().one_or_none()
        return _vehicle_fingerprint(vehicle) if vehicle is not None else None
    plate_code = response.values.get("plate_code")
    plate_number = response.values.get("plate_number")
    if not isinstance(plate_number, str):
        return None
    code_clause = (
        Vehicle.plate_code.is_(None)
        if plate_code is None
        else Vehicle.plate_code == str(plate_code)
    )
    if db.scalar(select(Vehicle.id).where(code_clause, Vehicle.plate_number == plate_number)) is not None:
        return {"vehicle": "appeared"}
    site_id = response.values.get("site_id")
    site = db.get(VehicleSite, site_id) if isinstance(site_id, int) else None
    if site is None:
        return None
    return _create_fingerprint(
        plate_code=str(plate_code) if plate_code is not None else None,
        plate_number=plate_number,
        site=site,
    )


def _assert_not_stale(db: Session, selected: Iterable[Mapping[str, Any]]) -> None:
    for plan in selected:
        expected = plan.get("fingerprint")
        if expected != _live_fingerprint(db, plan):
            response = VehicleImportPreviewRow.model_validate(plan["response"])
            raise VehicleImportError(
                "VEHICLE_IMPORT_STALE",
                "A vehicle or site changed after preview; preview the workbook again.",
                row_id=response.row_id,
            )


def _payload_values(values: Mapping[str, str | int | None]) -> dict[str, object]:
    return {field: values.get(field) for field in _PROFILE_FIELDS}


def _promote_photo(file: VehicleFile) -> None:
    if file.kind == "gallery":
        file.kind = "photo"


def confirm(
    db: Session,
    token: str,
    request: VehicleImportConfirmRequest,
    *,
    owner: User,
) -> VehicleImportResult:
    """Atomically apply only rows from one exact reviewed preview revision."""
    stage = _stage_path(token, owner=owner)
    stored = _load_preview(stage, request.revision)
    _selected_plans(stored, request)
    claimed = _claim_stage(token, owner=owner)
    created_paths: list[Path] = []
    committed = False
    try:
        stored = _load_preview(claimed, request.revision)
        selected = _selected_plans(stored, request)
        inspection = _json(claimed / "inspection.json")
        image_by_id = {
            str(image["image_id"]): image
            for image in inspection.get("images", [])
            if isinstance(image, dict)
        }

        db.rollback()
        connection = db.connection()
        if connection.dialect.name == "sqlite":
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        _assert_not_stale(db, selected)

        created = 0
        updated = 0
        unchanged = 0
        images_added = 0
        images_skipped = 0
        vehicle_ids: list[int] = []
        file_ids_by_image: dict[str, int] = {}

        for plan in selected:
            response = VehicleImportPreviewRow.model_validate(plan["response"])
            values = _payload_values(response.values)
            if response.action == "create":
                vehicle = vehicle_service._create_vehicle_record(
                    db, VehicleCreate.model_validate({**values, "new_site": None})
                )
                created += 1
            else:
                if response.vehicle_id is None:
                    raise VehicleImportError(
                        "VEHICLE_IMPORT_STALE", "The preview vehicle match is no longer valid."
                    )
                matched = db.scalars(
                    _vehicle_stmt().where(Vehicle.id == response.vehicle_id)
                ).unique().one_or_none()
                if matched is None:
                    raise VehicleImportError(
                        "VEHICLE_IMPORT_STALE", "The preview vehicle no longer exists."
                    )
                vehicle = matched
                if vehicle.archived_at is not None:
                    raise VehicleImportError(
                        "VEHICLE_IMPORT_STALE", "The preview vehicle is archived."
                    )
                if response.action == "update":
                    vehicle_service._update_vehicle_record(
                        db,
                        vehicle,
                        VehicleUpdate.model_validate(values),
                    )
                    updated += 1
                else:
                    unchanged += 1

            # `get_vehicle` (reached via `require_active_vehicle` inside
            # `_store_file_record`) reloads with `populate_existing=True`. This
            # session is `autoflush=False`, so without an explicit flush here
            # any just-set scalar change (the update above, or a prior image's
            # `photo_file_id`/`license_file_id` set below) is unflushed and gets
            # silently overwritten back to its old DB value by that reload.
            db.flush()
            for image_plan in plan.get("image_plan", []):
                if not isinstance(image_plan, dict):
                    raise VehicleImportError(
                        "VEHICLE_IMPORT_UNKNOWN_REVISION", "The stored preview is invalid."
                    )
                image_id = str(image_plan["image_id"])
                role = str(image_plan["role"])
                duplicate_file_id = image_plan.get("dedup_file_id")
                duplicate_image_id = image_plan.get("dedup_image_id")
                if isinstance(duplicate_file_id, int):
                    file = db.get(VehicleFile, duplicate_file_id)
                    if file is None or file.vehicle_id != vehicle.id:
                        raise VehicleImportError(
                            "VEHICLE_IMPORT_STALE", "A deduplicated vehicle image changed."
                        )
                    images_skipped += 1
                elif isinstance(duplicate_image_id, str):
                    existing_id = file_ids_by_image.get(duplicate_image_id)
                    file = db.get(VehicleFile, existing_id) if existing_id is not None else None
                    if file is None:
                        raise VehicleImportError(
                            "VEHICLE_IMPORT_UNKNOWN_REVISION", "The image deduplication plan is invalid."
                        )
                    images_skipped += 1
                else:
                    image = image_by_id[image_id]
                    file, path = vehicle_service._store_file_record(
                        db,
                        vehicle.id,
                        kind=role,
                        filename=str(image["original_name"]),
                        data=_staged_image_path(claimed, image).read_bytes(),
                        media_type=str(image["media_type"]),
                    )
                    created_paths.append(path)
                    images_added += 1
                file_ids_by_image[image_id] = file.id
                if image_plan.get("is_primary"):
                    _promote_photo(file)
                    vehicle.photo_file_id = file.id
                if image_plan.get("is_license_primary"):
                    vehicle.license_file_id = file.id
                # Same reload hazard as above, for the *next* image in this row.
                db.flush()

            if response.action == "create":
                vehicle_service._add_audit(
                    db,
                    "vehicle.created",
                    vehicle.id,
                    owner.email,
                    {
                        "plate_code": vehicle.plate_code,
                        "plate_number": vehicle.plate_number,
                        "site_id": vehicle.site_id,
                    },
                )
            elif response.action == "update":
                vehicle_service._add_audit(
                    db,
                    "vehicle.updated",
                    vehicle.id,
                    owner.email,
                    {change.field: change.after for change in response.changes},
                )
            vehicle_ids.append(vehicle.id)

        vehicle_service._add_audit(
            db,
            "vehicle.imported",
            vehicle_ids[0],
            owner.email,
            {
                "source_filename": str(_json(claimed / "metadata.json")["filename"]),
                "row_ids": request.row_ids,
                "vehicle_ids": vehicle_ids,
            },
            entity_type="vehicle_import",
        )
        db.commit()
        committed = True
        return VehicleImportResult(
            created=created,
            updated=updated,
            unchanged=unchanged,
            images_added=images_added,
            images_skipped=images_skipped,
            vehicle_ids=vehicle_ids,
        )
    except OperationalError as exc:
        db.rollback()
        for path in created_paths:
            path.unlink(missing_ok=True)
            with suppress(OSError):
                path.parent.rmdir()
        if "locked" in str(exc).casefold() or "busy" in str(exc).casefold():
            raise VehicleImportError(
                "VEHICLE_IMPORT_BUSY", "The vehicle database is busy; retry confirmation."
            ) from exc
        raise
    except (Exception, KeyboardInterrupt):
        db.rollback()
        for path in created_paths:
            path.unlink(missing_ok=True)
            with suppress(OSError):
                path.parent.rmdir()
        raise
    finally:
        if not committed:
            _release_claim(claimed, token)


__all__ = [
    "MAX_COMPRESSED_BYTES",
    "STAGED_DIR_NAME",
    "TTL_SECONDS",
    "VehicleImportError",
    "build_vehicle_import_template",
    "confirm",
    "inspect_upload",
    "preview",
    "resolve_image",
    "scan_image",
]
