"""OPERATOR: bring an already-imported Store up to the current opening-stock JSON.

Usage: python scripts/store_apply_packs.py --json scripts/store_opening_2026-10-29.json --actor admin@example.ae

For databases imported before the opening file carried clean names, Arabic names
and carton contents (dev). Items match by ``source_name`` or ``name_en``. Per item:
the English name is replaced, a missing Arabic name is filled, the WhatsApp name is
kept as a delivery-note alias, and when the file gives ``contains_qty`` and the item
has none, every stored quantity of the item (count, delivery, disposal and handover
lines, Minimum level) is multiplied by it, since those were whole Counting units.
One transaction; re-running changes nothing.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import select, update  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.clock import utcnow  # noqa: E402
from app.db import session as db_session  # noqa: E402
from app.db.models import (  # noqa: E402
    StoreBatch,
    StoreCountLine,
    StoreDeliveryLine,
    StoreDisposal,
    StoreHandoverLine,
    StoreItem,
    User,
)
from app.db.repos._locking import begin_immediate_if_idle  # noqa: E402
from app.db.repos.audit_repo import append_audit  # noqa: E402
from app.services import store_service  # noqa: E402

_CONTAINS = ("contains_qty", "contains_unit_en", "contains_unit_ar")


def _to_base_units(db: Session, item: StoreItem, factor: int) -> None:
    batches = select(StoreBatch.id).where(StoreBatch.item_id == item.id).scalar_subquery()
    for model in (StoreCountLine, StoreDeliveryLine, StoreDisposal, StoreHandoverLine):
        db.execute(
            update(model)
            .where(model.batch_id.in_(batches))
            .values(quantity=model.quantity * factor)
        )
    db.execute(
        update(StoreDeliveryLine)
        .where(
            StoreDeliveryLine.batch_id.in_(batches), StoreDeliveryLine.noted_quantity.is_not(None)
        )
        .values(noted_quantity=StoreDeliveryLine.noted_quantity * factor)
    )
    if item.minimum_level is not None:
        item.minimum_level *= factor


def apply_packs(db: Session, data: dict[str, Any], *, actor: str) -> int:
    """Update every matching item in one transaction; returns how many changed."""
    for entry in data["items"]:
        if entry.get("contains_qty") is not None and (
            entry["contains_qty"] < 2 or not all(entry.get(key) for key in _CONTAINS)
        ):
            raise ValueError(f"{entry['name_en']}: contains needs a quantity ≥ 2 and both units")
    begin_immediate_if_idle(db)
    actor_user_id = db.scalar(select(User.id).where(User.email == actor))
    changed = 0
    try:
        for entry in data["items"]:
            names = {entry["name_en"], entry.get("source_name") or entry["name_en"]}
            item = db.scalars(
                select(StoreItem).where(StoreItem.name_en.in_(names)).order_by(StoreItem.id)
            ).first()
            if item is None:
                continue
            fields: dict[str, Any] = {}
            if item.name_en != entry["name_en"]:
                fields["name_en"] = entry["name_en"]
            if item.name_ar is None and entry.get("name_ar"):
                fields["name_ar"] = entry["name_ar"]
            factor = entry.get("contains_qty")
            if factor is not None and item.contains_qty is None:
                fields.update({key: entry[key] for key in _CONTAINS})
                _to_base_units(db, item, factor)
            source = entry.get("source_name")
            if source and source != entry["name_en"]:
                store_service.upsert_item_alias(
                    db, source, item.id, actor=actor, actor_user_id=actor_user_id
                )
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
        changed = apply_packs(db, data, actor=args.actor)
    print(f"updated {changed} Store items")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
