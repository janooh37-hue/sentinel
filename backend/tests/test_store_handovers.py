"""Handovers: FEFO, derived usage, history, audit and capability boundaries."""

from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import organization_today, utcnow
from app.db.models import AuditLog, StoreCategory, StoreItem
from app.schemas.store import StoreHandoverCreate
from tests.test_store_api import (
    TODAY,
    _client_for,
    _count,
    _deliver,
    _dispose,
    _error,
    _item,
    _items_by_code,
    _make_user,
)
from tests.test_store_api import _fixed_today as _fixed_today
from tests.test_store_api import category as category
from tests.test_store_api import editor as editor


def _handover(
    client: TestClient, on: date, *lines: tuple[int, int], taken_by: str = "Ali", **extra: Any
) -> Any:
    return client.post(
        "/api/v1/store/handovers",
        json={
            "handed_on": on.isoformat(),
            "taken_by": taken_by,
            "lines": [{"item_id": item_id, "quantity": q} for item_id, q in lines],
            **extra,
        },
    )


def test_store_handover_single_read_delete_and_audit(
    editor: TestClient, category: StoreCategory, api_db: Session
) -> None:
    item = _item(editor, category)["id"]
    _deliver(editor, TODAY, (item, None, 10))
    response = _handover(editor, TODAY, (item, 3), taken_by="  Ali  ", note="For pantry")
    assert response.status_code == 201, response.text
    row = response.json()
    assert row["taken_by"] == "  Ali  "
    assert row["note"] == "For pantry"
    assert row["recorded_by_name"] == "store-editor@test.ae"
    assert row["recorded_by_name_ar"] is None
    assert [(line["item_id"], line["quantity"]) for line in row["lines"]] == [(item, 3)]
    assert _items_by_code(editor)["ST-0001"]["on_hand"] == 7
    path = f"/api/v1/store/handovers/{row['id']}"
    assert editor.get(path).json() == row
    assert editor.get("/api/v1/store/handovers").json() == [row]
    assert editor.delete(path).status_code == 204
    assert _items_by_code(editor)["ST-0001"]["on_hand"] == 10
    assert _error(editor.get(path))["code"] == "STORE_HANDOVER_NOT_FOUND"
    assert editor.delete(path).status_code == 404
    audits = api_db.scalars(
        select(AuditLog).where(AuditLog.entity_type == "store_handover").order_by(AuditLog.id)
    ).all()
    assert [a.action for a in audits] == ["handover.created", "handover.deleted"]


def test_store_handover_multi_merges_duplicates_and_splits_fefo(
    editor: TestClient, category: StoreCategory
) -> None:
    coffee = _item(editor, category)["id"]
    tea = _item(editor, category, "Tea")["id"]
    _deliver(
        editor,
        TODAY,
        (coffee, None, 7),
        (coffee, "2027-02-01", 4),
        (coffee, "2027-01-01", 2),
        (tea, None, 6),
    )
    response = _handover(editor, TODAY, (coffee, 5), (tea, 2), (coffee, 3))
    assert response.status_code == 201, response.text
    assert [
        (line["item_id"], line["expiry_date"], line["quantity"])
        for line in response.json()["lines"]
    ] == [
        (coffee, "2027-01-01", 2),
        (coffee, "2027-02-01", 4),
        (coffee, None, 2),
        (tea, None, 2),
    ]
    assert [r["on_hand"] for r in _items_by_code(editor).values()] == [5, 4]


def test_store_handover_skips_expired_but_uses_expiry_today(
    editor: TestClient, category: StoreCategory
) -> None:
    item = _item(editor, category)["id"]
    _deliver(
        editor,
        TODAY,
        (item, (TODAY - timedelta(days=1)).isoformat(), 9),
        (item, TODAY.isoformat(), 2),
        (item, None, 3),
    )
    response = _handover(editor, TODAY, (item, 4))
    assert response.status_code == 201
    assert [(line["expiry_date"], line["quantity"]) for line in response.json()["lines"]] == [
        (TODAY.isoformat(), 2),
        (None, 2),
    ]
    assert _items_by_code(editor)["ST-0001"]["on_hand"] == 10
    short = _handover(editor, TODAY, (item, 2))
    assert short.status_code == 422
    assert _error(short)["code"] == "STORE_HANDOVER_SHORT"
    assert _error(short)["details"] == {"item_id": item, "available": 1}


def test_store_handover_backdated_never_drives_later_stock_negative(
    editor: TestClient, category: StoreCategory
) -> None:
    item = _item(editor, category)["id"]
    _deliver(editor, date(2026, 11, 1), (item, None, 10))
    _dispose(editor, date(2026, 11, 20), item, None, 8)
    response = _handover(editor, date(2026, 11, 10), (item, 3))
    assert response.status_code == 422
    assert _error(response)["details"] == {"item_id": item, "available": 2}
    assert editor.get("/api/v1/store/handovers").json() == []


