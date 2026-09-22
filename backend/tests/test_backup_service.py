"""Behavioral coverage for automatic backup allocation and retention."""

import sqlite3
from datetime import datetime
from pathlib import Path

import pytest

from app.services import backup_service


def _completed_backup(dest: Path, stamp: str) -> Path:
    root = dest / f"gssg-backup-{stamp}"
    root.mkdir(parents=True)
    (root / "completed.marker").write_text("ok", encoding="utf-8")
    return root


def test_create_backup_collision_preserves_completed_root(tmp_path):
    data_dir = tmp_path / "data"
    dest = data_dir / "backups" / "auto"
    data_dir.mkdir()
    (data_dir / "gssg.db").write_bytes(b"source")
    existing = _completed_backup(dest, "20260921-020000")

    with pytest.raises(FileExistsError):
        backup_service.create_backup(
            data_dir,
            dest,
            now=datetime(2026, 9, 21, 2, 0, 0),
        )

    assert existing.is_dir()
    assert (existing / "completed.marker").read_text(encoding="utf-8") == "ok"


def _backup_names(dest: Path) -> set[str]:
    return {path.name for path in dest.iterdir() if path.is_dir()}


def test_cli_prunes_before_copy_and_keeps_final_recovery_points(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    dest = data_dir / "backups" / "auto"
    data_dir.mkdir()
    with sqlite3.connect(data_dir / "gssg.db") as connection:
        connection.execute("CREATE TABLE marker (value TEXT)")

    for stamp in ("20260917-020000", "20260918-020000", "20260919-020000", "20260920-020000"):
        _completed_backup(dest, stamp)

    observed_completed_before_copy: list[int] = []
    original_copy_db = backup_service._copy_db

    def observe_copy(source: Path, destination: Path) -> None:
        observed_completed_before_copy.append(len(_backup_names(dest) - {destination.parent.name}))
        original_copy_db(source, destination)

    monkeypatch.setattr(backup_service, "_copy_db", observe_copy)
    assert (
        backup_service.run_cli(["--data-dir", str(data_dir), "--dest", str(dest), "--keep", "3"])
        == 0
    )

    names = _backup_names(dest)
    assert len(names) == 3
    assert {"gssg-backup-20260919-020000", "gssg-backup-20260920-020000"} <= names
    assert (dest / "gssg-backup-20260917-020000").exists() is False
    assert (dest / "gssg-backup-20260918-020000").exists() is False

    assert observed_completed_before_copy == [2]


def test_cli_failure_keeps_completed_backups_and_removes_partial_copy(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    dest = data_dir / "backups" / "auto"
    data_dir.mkdir()
    (data_dir / "gssg.db").write_bytes(b"source")
    for stamp in ("20260917-020000", "20260918-020000", "20260919-020000", "20260920-020000"):
        _completed_backup(dest, stamp)

    attempted_root: list[Path] = []

    def fail_copy(_source: Path, destination: Path) -> None:
        attempted_root.append(destination.parent)
        raise OSError("disk full")

    monkeypatch.setattr(backup_service, "_copy_db", fail_copy)

    assert (
        backup_service.run_cli(["--data-dir", str(data_dir), "--dest", str(dest), "--keep", "3"])
        == 1
    )

    assert _backup_names(dest) == {
        "gssg-backup-20260919-020000",
        "gssg-backup-20260920-020000",
    }
    assert attempted_root
    assert attempted_root[0].exists() is False
