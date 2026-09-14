"""Reusable immutable vehicle main-photo library and storage."""

from __future__ import annotations

import re
import shutil
import uuid
from pathlib import Path

from sqlalchemy import func, inspect, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core.vehicle_photos import ProcessedPhoto, process_photo
from app.db.models import Vehicle, VehicleFile, VehiclePhotoAsset
from app.schemas.vehicle import VehiclePhotoRead

_UNSAFE_CHARS = re.compile('[\\\\/:*?"<>|\x00-\x1f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]')
_VARIANTS = ("thumbnail", "preview", "full")


def _safe_filename(filename: str) -> str:
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    name = _UNSAFE_CHARS.sub("_", name).strip().strip(".") or "vehicle-photo"
    if len(name) <= 180:
        return name
    suffix = Path(name).suffix[:20]
    return f"{Path(name).stem[: 180 - len(suffix)]}{suffix}"


def _usable_label(value: str | None) -> str | None:
    label = (value or "").strip() or None
    if label is not None and len(label) > 128:
        raise ValidationFailedError(
            "VEHICLE_PHOTO_LABEL_TOO_LONG",
            "Vehicle photo labels cannot exceed 128 characters.",
            max_length=128,
        )
    return label


def _data_dir() -> Path:
    return get_settings().data_dir.resolve()


def _library_root() -> Path:
    return _data_dir() / "vehicle_photos"


def _asset_version(asset: VehiclePhotoAsset) -> str:
    if asset.content_hash is not None:
        return asset.content_hash
    return f"legacy-{asset.legacy_file_id or asset.id}"


def asset_url(asset: VehiclePhotoAsset, variant: str) -> str:
    if variant not in _VARIANTS:
        raise ValueError(f"Unknown vehicle photo variant: {variant}")
    return f"/api/v1/vehicles/photo-library/{asset.id}/image/{variant}?v={_asset_version(asset)}"


def asset_urls(asset: VehiclePhotoAsset | None) -> dict[str, str | None]:
    if asset is None:
        return {
            "photo_url": None,
            "photo_thumbnail_url": None,
            "photo_full_url": None,
        }
    return {
        "photo_url": asset_url(asset, "preview"),
        "photo_thumbnail_url": asset_url(asset, "thumbnail"),
        "photo_full_url": asset_url(asset, "full"),
    }


def _usage_count(db: Session, photo_id: int) -> int:
    return int(
        db.scalar(
            select(func.count()).select_from(Vehicle).where(Vehicle.photo_asset_id == photo_id)
        )
        or 0
    )


def _canonical_asset(db: Session, asset: VehiclePhotoAsset) -> VehiclePhotoAsset:
    if asset.canonical_asset_id is None:
        return asset
    canonical = db.get(VehiclePhotoAsset, asset.canonical_asset_id)
    if canonical is None or canonical.canonical_asset_id is not None:
        raise NotFoundError(
            "VEHICLE_PHOTO_NOT_FOUND",
            f"Vehicle photo {asset.id} has no canonical library asset.",
            photo_id=asset.id,
        )
    return canonical


def photo_read(db: Session, asset: VehiclePhotoAsset) -> VehiclePhotoRead:
    canonical = _canonical_asset(db, asset)
    return VehiclePhotoRead(
        id=asset.id,
        label_ar=asset.label_ar or canonical.label_ar,
        label_en=asset.label_en or canonical.label_en,
        original_name=asset.original_name,
        thumbnail_url=asset_url(asset, "thumbnail"),
        preview_url=asset_url(asset, "preview"),
        full_url=asset_url(asset, "full"),
        width=canonical.width,
        height=canonical.height,
        usage_count=_usage_count(db, canonical.id),
    )


def list_photo_assets(db: Session) -> list[VehiclePhotoAsset]:
    return list(
        db.scalars(
            select(VehiclePhotoAsset)
            .where(VehiclePhotoAsset.canonical_asset_id.is_(None))
            .order_by(
                func.coalesce(VehiclePhotoAsset.label_en, VehiclePhotoAsset.label_ar),
                VehiclePhotoAsset.id,
            )
        ).all()
    )