def test_store_handover_multi_short_is_atomic(editor: TestClient, category: StoreCategory) -> None:
    first = _item(editor, category)["id"]
    second = _item(editor, category, "Tea")["id"]
    _deliver(editor, TODAY, (first, None, 10))
    assert _handover(editor, TODAY, (first, 2), (second, 1)).status_code == 422
    assert _items_by_code(editor)["ST-0001"]["on_hand"] == 10
    assert editor.get("/api/v1/store/handovers").json() == []


def test_store_handover_future_and_blank_name_refused(
    editor: TestClient, category: StoreCategory
) -> None:
    item = _item(editor, category)["id"]
    _deliver(editor, TODAY, (item, None, 10))
    response = _handover(editor, TODAY + timedelta(days=1), (item, 1))
    assert response.status_code == 422
    assert _error(response)["code"] == "STORE_DATE_IN_FUTURE"
    blank = _handover(editor, TODAY, (item, 1), taken_by=" \t ")
    assert blank.status_code == 422
    assert _error(blank)["code"] == "STORE_HANDOVER_TAKER_REQUIRED"


def test_store_handover_default_date() -> None:
    payload = StoreHandoverCreate.model_validate(
        {"taken_by": "Ali", "lines": [{"item_id": 1, "quantity": 1}]}
    )
    assert payload.handed_on == organization_today()


def test_store_handover_refuses_archived_item(
    editor: TestClient, category: StoreCategory, api_db: Session
) -> None:
    item = _item(editor, category)["id"]
    _deliver(editor, TODAY, (item, None, 10))
    row = api_db.get(StoreItem, item)
    assert row is not None
    row.archived_at = utcnow()
    api_db.commit()
    response = _handover(editor, TODAY, (item, 1))
    assert response.status_code == 409
    assert _error(response)["code"] == "STORE_ITEM_ARCHIVED"


def test_store_handover_same_day_count_and_usage_unchanged(
    editor: TestClient, category: StoreCategory
) -> None:
    item = _item(editor, category)["id"]
    _count(editor, date(2026, 10, 1), (item, None, 20))
    _count(editor, date(2026, 11, 1), (item, None, 10))
    before = editor.get("/api/v1/store/dashboard").json()["usage"]
    response = _handover(editor, date(2026, 10, 15), (item, 4))
    assert response.status_code == 201
    assert editor.get("/api/v1/store/dashboard").json()["usage"] == before
    same_day = _handover(editor, date(2026, 11, 1), (item, 3))
    assert same_day.status_code == 201
    assert _items_by_code(editor)["ST-0001"]["on_hand"] == 7
    assert editor.get("/api/v1/store/dashboard").json()["usage"] == before
    _count(editor, date(2026, 12, 1), (item, None, 5))
    assert editor.get("/api/v1/store/dashboard").json()["usage"]["rows"][0]["values"] == [10, 5]


def test_store_handover_takers_distinct_recent_and_list_order(
    editor: TestClient, category: StoreCategory
) -> None:
    item = _item(editor, category)["id"]
    _deliver(editor, date(2026, 11, 1), (item, None, 10))
    ids = []
    for on, taker in [(date(2026, 11, 1), "Ali"), (TODAY, "Sara"), (TODAY, "Ali")]:
        response = _handover(editor, on, (item, 1), taken_by=taker)
        assert response.status_code == 201
        ids.append(response.json()["id"])
    assert editor.get("/api/v1/store/handovers/takers").json() == ["Ali", "Sara"]
    assert [r["id"] for r in editor.get("/api/v1/store/handovers").json()] == ids[::-1]


@pytest.mark.parametrize("cap", [None, "store.view", "store.edit"])
def test_store_handover_permissions(
    editor: TestClient, category: StoreCategory, api_db: Session, cap: str | None
) -> None:
    item = _item(editor, category)["id"]
    _deliver(editor, TODAY, (item, None, 10))
    row = _handover(editor, TODAY, (item, 1)).json()
    user = _make_user(api_db, role="operator", email="other@test.ae", grants=(cap,) if cap else ())
    client = _client_for(api_db, user)
    for path in ["handovers", "handovers/takers", f"handovers/{row['id']}"]:
        assert client.get(f"/api/v1/store/{path}").status_code == (
            200 if cap == "store.view" else 403
        )
    assert _handover(client, TODAY, (item, 1)).status_code == (201 if cap == "store.edit" else 403)
    assert client.delete(f"/api/v1/store/handovers/{row['id']}").status_code == (
        204 if cap == "store.edit" else 403
    )
