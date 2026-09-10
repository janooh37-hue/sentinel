"""Add reusable vehicle photo assets and preserve legacy main-photo assignments.

Revision ID: 0087_vehicle_photo_library
Revises: 0086_merge_0085_heads
Create Date: 2026-09-10 00:00:00.000000
"""

from __future__ import annotations

import shutil
import uuid
from collections.abc import Sequence
from contextlib import suppress
from pathlib import Path

import sqlalchemy as sa
from alembic import context, op

revision: str = "0087_vehicle_photo_library"
down_revision: str | Sequence[str] | None = "0086_merge_0085_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vehicle_photo_assets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("label_ar", sa.String(length=128), nullable=True),
        sa.Column("label_en", sa.String(length=128), nullable=True),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("original_path", sa.Text(), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("thumbnail_path", sa.Text(), nullable=True),
        sa.Column("preview_path", sa.Text(), nullable=True),
        sa.Column("full_path", sa.Text(), nullable=True),
        sa.Column("legacy_file_id", sa.Integer(), nullable=True),
        sa.Column("canonical_asset_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("content_hash", name="uq_vehicle_photo_assets_content_hash"),
        sa.UniqueConstraint("legacy_file_id", name="uq_vehicle_photo_assets_legacy_file_id"),
    )
    op.create_table(
        "vehicle_photo_legacy_assignments",
        sa.Column("vehicle_id", sa.Integer(), primary_key=True),
        sa.Column("photo_file_id", sa.Integer(), nullable=False),
        sa.Column("photo_asset_id", sa.Integer(), nullable=False),
    )

    connection = op.get_bind()
    connection.execute(
        sa.text(
            """
            INSERT INTO vehicle_photo_assets (
                label_ar,
                label_en,
                original_name,
                legacy_file_id,
                created_at
            )
            SELECT
                vf.label_ar,
                COALESCE(
                    NULLIF(TRIM(vf.label_en), ''),
                    vf.original_name,
                    'Legacy vehicle photo ' || legacy.photo_file_id
                ),
                COALESCE(vf.original_name, 'legacy-file-' || legacy.photo_file_id),
                legacy.photo_file_id,
                COALESCE(vf.created_at, CURRENT_TIMESTAMP)
            FROM (
                SELECT DISTINCT photo_file_id
                FROM vehicles
                WHERE photo_file_id IS NOT NULL
            ) AS legacy
            LEFT JOIN vehicle_files AS vf ON vf.id = legacy.photo_file_id
            ORDER BY legacy.photo_file_id
            """
        )
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO vehicle_photo_legacy_assignments (
                vehicle_id,
                photo_file_id,
                photo_asset_id
            )
            SELECT vehicle.id, vehicle.photo_file_id, asset.id
            FROM vehicles AS vehicle
            JOIN vehicle_photo_assets AS asset
              ON asset.legacy_file_id = vehicle.photo_file_id
            WHERE vehicle.photo_file_id IS NOT NULL
            """
        )
    )

    with op.batch_alter_table("vehicles") as batch:
        batch.add_column(sa.Column("photo_asset_id", sa.Integer(), nullable=True))
        batch.create_index("ix_vehicles_photo_asset", ["photo_asset_id"], unique=False)
    connection.execute(
        sa.text(
            """
            UPDATE vehicles
            SET photo_asset_id = (
                SELECT asset.id
                FROM vehicle_photo_assets AS asset
                WHERE asset.legacy_file_id = vehicles.photo_file_id
            )
            WHERE photo_file_id IS NOT NULL
            """
        )
    )
    with op.batch_alter_table("vehicles") as batch:
        batch.drop_column("photo_file_id")


def _downgrade_data_dir() -> Path:
    explicit = context.get_x_argument(as_dictionary=True).get("data_dir")
    if explicit:
        return Path(explicit).expanduser().resolve()
    from app.config import get_settings

    return get_settings().data_dir.resolve()


def _downgrade_source(assignment: sa.RowMapping, data_dir: Path) -> tuple[Path, str, str]:
    full_path = assignment["full_path"]
    legacy_path = assignment["legacy_path"]
    original_path = assignment["original_path"]
    asset_name = str(assignment["asset_original_name"])
    candidates: list[tuple[str, str, str]] = []
    if isinstance(full_path, str):
        candidates.append(
            (
                full_path,
                f"{Path(asset_name).stem}.webp",
                "image/webp",
            )
        )
    if isinstance(legacy_path, str):
        candidates.append(
            (
                legacy_path,
                str(assignment["legacy_original_name"]),
                str(assignment["legacy_media_type"]),
            )
        )
    if isinstance(original_path, str):
        candidates.append(
            (
                original_path,
                asset_name,
                {
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".webp": "image/webp",
                }.get(Path(asset_name).suffix.lower(), "application/octet-stream"),
            )
        )
    for relative_path, original_name, media_type in candidates:
        source = (data_dir / relative_path).resolve()
        if source.is_relative_to(data_dir) and source.is_file():
            return source, original_name, media_type
    attempted = ", ".join(repr(candidate[0]) for candidate in candidates) or "no paths"
    raise RuntimeError(
        f"Cannot downgrade vehicle {assignment['vehicle_id']}: selected photo asset "
        f"{assignment['current_asset_id']} has no usable recovery source ({attempted}) "
        f"under {data_dir}. Run the backed-up vehicle photo conversion/prewarm command "
        "against this exact data directory before downgrading, or restore the database backup."
    )


def downgrade() -> None:
    connection = op.get_bind()
    assignments = list(
        connection.execute(
            sa.text(
                """
                SELECT
                    vehicle.id AS vehicle_id,
                    vehicle.photo_asset_id AS current_asset_id,
                    legacy.photo_file_id AS original_file_id,
                    legacy.photo_asset_id AS original_asset_id,
                    asset.label_ar,
                    asset.label_en,
                    asset.original_name AS asset_original_name,
                    asset.full_path,
                    asset.original_path,
                    source.path AS legacy_path,
                    source.original_name AS legacy_original_name,
                    source.media_type AS legacy_media_type
                FROM vehicles AS vehicle
                LEFT JOIN vehicle_photo_legacy_assignments AS legacy
                  ON legacy.vehicle_id = vehicle.id
                LEFT JOIN vehicle_photo_assets AS asset
                  ON asset.id = vehicle.photo_asset_id
                LEFT JOIN vehicle_files AS source
                  ON source.id = asset.legacy_file_id
                ORDER BY vehicle.id
                """
            )
        ).mappings()
    )
    changed = [
        assignment
        for assignment in assignments
        if assignment["current_asset_id"] is not None
        and assignment["current_asset_id"] != assignment["original_asset_id"]
    ]
    data_dir = _downgrade_data_dir() if changed else None
    planned_sources = {
        int(assignment["vehicle_id"]): _downgrade_source(assignment, data_dir)
        for assignment in changed
        if data_dir is not None
    }

    with op.batch_alter_table("vehicles") as batch:
        batch.add_column(sa.Column("photo_file_id", sa.Integer(), nullable=True))

    created_files: list[Path] = []
    try:
        for assignment in assignments:
            vehicle_id = int(assignment["vehicle_id"])
            current_asset_id = assignment["current_asset_id"]
            original_asset_id = assignment["original_asset_id"]
            if current_asset_id is None:
                photo_file_id = None
            elif original_asset_id is not None and current_asset_id == original_asset_id:
                photo_file_id = int(assignment["original_file_id"])
            else:
                assert data_dir is not None
                source, original_name, media_type = planned_sources[vehicle_id]
                destination_dir = data_dir / "vehicle_files" / str(vehicle_id) / "photo"
                suffix = Path(original_name).suffix or ".bin"
                destination = destination_dir / f"{uuid.uuid4().hex}-rollback{suffix}"
                temporary = destination.with_name(f".{destination.name}.tmp")
                destination_dir.mkdir(parents=True, exist_ok=True)
                try:
                    shutil.copyfile(source, temporary)
                    temporary.replace(destination)
                finally:
                    temporary.unlink(missing_ok=True)
                created_files.append(destination)
                inserted = connection.execute(
                    sa.text(
                        """
                        INSERT INTO vehicle_files (
                            vehicle_id,
                            kind,
                            label_ar,
                            label_en,
                            path,
                            original_name,
                            media_type,
                            size,
                            created_at
                        )
                        VALUES (
                            :vehicle_id,
                            'photo',
                            :label_ar,
                            :label_en,
                            :path,
                            :original_name,
                            :media_type,
                            :size,
                            CURRENT_TIMESTAMP
                        )
                        """
                    ),
                    {
                        "vehicle_id": vehicle_id,
                        "label_ar": assignment["label_ar"],
                        "label_en": assignment["label_en"],
                        "path": destination.relative_to(data_dir).as_posix(),
                        "original_name": original_name,
                        "media_type": media_type,
                        "size": destination.stat().st_size,
                    },
                )
                if inserted.lastrowid is None:
                    raise RuntimeError("Could not create downgrade vehicle photo record")
                photo_file_id = int(inserted.lastrowid)
            connection.execute(
                sa.text(
                    "UPDATE vehicles SET photo_file_id = :photo_file_id WHERE id = :vehicle_id"
                ),
                {"photo_file_id": photo_file_id, "vehicle_id": vehicle_id},
            )

        with op.batch_alter_table("vehicles") as batch:
            batch.drop_index("ix_vehicles_photo_asset")
            batch.drop_column("photo_asset_id")
        op.drop_table("vehicle_photo_legacy_assignments")
        op.drop_table("vehicle_photo_assets")
    except BaseException:
        for created in reversed(created_files):
            created.unlink(missing_ok=True)
            with suppress(OSError):
                created.parent.rmdir()
        raise
