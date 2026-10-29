"""Opening-stock import: items in file order and the October Stock count."""

from __future__ import annotations

import importlib.util
import json
import sys
from datetime import date
from pathlib import Path
from types import ModuleType

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.db.models import StoreCount, StoreItem
from app.services import store_service

ROOT = Path(__file__).resolve().parents[2]
OPENING = ROOT / "scripts" / "store_opening_2026-10-29.json"


def _script() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "store_import_opening", ROOT / "scripts" / "store_import_opening.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # Registered first so pydantic can resolve the script's annotations.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_opening_import_creates_items_in_order_and_the_opening_count(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(store_service, "today", lambda: date(2026, 10, 29))
    script = _script()
    data = json.loads(OPENING.read_text(encoding="utf-8"))

    count = script.import_opening(db_session, data, actor="storekeeper@test.ae")

    items = db_session.scalars(select(StoreItem).order_by(StoreItem.id)).all()
    assert [item.code for item in items] == [f"ST-{n:04d}" for n in range(1, 14)]
    assert [item.name_en for item in items] == [entry["name_en"] for entry in data["items"]]
    assert {item.category.name_en for item in items[-3:]} == {"Protective"}
    assert count.month == "2026-10"
    assert count.counted_on == date(2026, 10, 29)

    by_item: dict[str, list[tuple[str | None, bool, int]]] = {}
    for line in count.lines:
        by_item.setdefault(line.item_code, []).append(
            (
                line.expiry_date.isoformat() if line.expiry_date else None,
                line.expiry_month_only,
                line.quantity,
            )
        )
    coffee_mate = by_item["ST-0002"]  # Coffee-mate
    assert len(coffee_mate) == 9
    assert ("2027-04-26", False, 5) in coffee_mate
    assert by_item["ST-0005"] == [("2029-01-31", True, 9)]  # Red Label, "2029-01"
    # Green tea, water, nitrile gloves, face masks: one undated Batch each.
    for code in ("ST-0004", "ST-0007", "ST-0011", "ST-0013"):
        assert [expiry for expiry, _m, _q in by_item[code]] == [None], code

    on_hand = {row.code: row.on_hand for row in store_service.list_items(db_session)}
    assert on_hand["ST-0007"] == 88

    with pytest.raises(script.StoreNotEmptyError):
        script.import_opening(db_session, data, actor="storekeeper@test.ae")
    assert len(db_session.scalars(select(StoreCount)).all()) == 1


def test_failed_opening_count_leaves_the_store_empty(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The day before the count: the count is refused as future-dated after every
    # item was already created inside the import's transaction.
    monkeypatch.setattr(store_service, "today", lambda: date(2026, 10, 28))
    script = _script()
    data = json.loads(OPENING.read_text(encoding="utf-8"))

    with pytest.raises(AppError) as raised:
        script.import_opening(db_session, data, actor="storekeeper@test.ae")

    assert raised.value.code == "STORE_DATE_IN_FUTURE"
    assert db_session.scalars(select(StoreItem)).all() == []
    assert db_session.scalars(select(StoreCount)).all() == []


def test_invalid_opening_file_is_rejected_before_any_write(db_session: Session) -> None:
    data = json.loads(OPENING.read_text(encoding="utf-8"))
    data["items"][-1]["batches"][0]["expiry"] = "2027-13"

    with pytest.raises(ValidationError):
        _script().import_opening(db_session, data, actor="storekeeper@test.ae")

    assert db_session.scalars(select(StoreItem)).all() == []
