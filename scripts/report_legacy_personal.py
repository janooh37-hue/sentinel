"""DEV SNAPSHOT ONLY: list legacy Personal records for the ADR 0007 D5 review.

Migration 0110 turned every Personal record into Unclassified + named
distribution (only its creator can open it) and left a ``book_legacy_personal``
audit row for each. This read-only report writes one CSV row per record: id,
ref, creator, who set Personal (from ``book_confidentiality_changed`` audit
rows; a record created as Personal was set by its creator), and a flag when
that person was not the creator. An admin then restores organization
distribution to the records the review picks (``POST /books/{id}/restore-distribution``).

Run it against the dev snapshot, never against production data.

Usage:
  venv/Scripts/python.exe -X utf8 scripts/report_legacy_personal.py --db data/gssg.db --out legacy.csv
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.db import session as db_session  # noqa: E402
from app.services import book_send_service  # noqa: E402

COLUMNS = ("id", "ref", "creator", "set_personal_by", "set_by_not_creator")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=ROOT / "data" / "gssg.db")
    parser.add_argument("--out", type=Path, default=None, help="CSV path (default: stdout)")
    args = parser.parse_args()

    db_session.init_engine(f"sqlite:///{args.db.resolve().as_posix()}")
    with db_session.SessionLocal() as db:
        rows = book_send_service.legacy_personal_report(db)

    out = args.out.open("w", newline="", encoding="utf-8") if args.out else sys.stdout
    try:
        writer = csv.writer(out)
        writer.writerow(COLUMNS)
        for row in rows:
            writer.writerow(
                (row.book_id, row.ref_number, row.creator, row.set_by, row.set_by_not_creator)
            )
    finally:
        if args.out:
            out.close()
    print(f"{len(rows)} legacy Personal records.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