def get_photo_asset(db: Session, photo_id: int) -> VehiclePhotoAsset:
    asset = db.get(VehiclePhotoAsset, photo_id)
    if asset is None:
        raise NotFoundError(
            "VEHICLE_PHOTO_NOT_FOUND",
            f"Vehicle photo {photo_id} does not exist.",
            photo_id=photo_id,
        )
    return asset


def get_selectable_photo_asset(db: Session, photo_id: int) -> VehiclePhotoAsset:
    return _canonical_asset(db, get_photo_asset(db, photo_id))


def _write_photo_files(
    *,
    filename: str,
    original: bytes,
    processed: ProcessedPhoto,
) -> tuple[dict[str, str], Path]:
    data_dir = _data_dir()
    root = _library_root() / uuid.uuid4().hex
    safe_name = _safe_filename(filename)
    paths = {
        "original_path": root / f"original-{safe_name}",
        "thumbnail_path": root / "thumbnail.webp",
        "preview_path": root / "preview.webp",
        "full_path": root / "full.webp",
    }
    try:
        root.mkdir(parents=True, exist_ok=False)
        payloads = {
            "original_path": original,
            "thumbnail_path": processed.thumbnail,
            "preview_path": processed.preview,
            "full_path": processed.full,
        }
        for key, destination in paths.items():
            temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
            temporary.write_bytes(payloads[key])
            temporary.replace(destination)
    except Exception:
        shutil.rmtree(root, ignore_errors=True)
        raise
    return ({key: path.relative_to(data_dir).as_posix() for key, path in paths.items()}, root)


def _create_photo_asset_record(
    db: Session,
    *,
    filename: str,
    data: bytes,
    label_ar: str | None,
    label_en: str | None,
    require_label: bool = True,
    processed: ProcessedPhoto | None = None,
) -> tuple[VehiclePhotoAsset, Path | None]:
    """Process, exact-deduplicate, write, and flush without owning the transaction."""
    normalized_ar = _usable_label(label_ar)
    normalized_en = _usable_label(label_en)
    if require_label and normalized_ar is None and normalized_en is None:
        raise ValidationFailedError(
            "VEHICLE_PHOTO_LABEL_REQUIRED",
            "Provide an Arabic or English photo label.",
        )

    processed_photo = processed or process_photo(data)
    existing = db.scalar(
        select(VehiclePhotoAsset).where(
            VehiclePhotoAsset.content_hash == processed_photo.content_hash
        )
    )
    if existing is not None:
        return existing, None

    paths, root = _write_photo_files(
        filename=filename,
        original=data,
        processed=processed_photo,
    )
    asset = VehiclePhotoAsset(
        label_ar=normalized_ar,
        label_en=normalized_en,
        original_name=_safe_filename(filename),
        content_hash=processed_photo.content_hash,
        width=processed_photo.width,
        height=processed_photo.height,
        **paths,
    )
    try:
        with db.begin_nested():
            db.add(asset)
            db.flush()
    except IntegrityError:
        shutil.rmtree(root, ignore_errors=True)
        canonical = db.scalar(
            select(VehiclePhotoAsset).where(
                VehiclePhotoAsset.content_hash == processed_photo.content_hash
            )
        )
        if canonical is None:
            raise
        return canonical, None
    except Exception:
        shutil.rmtree(root, ignore_errors=True)
        raise
    return asset, root


def create_photo_asset(
    db: Session,
    *,
    filename: str,
    data: bytes,
    label_ar: str | None,
    label_en: str | None,
    processed: ProcessedPhoto | None = None,
) -> VehiclePhotoAsset:
    created_root: Path | None = None
    try:
        asset, created_root = _create_photo_asset_record(
            db,
            filename=filename,
            data=data,
            label_ar=label_ar,
            label_en=label_en,
            processed=processed,
        )
        db.commit()
    except Exception:
        db.rollback()
        if created_root is not None:
            shutil.rmtree(created_root, ignore_errors=True)
        raise
    return get_photo_asset(db, asset.id)


def _resolve_data_path(relative_path: str, *, photo_id: int, library_only: bool) -> Path:
    data_dir = _data_dir()
    path = (data_dir / relative_path).resolve()
    allowed_root = _library_root().resolve() if library_only else data_dir
    if not path.is_relative_to(allowed_root):
        raise ValidationFailedError(
            "VEHICLE_PHOTO_INVALID_PATH",
            "The stored vehicle photo path is outside its allowed data directory.",
            photo_id=photo_id,
        )
    if not path.is_file():
        raise NotFoundError(
            "VEHICLE_PHOTO_MISSING",
            "The vehicle photo is missing on disk.",
            photo_id=photo_id,
        )
    return path


