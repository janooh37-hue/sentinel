"""Backed-up, rerunnable per-employee signature consolidation.

Both ``--database`` and ``--data-dir`` are required; ``--database`` must be
``<data-dir>/gssg.db``. Read-only (SQLite ``mode=ro``) unless ``--apply`` is
supplied. Reuses ``user_signature_service.consolidate_employee_signatures``
for the actual reconciliation — see that function's docstring for the exact
precedence rule and conflict/invalid semantics. This script owns discovery
(every employee, plus standalone/unlinked and unreferenced files), the
database backup, and per-employee image backups before any pointer is
cleared.

Never imports ``app.db.session`` or ``app.main`` — those modules touch the
live-configured engine/settings singleton. Dry-run opens its own read-only
SQLite connection so it cannot write even by accident.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

REQUIRED_TABLES = frozenset({"employees", "users", "managers", "submitters"})


class ConsolidationTargetError(RuntimeError):
    """The explicit database/data-dir target is unsafe or has the wrong schema."""


def _absolute_existing_file(path: Path, *, description: str) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise ConsolidationTargetError(f"{description} does not exist: {resolved}")
    return resolved


def _absolute_existing_dir(path: Path, *, description: str) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_dir():
        raise ConsolidationTargetError(f"{description} does not exist: {resolved}")
    return resolved


def _require_target(database: Path, data_dir: Path) -> None:
    expected = (data_dir / "gssg.db").resolve()
    if database != expected:
        raise ConsolidationTargetError(
            f"--database must be <data-dir>/gssg.db: expected {expected}, got {database}"
        )
    with closing(sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)) as conn:
        tables = {
            str(row[0])
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
    missing = REQUIRED_TABLES - tables
    if missing:
        raise ConsolidationTargetError(
            f"Database is missing required tables: {', '.join(sorted(missing))}"
        )


def _backup_database(database: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    destination = backup_dir / f"{database.stem}-signatures-{stamp}.db"
    counter = 1
    while destination.exists():
        destination = backup_dir / f"{database.stem}-signatures-{stamp}-{counter}.db"
        counter += 1
    with (
        closing(sqlite3.connect(database)) as source,
        closing(sqlite3.connect(destination)) as target,
    ):
        source.backup(target)
        target.commit()
    return destination


def _resolve_raw(raw: str | None, data_dir: Path) -> Path | None:
    if not raw:
        return None
    p = Path(raw)
    if not p.is_absolute():
        p = data_dir / p
    try:
        return p.resolve()
    except OSError:
        return None


def _backup_images(paths: set[Path], backup_dir: Path) -> None:
    """Copy every about-to-be-retired legacy image into `backup_dir/images`
    BEFORE any pointer is cleared — originals stay in place either way."""
    dest_dir = backup_dir / "images"
    for src in sorted(paths):
        if not src.is_file():
            continue
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / src.name
        counter = 1
        while dest.exists():
            dest = dest_dir / f"{src.stem}-{counter}{src.suffix}"
            counter += 1
        shutil.copy2(src, dest)


def _failure(exc: Exception) -> dict[str, str]:
    code = getattr(exc, "code", exc.__class__.__name__)
    return {"code": str(code), "message": str(exc)}


def run_consolidation(
    *,
    database: Path,
    data_dir: Path,
    apply: bool,
    backup_dir: Path | None = None,
) -> dict[str, Any]:
    database = _absolute_existing_file(database, description="SQLite database")
    data_dir = _absolute_existing_dir(data_dir, description="Data directory")
    _require_target(database, data_dir)

    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import sessionmaker

    from app.db.models import Employee, Manager, Submitter, User
    from app.services import user_signature_service

    ro_engine = create_engine(
        f"sqlite:///file:{database.as_posix()}?mode=ro&uri=true",
        future=True,
    )
    make_ro_session = sessionmaker(
        bind=ro_engine, autoflush=False, expire_on_commit=False, future=True
    )

    with make_ro_session() as db:
        employee_ids = sorted(db.execute(select(Employee.id)).scalars().all())
        all_users = list(db.execute(select(User)).scalars().all())
        all_managers = list(db.execute(select(Manager)).scalars().all())
        all_submitters = list(db.execute(select(Submitter)).scalars().all())

    unlinked_report = (
        [
            {"kind": "user", "id": u.id, "status": "unlinked"}
            for u in all_users
            if u.employee_id is None and u.signature_path
        ]
        + [
            {"kind": "manager", "id": m.id, "status": "unlinked"}
            for m in all_managers
            if m.user_id is None and m.sig_path
        ]
        + [
            {"kind": "submitter", "id": s.id, "status": "unlinked"}
            for s in all_submitters
            if s.employee_id is None and s.stored_sig_path
        ]
    )

    referenced_paths = {
        p
        for p in (
            _resolve_raw(raw, data_dir)
            for raw in (
                *(u.signature_path for u in all_users),
                *(m.sig_path for m in all_managers),
                *(s.stored_sig_path for s in all_submitters),
            )
        )
        if p is not None
    }
    linked_legacy_paths = {
        p
        for p in (
            _resolve_raw(raw, data_dir)
            for raw in (
                *(u.signature_path for u in all_users if u.employee_id),
                *(m.sig_path for m in all_managers if m.user_id is not None),
                *(s.stored_sig_path for s in all_submitters if s.employee_id),
            )
        )
        if p is not None
    }

    unreferenced_report: list[dict[str, Any]] = []
    managers_dir = data_dir / "signatures" / "managers"
    if managers_dir.is_dir():
        for f in sorted(managers_dir.glob("*.png")):
            if f.resolve() not in referenced_paths:
                unreferenced_report.append(
                    {"kind": "manager_file", "path": str(f), "status": "unreferenced"}
                )
    signatures_dir = data_dir / "signatures"
    if signatures_dir.is_dir():
        for sub in sorted(signatures_dir.iterdir()):
            if not sub.is_dir() or sub.name == "managers":
                continue
            for f in sorted(sub.glob("signature.*")):
                if f.resolve() not in referenced_paths:
                    unreferenced_report.append(
                        {"kind": "account_file", "path": str(f), "status": "unreferenced"}
                    )
    vault_dir = data_dir / "vault"
    if vault_dir.is_dir():
        known = {str(eid) for eid in employee_ids}
        for emp_dir in sorted(vault_dir.iterdir()):
            if not emp_dir.is_dir() or emp_dir.name in known:
                continue
            sig = emp_dir / "documents" / "signature.png"
            if sig.is_file():
                unreferenced_report.append(
                    {"kind": "vault_file", "path": str(sig), "status": "unreferenced"}
                )

    backup: dict[str, str | None] = {"database": None, "images_dir": None}
    engines = [ro_engine]
    if apply:
        dest_dir = (
            backup_dir.expanduser().resolve()
            if backup_dir is not None
            else database.parent / "backups"
        )
        backup["database"] = str(_backup_database(database, dest_dir))
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        run_backup_dir = dest_dir / f"signature-consolidation-{stamp}"
        _backup_images(linked_legacy_paths, run_backup_dir)
        backup["images_dir"] = str(run_backup_dir / "images") if linked_legacy_paths else None
        rw_engine = create_engine(f"sqlite:///{database.as_posix()}", future=True)
        engines.append(rw_engine)
        make_session = sessionmaker(
            bind=rw_engine, autoflush=False, expire_on_commit=False, future=True
        )
    else:
        make_session = make_ro_session

    employees_report: list[dict[str, Any]] = []
    try:
        with make_session() as db:
            for employee_id in employee_ids:
                try:
                    result = user_signature_service.consolidate_employee_signatures(
                        db, employee_id, data_dir=data_dir, apply=apply
                    )
                    if apply:
                        db.commit()
                except Exception as exc:  # pragma: no cover - defensive
                    db.rollback()
                    result = {
                        "employee_id": employee_id,
                        "status": "invalid",
                        "source": None,
                        "reason": None,
                        "error": _failure(exc),
                    }
                employees_report.append(result)
    finally:
        for eng in engines:
            eng.dispose()

    status_counts: dict[str, int] = {}
    for row in employees_report:
        status_counts[row["status"]] = status_counts.get(row["status"], 0) + 1

    return {
        "mode": "apply" if apply else "dry-run",
        "database": str(database),
        "data_dir": str(data_dir),
        "backup": backup,
        "employees": employees_report,
        "unlinked": unlinked_report,
        "unreferenced": unreferenced_report,
        "summary": {
            "employee_count": len(employee_ids),
            "status_counts": status_counts,
            "unlinked_count": len(unlinked_report),
            "unreferenced_count": len(unreferenced_report),
        },
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Dry-run or apply per-employee signature consolidation."
    )
    parser.add_argument("--database", type=Path, required=True, help="Explicit SQLite DB path")
    parser.add_argument("--data-dir", type=Path, required=True, help="Explicit data directory")
    parser.add_argument("--apply", action="store_true", help="Write after creating a backup")
    parser.add_argument(
        "--backup-dir",
        type=Path,
        help="Backup destination (apply only; default: <database-dir>/backups)",
    )
    parser.add_argument("--report", type=Path, help="Optional JSON report output path")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        report = run_consolidation(
            database=args.database,
            data_dir=args.data_dir,
            apply=args.apply,
            backup_dir=args.backup_dir,
        )
    except ConsolidationTargetError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False, indent=2))
        return 2

    output = json.dumps(report, ensure_ascii=False, indent=2)
    print(output)
    if args.report is not None:
        report_path = args.report.expanduser().resolve()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = report_path.with_name(f".{report_path.name}.tmp")
        temporary.write_text(output + "\n", encoding="utf-8")
        temporary.replace(report_path)

    counts = report["summary"]["status_counts"]
    return 1 if (counts.get("conflict", 0) or counts.get("invalid", 0)) else 0


if __name__ == "__main__":
    raise SystemExit(main())
