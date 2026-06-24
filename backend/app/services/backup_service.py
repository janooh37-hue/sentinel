"""Consistent, restorable backups of the GSSG data directory.

The SQLite DB runs in WAL mode (``db/session.py``), so a plain file copy can be
torn -- uncheckpointed pages live in the ``-wal`` sidecar. We use the SQLite
**online-backup API** (``sqlite3.Connection.backup``) which produces a
transactionally consistent copy even while the service is writing. The record
file trees under ``data_dir`` are copied with ``shutil.copytree``.

Pure module: ``create_backup`` / ``prune_backups`` take explicit paths and never
read global settings, so they unit-test against a temp data dir. The ``__main__``
entry resolves ``get_settings()`` once and hands the paths in.

Run (also via scripts/backup-db.ps1):
    venv/Scripts/python.exe -X utf8 -m app.services.backup_service
    venv/Scripts/python.exe -X utf8 -m app.services.backup_service --keep 30
    venv/Scripts/python.exe -X utf8 -m app.services.backup_service --dest D:/gssg-backups
"""

from __future__ import annotations

import argparse
import logging
import shutil
import sqlite3
import sys
from contextlib import closing
from datetime import datetime
from pathlib import Path

log = logging.getLogger(__name__)

# Record file trees under data_dir to back up. Excludes logs/ (noise),
# backups/ (would recurse), and cache/ (regenerable thumbnails).
_FILE_SUBDIRS: tuple[str, ...] = (
    "vault",
    "book_attachments",
    "ledger_attachments",
    "signatures",
    "output",
    "leave_certificates",
)

_BACKUP_PREFIX = "gssg-backup-"
_TIMESTAMP_FMT = "%Y%m%d-%H%M%S"


def _copy_db(src_db: Path, dest_db: Path) -> None:
    """Copy a SQLite DB consistently via the online-backup API (WAL-safe)."""
    # Open the source read-only-ish (a normal connection is fine; backup reads a
    # consistent snapshot). Close BOTH connections -- filterwarnings=error turns a
    # leaked handle into a ResourceWarning test failure.
    with closing(sqlite3.connect(src_db)) as src, closing(sqlite3.connect(dest_db)) as dst:
        src.backup(dst)  # whole-DB online backup


def create_backup(data_dir: Path, dest_dir: Path, *, now: datetime | None = None) -> Path:
    """Write a timestamped, restorable backup of ``data_dir`` under ``dest_dir``.

    Returns the backup-root directory. The DB is copied via the online-backup
    API; each present file subtree is copied with ``copytree``. Missing pieces
    (fresh install) are skipped, not errors.
    """
    # datetime.now() is intentionally local wall-clock (not UTC) so backup folder
    # names match the server operator's local time; prune_backups sorts by name.
    stamp = (now or datetime.now()).strftime(_TIMESTAMP_FMT)
    backup_root = dest_dir / f"{_BACKUP_PREFIX}{stamp}"
    backup_root.mkdir(parents=True, exist_ok=True)

    try:
        src_db = data_dir / "gssg.db"
        if src_db.is_file():
            _copy_db(src_db, backup_root / "gssg.db")
            log.info("backup: copied gssg.db via online-backup API")
        else:
            log.warning("backup: no gssg.db at %s -- skipping DB copy", src_db)

        for name in _FILE_SUBDIRS:
            src_tree = data_dir / name
            if src_tree.is_dir():
                shutil.copytree(src_tree, backup_root / name)
                log.info("backup: copied tree %s", name)
    except Exception:
        # Remove the partial backup dir so a failed run leaves no half-written
        # artefact that looks like a valid backup on the next prune pass.
        shutil.rmtree(backup_root, ignore_errors=True)
        raise

    log.info("backup: wrote %s", backup_root)
    return backup_root


def prune_backups(dest_dir: Path, *, keep: int = 14) -> list[Path]:
    """Delete all but the ``keep`` newest ``gssg-backup-*`` dirs in ``dest_dir``.

    Sorts by directory name -- the ``YYYYMMDD-HHMMSS`` stamp is chronological, so
    no mtime reliance. Returns the list of deleted backup roots.
    """
    if keep <= 0:
        raise ValueError(f"keep must be positive, got {keep}")
    if not dest_dir.is_dir():
        return []

    backups = sorted(
        (p for p in dest_dir.iterdir() if p.is_dir() and p.name.startswith(_BACKUP_PREFIX)),
        key=lambda p: p.name,
        reverse=True,  # newest first
    )
    stale = backups[keep:]
    for old in stale:
        shutil.rmtree(old)
        log.info("backup: pruned %s", old.name)
    return stale


def run_cli(argv: list[str] | None = None) -> int:
    """CLI: create a backup then prune. Returns a process exit code."""
    parser = argparse.ArgumentParser(description="Create a consistent GSSG backup, then prune.")
    parser.add_argument("--data-dir", type=Path, default=None,
                        help="source data dir (default: GSSG_DATA_DIR / settings)")
    parser.add_argument("--dest", type=Path, default=None,
                        help="backup destination (default: <data_dir>/backups/auto)")
    parser.add_argument("--keep", type=int, default=14, help="daily copies to retain (default 14)")
    args = parser.parse_args(argv)

    if args.data_dir is not None:
        data_dir = args.data_dir
    else:
        from app.config import get_settings  # local import: avoids settings load in unit tests
        data_dir = get_settings().data_dir
    dest = args.dest if args.dest is not None else data_dir / "backups" / "auto"

    try:
        root = create_backup(data_dir, dest)
        pruned = prune_backups(dest, keep=args.keep)
    except Exception as exc:  # top-level CLI guard; log + nonzero exit
        log.exception("backup failed: %s", exc)
        print(f"backup FAILED: {exc}", file=sys.stderr)
        return 1

    print(f"backup OK: {root}")
    print(f"pruned {len(pruned)} old backup(s); kept {args.keep}")
    return 0


if __name__ == "__main__":
    raise SystemExit(run_cli())
