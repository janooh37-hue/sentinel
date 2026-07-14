"""DEV/OPERATOR: soft-delete leftover Correspondence-Log auto-log rows.

The Correspondence Log was removed 2026-06-25 (see
docs/superpowers/specs/2026-06-25-ledger-fixes-and-smart-folders-design.md §A).
The four auto-log hooks that wrote NULL-owner ``LedgerEntry`` rows (one per
doc-generation / sign / intake / sent-email) are gone, and the personal mailbox
folders already exclude any ``source_kind``-bearing row, so these leftovers are
harmless — but this script removes the historical clutter from the table.

It groups by nothing: every ``LedgerEntry`` with ``owner_user_id IS NULL AND
source_kind IS NOT NULL`` (and not already soft-deleted) is a Correspondence-Log
auto-log row. With ``--apply`` it soft-deletes them (sets ``deleted_at``);
reversible by clearing ``deleted_at``. Dry-run by default.

Usage:
  venv/Scripts/python.exe -X utf8 scripts/cleanup_correspondence_log_rows.py
  venv/Scripts/python.exe -X utf8 scripts/cleanup_correspondence_log_rows.py --apply
"""
from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import func, select  # noqa: E402

from app.db import session as db_session  # noqa: E402
from app.db.models import LedgerEntry  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="soft-delete the auto-log rows (default: dry-run)",
    )
    args = parser.parse_args()

    db_path = (ROOT / "data" / "gssg.db").as_posix()
    db_session.init_engine(f"sqlite:///{db_path}")

    # The Correspondence-Log signature: NULL owner + a source_kind, not already
    # soft-deleted. (Legitimate shared mail has source_kind IS NULL — untouched.)
    where_clause = (
        LedgerEntry.owner_user_id.is_(None),
        LedgerEntry.source_kind.is_not(None),
        LedgerEntry.deleted_at.is_(None),
    )

    with db_session.SessionLocal() as db:
        by_kind = db.execute(
            select(LedgerEntry.source_kind, func.count().label("n"))
            .where(*where_clause)
            .group_by(LedgerEntry.source_kind)
            .order_by(func.count().desc())
        ).all()

        total = sum(n for _kind, n in by_kind)
        if total == 0:
            print("No Correspondence-Log auto-log rows found.")
            return 0

        print(f"{'COUNT':>6}  SOURCE_KIND")
        for kind, n in by_kind:
            print(f"{n:>6}  {kind}")
        print(f"\n{total} Correspondence-Log auto-log rows (owner NULL, source_kind set).")

        if not args.apply:
            print("\nDry-run only. Re-run with --apply to soft-delete them.")
            return 0

        now = datetime.now(UTC).replace(tzinfo=None)
        rows = db.execute(select(LedgerEntry).where(*where_clause)).scalars().all()
        for row in rows:
            row.deleted_at = now
        db.commit()
        print(
            f"\nSoft-deleted {len(rows)} rows (deleted_at={now.isoformat()}). "
            "Reverse with: UPDATE ledger_entries SET deleted_at = NULL "
            "WHERE deleted_at = '<that timestamp>'."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
