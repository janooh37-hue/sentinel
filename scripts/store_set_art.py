"""OPERATOR: fill missing Store drawing fields from the opening-stock JSON.

Usage: python scripts/store_set_art.py --json scripts/store_opening_2026-10-29.json --actor admin@example.ae
Existing non-null fields are never overwritten. Items match by exact name_en.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.clock import utcnow  # noqa: E402
from app.db import session as db_session  # noqa: E402
from app.db.models import StoreItem  # noqa: E402
from app.db.repos._locking import begin_immediate_if_idle  # noqa: E402
from app.db.repos.audit_repo import append_audit  # noqa: E402
from app.services.store_service import _check_art  # noqa: E402


def set_art(db: Session, data: dict[str, Any], *, actor: str) -> int:
    """Fill null fields only, auditing changed items in one atomic transaction."""
    entries = {entry["name_en"]: entry for entry in data["items"]}
    for entry in entries.values():
        _check_art(entry.get("art_kind"), entry.get("art_color"))
    begin_immediate_if_idle(db)
    changed = 0
    try:
        for item in db.scalars(select(StoreItem).where(StoreItem.name_en.in_(entries))).all():
            entry = entries[item.name_en]
            fields = {
                key: entry[key].lower() if key == "art_color" else entry[key]
                for key in ("art_kind", "art_color")
                if getattr(item, key) is None and entry.get(key) is not None
            }
            if not fields:
                continue
            for key, value in fields.items():
                setattr(item, key, value)
            item.updated_at = utcnow()
            append_audit(
                db,
                action="item.updated",
                entity_type="store_item",
                entity_id=item.id,
                actor=actor,
                payload=fields,
            )
            changed += 1
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", required=True, type=Path, help="opening-stock JSON file")
    parser.add_argument("--actor", required=True, help="email recorded as the audit actor")
    args = parser.parse_args()
    data = json.loads(args.json.read_text(encoding="utf-8"))
    with db_session.SessionLocal() as db:
        changed = set_art(db, data, actor=args.actor)
    print(f"updated drawings for {changed} Store items")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