def _asset_storage_roots(asset: VehiclePhotoAsset) -> set[Path]:
    data_dir = _data_dir()
    library_root = _library_root().resolve()
    roots: set[Path] = set()
    for value in (
        asset.original_path,
        asset.thumbnail_path,
        asset.preview_path,
        asset.full_path,
    ):
        if value is None:
            continue
        path = (data_dir / value).resolve()
        if not path.is_relative_to(library_root):
            raise ValidationFailedError(
                "VEHICLE_PHOTO_INVALID_PATH",
                "The stored vehicle photo path is outside its allowed data directory.",
                photo_id=asset.id,
            )
        roots.add(path.parent)
    return roots


def promote_vehicle_file(db: Session, vehicle_id: int, file_id: int) -> VehiclePhotoAsset:
    vehicle = db.get(Vehicle, vehicle_id)
    if vehicle is None:
        raise NotFoundError(
            "VEHICLE_NOT_FOUND", f"Vehicle {vehicle_id} does not exist", vehicle_id=vehicle_id
        )
    if vehicle.archived_at is not None:
        raise ConflictError(
            "VEHICLE_ARCHIVED",
            "Archived vehicles are read-only. Restore the vehicle before changing it.",
            vehicle_id=vehicle_id,
        )
    file = db.scalar(
        select(VehicleFile).where(
            VehicleFile.id == file_id,
            VehicleFile.vehicle_id == vehicle_id,
        )
    )
    if file is None:
        raise NotFoundError(
            "VEHICLE_FILE_NOT_FOUND",
            f"File {file_id} does not belong to vehicle {vehicle_id}",
            vehicle_id=vehicle_id,
            file_id=file_id,
        )
    if file.kind not in {"photo", "gallery"}:
        raise ValidationFailedError(
            "VEHICLE_FILE_KIND_MISMATCH",
            f"File {file_id} is not a photo or gallery image.",
            file_id=file_id,
            expected_kind="photo",
            actual_kind=file.kind,
        )
    source = _resolve_data_path(file.path, photo_id=file.id, library_only=False)
    label_ar = _usable_label(file.label_ar)
    label_en = _usable_label(file.label_en) or Path(file.original_name).stem
    return create_photo_asset(
        db,
        filename=file.original_name,
        data=source.read_bytes(),
        label_ar=label_ar,
        label_en=label_en,
    )


