"""OPERATOR: create the opening Store items and their first Stock count.

Reads an opening-stock JSON (``scripts/store_opening_2026-10-29.json``) and goes
through the store service, so Item codes are allocated in file order (ST-0001,
ST-0002, ...) and the count passes the same rules as one entered in the app.
Refuses to run once any Store item exists, which makes it safe to re-run.

Usage:
  venv/Scripts/python.exe -X utf8 scripts/store_import_opening.py \
      --json scripts/store_opening_2026-10-29.json --actor admin@example.ae
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from pydantic import BaseModel, Field, field_validator  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db import session as db_session  # noqa: E402
from app.db.models import StoreCategory, StoreItem, User  # noqa: E402
from app.db.repos._locking import begin_immediate_if_idle  # noqa: E402
from app.schemas.store import (  # noqa: E402
    StoreCategoryCreate,
    StoreCountLineInput,
    StoreCountRead,
    StoreCountWrite,
    StoreItemCreate,
    parse_expiry,
)
from app.services import store_service  # noqa: E402

# Arabic names for the categories the opening file uses, matching the
# migration seed; only used when a test database has no seeded categories.
_CATEGORY_AR = {"Pantry": "ضيافة", "Protective": "وقاية"}


class StoreNotEmptyError(RuntimeError):
    """The Store already has items; the opening import runs only once."""


class _OpeningBatch(BaseModel):
    expiry: str | None
    quantity: int = Field(ge=0)

    @field_validator("expiry")
    @classmethod
    def _valid_expiry(cls, value: str | None) -> str | None:
        parse_expiry(value)
        return value


class _OpeningItem(BaseModel):
    name_en: str = Field(min_length=1)
    name_ar: str | None = None
    category: str = Field(min_length=1)
    counting_unit_en: str = Field(min_length=1)
    counting_unit_ar: str = Field(min_length=1)
    art_kind: str | None = None
    art_color: str | None = None
    batches: list[_OpeningBatch] = Field(min_length=1)


class _Opening(BaseModel):
    counted_on: date
    note: str | None = None
    items: list[_OpeningItem] = Field(min_length=1)


def _category_id(db: Session, name_en: str, actor: str) -> int:
    existing = db.scalar(select(StoreCategory.id).where(StoreCategory.name_en == name_en))
    if existing is not None:
        return existing
    created = store_service.create_category(
        db,
        StoreCategoryCreate(name_en=name_en, name_ar=_CATEGORY_AR.get(name_en, name_en)),
        actor=actor,
        commit=False,
    )
    return created.id


def import_opening(db: Session, data: dict[str, Any], *, actor: str) -> StoreCountRead:
    """Validate the whole file, then create every item and the count in one transaction.

    Items are created in file order, so their codes follow it. Any failure rolls
    the whole import back: the Store is either fully opened or left empty.
    """
    opening = _Opening.model_validate(data)
    begin_immediate_if_idle(db)
    try:
        if db.scalar(select(StoreItem.id).limit(1)) is not None:
            raise StoreNotEmptyError("The Store already has items; opening stock was imported.")
        actor_user_id = db.scalar(select(User.id).where(User.email == actor))
        lines: list[StoreCountLineInput] = []
        for entry in opening.items:
            item = store_service.create_item(
                db,
                StoreItemCreate(
                    name_en=entry.name_en,
                    name_ar=entry.name_ar,
                    category_id=_category_id(db, entry.category, actor),
                    counting_unit_en=entry.counting_unit_en,
                    counting_unit_ar=entry.counting_unit_ar,
                    art_kind=entry.art_kind,
                    art_color=entry.art_color,
                ),
                actor=actor,
                actor_user_id=actor_user_id,
                commit=False,
            )
            lines.extend(
                StoreCountLineInput(item_id=item.id, expiry=batch.expiry, quantity=batch.quantity)
                for batch in entry.batches
            )
        count = store_service.create_count(
            db,
            StoreCountWrite(counted_on=opening.counted_on, note=opening.note, lines=lines),
            actor=actor,
            actor_user_id=actor_user_id,
            commit=False,
        )
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", required=True, type=Path, help="opening-stock JSON file")
    parser.add_argument("--actor", required=True, help="email recorded as the audit actor")
    args = parser.parse_args()
    data = json.loads(args.json.read_text(encoding="utf-8"))
    with db_session.SessionLocal() as db:
        try:
            count = import_opening(db, data, actor=args.actor)
        except StoreNotEmptyError as exc:
            print(f"refused: {exc}", file=sys.stderr)
            return 1
    print(
        f"imported {len(data['items'])} items; Stock count {count.month}: {len(count.lines)} lines"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
