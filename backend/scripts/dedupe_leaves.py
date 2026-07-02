"""Soft-delete duplicate leave rows (audit 2026-07-02 cleanup).

Keeps the lowest id per natural key ``(employee_id, leave_type, start_date,
end_date)`` among non-deleted leaves, re-pointing any ``Document.leave_id`` from
a dropped row to the survivor first. See ``app.services.leave_dedupe``.

DRY-RUN by default — prints the plan and exits without writing. Use ``--apply``
to mutate, and ONLY after a fresh backup + explicit approval.

    # preview against a copy of the live DB (safe, read-only):
    python backend/scripts/dedupe_leaves.py --db data/gssg.db.dedupe-preview
    # apply (gated):
    python backend/scripts/dedupe_leaves.py --apply
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # put backend/ on the path

from app.db.session import _sqlite_url_for, attach_sqlite_pragmas
from app.services.leave_dedupe import apply_dedupe, plan_dedupe

DEFAULT_DB = Path(__file__).resolve().parents[2] / "data" / "gssg.db"


def _session_for(db_path: Path) -> Session:
    eng = create_engine(_sqlite_url_for(str(db_path)), future=True)
    attach_sqlite_pragmas(eng, wal=False)
    return sessionmaker(bind=eng, future=True, expire_on_commit=False)()


def main() -> None:
    ap = argparse.ArgumentParser(description="Soft-delete duplicate leave rows.")
    ap.add_argument(
        "--db", default=str(DEFAULT_DB), help="SQLite DB path (default: live data/gssg.db)"
    )
    ap.add_argument("--apply", action="store_true", help="mutate (default is dry-run)")
    args = ap.parse_args()

    db = _session_for(Path(args.db))
    try:
        groups = plan_dedupe(db)
        total = sum(len(g.drop_ids) for g in groups)
        print(f"[dedupe] db={args.db}")
        print(f"[dedupe] {len(groups)} duplicate groups, {total} rows to soft-delete")
        for g in groups[:25]:
            print(f"  keep {g.keep_id}  drop {len(g.drop_ids)}  {g.key}")
        if len(groups) > 25:
            print(f"  … and {len(groups) - 25} more groups")
        if not args.apply:
            print("[dedupe] DRY-RUN only. Re-run with --apply after backup + approval.")
            return
        dropped = apply_dedupe(db, groups)
        print(f"[dedupe] applied: soft-deleted {dropped} rows.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