def materialize_photo_asset(db: Session, photo_id: int) -> VehiclePhotoAsset:
    """Materialize one staged legacy asset, exact-merging without losing rollback mapping."""
    asset = get_photo_asset(db, photo_id)
    if asset.canonical_asset_id is not None:
        return _canonical_asset(db, asset)
    paths_ready = all(
        path is not None
        for path in (
            asset.original_path,
            asset.thumbnail_path,
            asset.preview_path,
            asset.full_path,
        )
    )
    if paths_ready and asset.content_hash is not None:
        return asset
    if asset.legacy_file_id is None:
        raise NotFoundError(
            "VEHICLE_PHOTO_SOURCE_MISSING",
            "The staged vehicle photo has no recoverable legacy source.",
            photo_id=photo_id,
        )
    legacy = db.get(VehicleFile, asset.legacy_file_id)
    if legacy is None:
        raise NotFoundError(
            "VEHICLE_PHOTO_SOURCE_MISSING",
            "The legacy source row for this vehicle photo no longer exists.",
            photo_id=photo_id,
            legacy_file_id=asset.legacy_file_id,
        )
    source = _resolve_data_path(legacy.path, photo_id=photo_id, library_only=False)
    data = source.read_bytes()
    processed = process_photo(data)
    canonical = db.scalar(
        select(VehiclePhotoAsset).where(
            VehiclePhotoAsset.content_hash == processed.content_hash,
            VehiclePhotoAsset.id != asset.id,
        )
    )
    if canonical is not None:
        db.execute(
            update(Vehicle)
            .where(Vehicle.photo_asset_id == asset.id)
            .values(photo_asset_id=canonical.id)
        )
        if inspect(db.get_bind()).has_table("vehicle_photo_legacy_assignments"):
            db.execute(
                text(
                    """
                    UPDATE vehicle_photo_legacy_assignments
                    SET photo_asset_id = :canonical_id
                    WHERE photo_asset_id = :duplicate_id
                    """
                ),
                {"canonical_id": canonical.id, "duplicate_id": asset.id},
            )
        duplicate_roots = _asset_storage_roots(asset)
        asset.canonical_asset_id = canonical.id
        asset.content_hash = None
        asset.width = None
        asset.height = None
        asset.original_path = None
        asset.thumbnail_path = None
        asset.preview_path = None
        asset.full_path = None
        db.commit()
        for root in duplicate_roots:
            shutil.rmtree(root, ignore_errors=True)
        return get_photo_asset(db, canonical.id)

    created_root: Path | None = None
    try:
        paths, created_root = _write_photo_files(
            filename=legacy.original_name,
            original=data,
            processed=processed,
        )
        asset.label_ar = _usable_label(asset.label_ar) or _usable_label(legacy.label_ar)
        asset.label_en = (
            _usable_label(asset.label_en)
            or _usable_label(legacy.label_en)
            or Path(legacy.original_name).stem
        )
        asset.original_name = _safe_filename(legacy.original_name)
        asset.content_hash = processed.content_hash
        asset.width = processed.width
        asset.height = processed.height
        asset.original_path = paths["original_path"]
        asset.thumbnail_path = paths["thumbnail_path"]
        asset.preview_path = paths["preview_path"]
        asset.full_path = paths["full_path"]
        db.commit()
    except Exception:
        db.rollback()
        if created_root is not None:
            shutil.rmtree(created_root, ignore_errors=True)
        raise
    return get_photo_asset(db, asset.id)


def resolve_photo_variant(
    db: Session, photo_id: int, variant: str
) -> tuple[VehiclePhotoAsset, Path, str]:
    if variant not in _VARIANTS:
        raise NotFoundError(
            "VEHICLE_PHOTO_VARIANT_NOT_FOUND",
            f"Unknown vehicle photo variant: {variant}",
            photo_id=photo_id,
            variant=variant,
        )
    asset = materialize_photo_asset(db, photo_id)
    relative_path = getattr(asset, f"{variant}_path")
    if not isinstance(relative_path, str):
        raise NotFoundError(
            "VEHICLE_PHOTO_MISSING",
            "The requested vehicle photo variant is unavailable.",
            photo_id=photo_id,
            variant=variant,
        )
    path = _resolve_data_path(relative_path, photo_id=asset.id, library_only=True)
    return asset, path, f'"{_asset_version(asset)}-{variant}"'


def delete_photo_asset(db: Session, photo_id: int) -> None:
    asset = get_photo_asset(db, photo_id)
    canonical = _canonical_asset(db, asset)
    aliases = list(
        db.scalars(
            select(VehiclePhotoAsset).where(VehiclePhotoAsset.canonical_asset_id == canonical.id)
        ).all()
    )
    protected_ids = [canonical.id, *(alias.id for alias in aliases)]
    usage_count = int(
        db.scalar(
            select(func.count())
            .select_from(Vehicle)
            .where(Vehicle.photo_asset_id.in_(protected_ids))
        )
        or 0
    )
    if usage_count:
        raise ConflictError(
            "VEHICLE_PHOTO_IN_USE",
            "The photo is selected by one or more vehicles.",
            photo_id=photo_id,
            usage_count=usage_count,
        )

    deleted_assets = [canonical, *aliases] if asset.id == canonical.id else [asset]
    roots = {
        root for deleted_asset in deleted_assets for root in _asset_storage_roots(deleted_asset)
    }
    for deleted_asset in deleted_assets:
        db.delete(deleted_asset)
    db.commit()
    for root in roots:
        shutil.rmtree(root, ignore_errors=True)


__all__ = [
    "asset_url",
    "asset_urls",
    "create_photo_asset",
    "delete_photo_asset",
    "get_photo_asset",
    "get_selectable_photo_asset",
    "list_photo_assets",
    "materialize_photo_asset",
    "photo_read",
    "promote_vehicle_file",
    "resolve_photo_variant",
]
