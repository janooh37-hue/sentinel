"""Uniform service rules: stock ledger, holdings, voids, catalogue guards, races."""

from __future__ import annotations

import random
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
from threading import Barrier

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.api.errors import AppError
from app.db.models import (
    AuditLog,
    Base,
    Employee,
    UniformAdjustment,
    UniformIssue,
    UniformItem,
    UniformReceipt,
    UniformSize,
)
from app.db.repos import uniform_repo
from app.db.session import attach_sqlite_pragmas
from app.services import uniform_service as svc
from app.services.uniform_service import AdjustmentLineIn, IssueLineIn, ReceiptLineIn, ReturnLineIn

TODAY = date(2026, 11, 4)


@pytest.fixture(autouse=True)
def _today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(svc, "organization_today", lambda: TODAY)


@pytest.fixture
def db(db_session: Session) -> Session:
    db_session.add_all(
        [
            Employee(id="G1001", name_en="First Guard", name_ar="حارس"),
            Employee(id="G1002", name_en="Second Guard", name_ar="حارس"),
        ]
    )
    db_session.commit()
    return db_session


def _polo(db: Session, sizes: tuple[str, ...] = ("S", "M", "L")) -> UniformItem:
    return svc.create_item(
        db, name_en="Polo", name_ar="قميص", group_key="guard", drawing="polo", sizes=sizes
    )


def _suit(db: Session) -> UniformItem:
    row = UniformItem(
        name_en="Suit",
        name_ar="بدلة",
        group_key="formal",
        drawing="suit",
        tracking="holder",
        default_qty=2,
    )
    db.add(row)
    db.commit()
    return row


def _sid(item: UniformItem, label: str) -> int:
    return next(s.id for s in item.sizes if s.label == label)


def _on_hand(db: Session, size_id: int) -> int:
    return int(db.scalar(select(UniformSize.on_hand).where(UniformSize.id == size_id)) or 0)


def _stock(db: Session, size_id: int, qty: int) -> UniformReceipt:
    return svc.create_receipt(db, received_on=TODAY, lines=[ReceiptLineIn(size_id, qty)])


def _audits(db: Session, entity_type: str | None = None) -> int:
    stmt = select(func.count()).select_from(AuditLog)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    return int(db.scalar(stmt) or 0)


def _code(exc: pytest.ExceptionInfo[AppError]) -> str:
    return exc.value.code


def _held(db: Session, employee_id: str, item_id: int, size_id: int | None) -> int:
    return uniform_repo.held_qty(db, employee_id=employee_id, item_id=item_id, size_id=size_id)


def _status(exc: pytest.ExceptionInfo[AppError]) -> int:
    return exc.value.http_status


# ── Receipts ──────────────────────────────────────────────────────────────────


def test_receipt_adds_stock_and_merges_duplicate_lines(db: Session) -> None:
    polo = _polo(db)
    m = _sid(polo, "M")
    receipt = svc.create_receipt(
        db, received_on=TODAY, lines=[ReceiptLineIn(m, 3), ReceiptLineIn(m, 2)]
    )
    assert _on_hand(db, m) == 5
    assert [(line.size_id, line.qty) for line in receipt.lines] == [(m, 5)]
    assert _audits(db, "uniform_receipt") == 1


def test_receipt_rejects_future_date_archived_size_and_bad_qty(db: Session) -> None:
    polo = _polo(db)
    m, s = _sid(polo, "M"), _sid(polo, "S")
    with pytest.raises(AppError) as exc:
        svc.create_receipt(db, received_on=TODAY + timedelta(days=1), lines=[ReceiptLineIn(m, 1)])
    assert _code(exc) == "uniform_date_in_future"
    with pytest.raises(AppError) as exc:
        svc.create_receipt(db, received_on=TODAY, lines=[ReceiptLineIn(m, 0)])
    assert _code(exc) == "uniform_invalid_qty"
    _stock(db, s, 1)
    svc.create_adjustments(db, lines=[AdjustmentLineIn(s, -1, 1)], reason="Miscount")
    assert svc.remove_size(db, s) == "archived"
    before = _audits(db)
    with pytest.raises(AppError) as exc:
        svc.create_receipt(db, received_on=TODAY, lines=[ReceiptLineIn(m, 2), ReceiptLineIn(s, 1)])
    assert _code(exc) == "uniform_size_archived"
    assert _on_hand(db, m) == 0
    assert _audits(db) == before
    # Backdating is allowed.
    svc.create_receipt(db, received_on=TODAY - timedelta(days=30), lines=[ReceiptLineIn(m, 1)])
    assert _on_hand(db, m) == 1


# ── Hand-outs ─────────────────────────────────────────────────────────────────


def test_issue_decrements_and_merges_duplicates(db: Session) -> None:
    polo = _polo(db)
    m = _sid(polo, "M")
    _stock(db, m, 5)
    issue = svc.create_issue(
        db,
        employee_id="G1001",
        lines=[IssueLineIn(polo.id, m, 1), IssueLineIn(polo.id, m, 2)],
    )
    assert issue.issued_on == TODAY
    assert [(line.size_id, line.qty) for line in issue.lines] == [(m, 3)]
    assert _on_hand(db, m) == 2
    assert _held(db, "G1001", polo.id, m) == 3
    assert _audits(db, "uniform_issue") == 1


def test_shortage_is_409_with_available_and_writes_nothing(db: Session) -> None:
    polo = _polo(db)
    s, m = _sid(polo, "S"), _sid(polo, "M")
    _stock(db, s, 4)
    _stock(db, m, 1)
    before = _audits(db)
    with pytest.raises(AppError) as exc:
        svc.create_issue(
            db,
            employee_id="G1001",
            lines=[IssueLineIn(polo.id, s, 2), IssueLineIn(polo.id, m, 2)],
        )
    assert (_status(exc), _code(exc)) == (409, "uniform_insufficient_stock")
    assert exc.value.details == {"size_id": m, "available": 1}
    assert (_on_hand(db, s), _on_hand(db, m)) == (4, 1)
    assert db.scalar(select(func.count()).select_from(UniformIssue)) == 0
    assert _audits(db) == before


def test_issue_validates_employee_size_and_date(db: Session) -> None:
    polo = _polo(db)
    suit = _suit(db)
    m = _sid(polo, "M")
    _stock(db, m, 3)
    cases = [
        (
            dict(employee_id="G9999", lines=[IssueLineIn(polo.id, m, 1)]),
            "uniform_employee_not_found",
        ),
        (dict(employee_id="G1001", lines=[IssueLineIn(polo.id, None, 1)]), "uniform_size_required"),
        (dict(employee_id="G1001", lines=[IssueLineIn(suit.id, m, 1)]), "uniform_size_mismatch"),
        (dict(employee_id="G1001", lines=[]), "uniform_lines_required"),
        (
            dict(
                employee_id="G1001",
                lines=[IssueLineIn(polo.id, m, 1)],
                issued_on=TODAY + timedelta(days=1),
            ),
            "uniform_date_in_future",
        ),
    ]
    for kwargs, code in cases:
        with pytest.raises(AppError) as exc:
            svc.create_issue(db, **kwargs)  # type: ignore[arg-type]
        assert _code(exc) == code
    other = svc.create_item(
        db, name_en="Cargo", name_ar="بنطال", group_key="guard", drawing="cargo", sizes=["32"]
    )
    with pytest.raises(AppError) as exc:
        svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(other.id, m, 1)])
    assert _code(exc) == "uniform_size_mismatch"
    assert _on_hand(db, m) == 3


def test_holder_lines_have_no_size_and_no_stock_check(db: Session) -> None:
    suit = _suit(db)
    issue = svc.create_issue(
        db,
        employee_id="G1001",
        lines=[IssueLineIn(suit.id, None, 2), IssueLineIn(suit.id, None, 1)],
    )
    assert [(line.size_id, line.qty) for line in issue.lines] == [(None, 3)]
    assert _held(db, "G1001", suit.id, None) == 3


# ── Returns ───────────────────────────────────────────────────────────────────


def test_over_return_is_422_and_writes_nothing(db: Session) -> None:
    polo = _polo(db)
    m = _sid(polo, "M")
    _stock(db, m, 5)
    svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(polo.id, m, 2)])
    before = _audits(db)
    with pytest.raises(AppError) as exc:
        svc.create_return(
            db,
            employee_id="G1001",
            lines=[
                ReturnLineIn(polo.id, m, 2, "reusable"),
                ReturnLineIn(polo.id, m, 1, "damaged"),
            ],
        )
    assert (_status(exc), _code(exc)) == (422, "uniform_over_return")
    with pytest.raises(AppError) as exc:
        svc.create_return(db, employee_id="G1002", lines=[ReturnLineIn(polo.id, m, 1, "reusable")])
    assert _code(exc) == "uniform_over_return"
    assert _on_hand(db, m) == 3
    assert _held(db, "G1001", polo.id, m) == 2
    assert _audits(db) == before


def test_reusable_restocks_and_damaged_only_reduces_holdings(db: Session) -> None:
    polo = _polo(db)
    m = _sid(polo, "M")
    _stock(db, m, 5)
    svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(polo.id, m, 4)])
    svc.create_return(
        db,
        employee_id="G1001",
        lines=[ReturnLineIn(polo.id, m, 1, "reusable"), ReturnLineIn(polo.id, m, 2, "damaged")],
    )
    assert _on_hand(db, m) == 1 + 1
    assert _held(db, "G1001", polo.id, m) == 1


def test_invalid_condition_rejected(db: Session) -> None:
    suit = _suit(db)
    svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(suit.id, None, 1)])
    with pytest.raises(AppError) as exc:
        svc.create_return(db, employee_id="G1001", lines=[ReturnLineIn(suit.id, None, 1, "lost")])
    assert _code(exc) == "uniform_invalid_condition"


def test_holder_stops_being_holder_at_zero(db: Session) -> None:
    suit = _suit(db)
    svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(suit.id, None, 2)])
    svc.create_return(db, employee_id="G1001", lines=[ReturnLineIn(suit.id, None, 1, "damaged")])
    assert [h.employee_id for h in uniform_repo.holdings(db, item_id=suit.id)] == ["G1001"]
    svc.create_return(db, employee_id="G1001", lines=[ReturnLineIn(suit.id, None, 1, "reusable")])
    assert uniform_repo.holdings(db, item_id=suit.id) == []


# ── Adjustments ───────────────────────────────────────────────────────────────


def test_adjustment_needs_reason_nonzero_delta_and_stock(db: Session) -> None:
    polo = _polo(db)
    m = _sid(polo, "M")
    _stock(db, m, 2)
    for kwargs, code in [
        (dict(lines=[AdjustmentLineIn(m, 1, 2)], reason="  "), "uniform_reason_required"),
        (dict(lines=[AdjustmentLineIn(m, 0, 2)], reason="Count"), "uniform_invalid_delta"),
        (dict(lines=[AdjustmentLineIn(m, -3, 2)], reason="Count"), "uniform_insufficient_stock"),
    ]:
        with pytest.raises(AppError) as exc:
            svc.create_adjustments(db, **kwargs)  # type: ignore[arg-type]
        assert _code(exc) == code
    assert _on_hand(db, m) == 2
    rows = svc.create_adjustments(
        db,
        lines=[AdjustmentLineIn(m, -2, 2), AdjustmentLineIn(_sid(polo, "L"), 4, 0)],
        reason="Count",
    )
    assert [r.reason for r in rows] == ["Count", "Count"]
    assert (_on_hand(db, m), _on_hand(db, _sid(polo, "L"))) == (0, 4)
    assert _audits(db, "uniform_adjustment") == 2


def test_adjustment_stale_count_rejects_every_line_atomically(db: Session) -> None:
    polo = _polo(db)
    m, s = _sid(polo, "M"), _sid(polo, "S")
    _stock(db, m, 2)
    before = _audits(db)
    with pytest.raises(AppError) as exc:
        svc.create_adjustments(
            db, lines=[AdjustmentLineIn(s, 5, 0), AdjustmentLineIn(m, 1, 1)], reason="Count"
        )
    assert (_status(exc), _code(exc)) == (409, "uniform_stale_count")
    assert (_on_hand(db, s), _on_hand(db, m)) == (0, 2)
    assert svc.list_adjustments(db) == []
    assert _audits(db) == before
    with pytest.raises(AppError) as exc:
        svc.create_adjustments(
            db, lines=[AdjustmentLineIn(m, 1, 2), AdjustmentLineIn(m, 1, 3)], reason="Count"
        )
    assert _code(exc) == "uniform_stale_count"
    assert _on_hand(db, m) == 2
    assert svc.list_adjustments(db) == []
    assert _audits(db) == before


def test_adjustment_keeps_each_line_and_uses_initial_expected_count(db: Session) -> None:
    m = _sid(_polo(db), "M")
    _stock(db, m, 2)
    before = _audits(db)
    rows = svc.create_adjustments(
        db,
        lines=[AdjustmentLineIn(m, 2, 2), AdjustmentLineIn(m, -1, 2), AdjustmentLineIn(m, -1, 2)],
        reason="Count",
    )
    assert [row.delta for row in rows] == [2, -1, -1]
    assert len({row.id for row in rows}) == 3
    assert _on_hand(db, m) == 2
    assert uniform_repo.ledger_balances(db)[m] == 2
    assert _audits(db) == before + 3


def test_adjustment_duplicate_lines_guard_cumulative_stock(db: Session) -> None:
    m = _sid(_polo(db), "M")
    _stock(db, m, 2)
    before = _audits(db)
    with pytest.raises(AppError) as exc:
        svc.create_adjustments(
            db, lines=[AdjustmentLineIn(m, -2, 2), AdjustmentLineIn(m, -1, 2)], reason="Count"
        )
    assert (_status(exc), _code(exc)) == (409, "uniform_insufficient_stock")
    assert _on_hand(db, m) == 2
    assert svc.list_adjustments(db) == []
    assert _audits(db) == before


@pytest.mark.parametrize("expected", [-1, True, 1.5])
def test_adjustment_rejects_invalid_expected_count(db: Session, expected: int) -> None:
    m = _sid(_polo(db), "M")
    with pytest.raises(AppError) as exc:
        svc.create_adjustments(db, lines=[AdjustmentLineIn(m, 1, expected)], reason="Count")
    assert _code(exc) == "uniform_invalid_expected_on_hand"
    assert _on_hand(db, m) == 0
    assert svc.list_adjustments(db) == []


# ── Voids ─────────────────────────────────────────────────────────────────────


def test_void_receipt_reverses_and_guards_used_stock(db: Session) -> None:
    polo = _polo(db)
    m = _sid(polo, "M")
    first = _stock(db, m, 2)
    svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(polo.id, m, 1)])
    with pytest.raises(AppError) as exc:
        svc.void_receipt(db, first.id, reason="Wrong delivery")
    assert (_status(exc), _code(exc)) == (409, "uniform_insufficient_stock")
    assert db.get(UniformReceipt, first.id).voided_at is None  # type: ignore[union-attr]
    second = _stock(db, m, 3)
    svc.void_receipt(db, second.id, reason="Duplicate entry")
    assert _on_hand(db, m) == 1
    with pytest.raises(AppError) as exc:
        svc.void_receipt(db, second.id, reason="Again")
    assert (_status(exc), _code(exc)) == (409, "uniform_already_voided")
    with pytest.raises(AppError) as exc:
        svc.void_receipt(db, first.id, reason=" ")
    assert _code(exc) == "uniform_reason_required"


def test_void_issue_restocks_and_is_refused_while_a_return_depends_on_it(db: Session) -> None:
    polo = _polo(db)
    m = _sid(polo, "M")
    _stock(db, m, 3)
    issue = svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(polo.id, m, 2)])
    ret = svc.create_return(db, employee_id="G1001", lines=[ReturnLineIn(polo.id, m, 2, "damaged")])
    with pytest.raises(AppError) as exc:
        svc.void_issue(db, issue.id, reason="Mistake")
    assert (_status(exc), _code(exc)) == (409, "uniform_void_breaks_holdings")
    assert _on_hand(db, m) == 1
    svc.void_return(db, ret.id, reason="Mistake")
    svc.void_issue(db, issue.id, reason="Mistake")
    assert _on_hand(db, m) == 3
    assert _held(db, "G1001", polo.id, m) == 0


def test_void_reusable_return_is_guarded(db: Session) -> None:
    polo = _polo(db)
    m = _sid(polo, "M")
    _stock(db, m, 1)
    svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(polo.id, m, 1)])
    ret = svc.create_return(
        db, employee_id="G1001", lines=[ReturnLineIn(polo.id, m, 1, "reusable")]
    )
    svc.create_issue(db, employee_id="G1002", lines=[IssueLineIn(polo.id, m, 1)])
    with pytest.raises(AppError) as exc:
        svc.void_return(db, ret.id, reason="Not returned")
    assert _code(exc) == "uniform_insufficient_stock"
    assert _held(db, "G1001", polo.id, m) == 0


def test_void_adjustment_both_signs(db: Session) -> None:
    polo = _polo(db)
    m = _sid(polo, "M")
    (plus,) = svc.create_adjustments(db, lines=[AdjustmentLineIn(m, 3, 0)], reason="Found")
    (minus,) = svc.create_adjustments(db, lines=[AdjustmentLineIn(m, -1, 3)], reason="Lost")
    svc.void_adjustment(db, minus.id, reason="Was there")
    assert _on_hand(db, m) == 3
    svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(polo.id, m, 1)])
    with pytest.raises(AppError) as exc:
        svc.void_adjustment(db, plus.id, reason="Not found")
    assert _code(exc) == "uniform_insufficient_stock"
    assert _on_hand(db, m) == 2


# ── Catalogue ─────────────────────────────────────────────────────────────────


def test_create_item_rules(db: Session) -> None:
    base = dict(name_en="Vest", name_ar="سترة", group_key="guard", drawing="vest", sizes=["M"])
    for override, code in [
        ({"name_ar": " "}, "uniform_name_required"),
        ({"group_key": "navy"}, "uniform_invalid_group"),
        ({"sizes": []}, "uniform_sizes_required"),
        ({"sizes": ["M", "m"]}, "uniform_size_exists"),
        ({"sizes": ["X" * 17]}, "uniform_invalid_size_label"),
        ({"default_qty": 0}, "uniform_invalid_default_qty"),
    ]:
        with pytest.raises(AppError) as exc:
            svc.create_item(db, **{**base, **override})  # type: ignore[arg-type]
        assert _code(exc) == code
    item = svc.create_item(db, **base)  # type: ignore[arg-type]
    assert item.tracking == "shelf"
    with pytest.raises(AppError) as exc:
        svc.create_item(db, **{**base, "name_en": "VEST", "drawing": "jacket"})  # type: ignore[arg-type]
    assert _code(exc) == "uniform_item_name_exists"


def test_drawing_in_use_on_create_and_update(db: Session) -> None:
    polo = _polo(db)
    with pytest.raises(AppError) as exc:
        svc.create_item(
            db, name_en="Polo two", name_ar="قميص", group_key="guard", drawing="polo", sizes=["M"]
        )
    assert (_status(exc), _code(exc)) == (409, "uniform_drawing_in_use")
    cap = svc.create_item(
        db, name_en="Cap", name_ar="قبعة", group_key="guard", drawing="cap", sizes=["one"]
    )
    with pytest.raises(AppError) as exc:
        svc.update_item(db, cap.id, {"drawing": "polo"}, if_match=svc.item_etag(cap))
    assert (_status(exc), _code(exc)) == (409, "uniform_drawing_in_use")
    # Keeping one's own drawing is always allowed.
    kept = svc.update_item(
        db, polo.id, {"drawing": "polo", "name_en": "Guard polo"}, if_match=svc.item_etag(polo)
    )
    assert (kept.drawing, kept.name_en, kept.version) == ("polo", "Guard polo", 2)


def test_drawing_index_race_maps_to_409(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _polo(db)
    monkeypatch.setattr(uniform_repo, "used_drawings", lambda *_a, **_k: set())
    with pytest.raises(AppError) as exc:
        svc.create_item(
            db, name_en="Polo two", name_ar="قميص", group_key="guard", drawing="polo", sizes=["M"]
        )
    assert (_status(exc), _code(exc)) == (409, "uniform_drawing_in_use")
    assert isinstance(exc.value.__cause__, IntegrityError)
    assert db.scalar(select(func.count()).select_from(UniformItem)) == 1


def test_archive_and_delete_free_the_drawing(db: Session) -> None:
    polo = _polo(db)
    svc.archive_item(db, polo.id)
    again = svc.create_item(
        db, name_en="Polo", name_ar="قميص", group_key="guard", drawing="polo", sizes=["M"]
    )
    svc.delete_item(db, again.id)
    third = _polo(db)
    assert third.drawing == "polo"


def test_update_item_version_and_tracking(db: Session) -> None:
    polo = _polo(db)
    with pytest.raises(AppError) as exc:
        svc.update_item(db, polo.id, {"name_en": "X"}, if_match='"99"')
    assert _status(exc) == 412
    with pytest.raises(AppError) as exc:
        svc.update_item(db, polo.id, {"tracking": "holder"}, if_match=svc.item_etag(polo))
    assert _code(exc) == "uniform_tracking_immutable"
    svc.update_item(db, polo.id, {"default_qty": 3}, if_match='W/"1"')
    with pytest.raises(AppError) as exc:
        svc.update_item(db, polo.id, {"default_qty": 4}, if_match='"1"')
    assert _status(exc) == 412
    assert _audits(db, "uniform_item") == 2


def test_archive_refused_with_stock_or_holders(db: Session) -> None:
    polo = _polo(db)
    m = _sid(polo, "M")
    _stock(db, m, 1)
    with pytest.raises(AppError) as exc:
        svc.archive_item(db, polo.id)
    assert _code(exc) == "uniform_item_has_stock"
    svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(polo.id, m, 1)])
    with pytest.raises(AppError) as exc:
        svc.archive_item(db, polo.id)
    assert _code(exc) == "uniform_item_has_holders"
    suit = _suit(db)
    svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(suit.id, None, 1)])
    with pytest.raises(AppError) as exc:
        svc.archive_item(db, suit.id)
    assert _code(exc) == "uniform_item_has_holders"
    svc.create_return(db, employee_id="G1001", lines=[ReturnLineIn(polo.id, m, 1, "damaged")])
    archived = svc.archive_item(db, polo.id)
    assert archived.archived_at is not None
    with pytest.raises(AppError) as exc:
        svc.delete_item(db, polo.id)
    assert _code(exc) == "uniform_item_has_history"
    with pytest.raises(AppError) as exc:
        svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(polo.id, m, 1)])
    assert _code(exc) == "uniform_item_archived"


def test_size_rules(db: Session) -> None:
    polo = _polo(db, ("S", "M"))
    with pytest.raises(AppError) as exc:
        svc.add_size(db, polo.id, label=" m ")
    assert _code(exc) == "uniform_size_exists"
    xl = svc.add_size(db, polo.id, label=" XL ", min_qty=2)
    assert (xl.label, xl.min_qty, xl.sort_order) == ("XL", 2, 2)
    cap = svc.create_item(
        db, name_en="Cap", name_ar="قبعة", group_key="guard", drawing="cap", sizes=["one"]
    )
    with pytest.raises(AppError) as exc:
        svc.add_size(db, cap.id, label="L")
    assert _code(exc) == "uniform_sizes_fixed"
    suit = _suit(db)
    with pytest.raises(AppError) as exc:
        svc.add_size(db, suit.id, label="L")
    assert _code(exc) == "uniform_sizes_fixed"
    with pytest.raises(AppError) as exc:
        svc.update_size(db, xl.id, {"label": "s"})
    assert _code(exc) == "uniform_size_exists"
    with pytest.raises(AppError) as exc:
        svc.update_size(db, xl.id, {"min_qty": -1})
    assert _code(exc) == "uniform_invalid_min_qty"
    svc.update_size(db, xl.id, {"min_qty": None, "sort_order": 0})

    s, m = _sid(polo, "S"), _sid(polo, "M")
    _stock(db, s, 1)
    with pytest.raises(AppError) as exc:
        svc.remove_size(db, s)
    assert _code(exc) == "uniform_size_has_stock"
    svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(polo.id, s, 1)])
    with pytest.raises(AppError) as exc:
        svc.remove_size(db, s)
    assert _code(exc) == "uniform_size_has_holders"
    svc.create_return(db, employee_id="G1001", lines=[ReturnLineIn(polo.id, s, 1, "damaged")])
    assert svc.remove_size(db, s) == "archived"
    assert svc.remove_size(db, m) == "deleted"
    assert db.get(UniformSize, m) is None
    # An archived label can be reused by a new active size.
    assert svc.add_size(db, polo.id, label="S").id != s


@pytest.mark.parametrize("labels", [("one", "M"), ("S", " ONE ")])
def test_one_size_cannot_be_mixed_on_create(db: Session, labels: tuple[str, ...]) -> None:
    before = _audits(db)
    with pytest.raises(AppError) as exc:
        _polo(db, labels)
    assert _code(exc) == "uniform_sizes_fixed"
    assert uniform_repo.list_items(db) == []
    assert _audits(db) == before


def test_one_size_cannot_be_mixed_or_renamed_away_on_update(db: Session) -> None:
    polo = _polo(db, ("S", "M"))
    m = _sid(polo, "M")
    before = _audits(db)
    with pytest.raises(AppError) as exc:
        svc.update_size(db, m, {"label": " ONE "})
    assert _code(exc) == "uniform_sizes_fixed"
    assert _audits(db) == before
    assert svc.remove_size(db, _sid(polo, "S")) == "deleted"
    assert svc.update_size(db, m, {"label": "one"}).label == "one"
    with pytest.raises(AppError) as exc:
        svc.update_size(db, m, {"label": "M"})
    assert _code(exc) == "uniform_sizes_fixed"
    with pytest.raises(AppError) as exc:
        svc.add_size(db, polo.id, label="L")
    assert _code(exc) == "uniform_sizes_fixed"
    assert svc.update_size(db, m, {"min_qty": 2, "sort_order": 1}).min_qty == 2


def test_item_read_models_load_holdings_once_for_all_sizes(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    polo = _polo(db)
    suit = _suit(db)
    _stock(db, _sid(polo, "M"), 4)
    svc.create_issue(
        db,
        employee_id="G1001",
        lines=[IssueLineIn(polo.id, _sid(polo, "M"), 2), IssueLineIn(suit.id, None, 2)],
    )
    original = uniform_repo.holdings
    calls = 0

    def holdings(
        session: Session, *, employee_id: str | None = None, item_id: int | None = None
    ) -> list[uniform_repo.Holding]:
        nonlocal calls
        calls += 1
        return original(session, employee_id=employee_id, item_id=item_id)

    monkeypatch.setattr(uniform_repo, "holdings", holdings)
    reads = {row.id: row for row in svc.item_reads(db)}
    assert calls == 1
    assert {size.label: size.held_qty for size in reads[polo.id].sizes} == {"S": 0, "M": 2, "L": 0}
    assert reads[polo.id].holders == []
    assert reads[suit.id].holders[0].employee_id == "G1001"
    assert reads[suit.id].holders[0].qty == 2


def test_summary_uses_holder_tracking_not_drawing_or_shelf_holdings(db: Session) -> None:
    suit = _suit(db)
    svc.update_item(db, suit.id, {"drawing": "cap"}, if_match=svc.item_etag(suit))
    shelf = svc.create_item(
        db, name_en="Shelf suit", name_ar="بدلة", group_key="formal", drawing="suit", sizes=["M"]
    )
    size = _sid(shelf, "M")
    _stock(db, size, 4)
    svc.create_issue(db, employee_id="G1002", lines=[IssueLineIn(shelf.id, size, 3)])
    initial = svc.summary(db)
    assert initial.holder_count == initial.suits_issued == 0
    svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(suit.id, None, 2)])
    summary = svc.summary(db)
    assert (summary.shelf_total, summary.holder_count, summary.suits_issued) == (1, 1, 2)
    svc.create_return(db, employee_id="G1001", lines=[ReturnLineIn(suit.id, None, 2, "damaged")])
    summary = svc.summary(db)
    assert (summary.holder_count, summary.suits_issued) == (0, 0)


# ── Ledger invariant, audit, concurrency ──────────────────────────────────────


def test_ledger_invariant_over_random_postings_and_voids(db: Session) -> None:
    polo = _polo(db)
    suit = _suit(db)
    sizes = [s.id for s in polo.sizes]
    rng = random.Random(295)
    postings: list[tuple[str, int]] = []
    for _ in range(150):
        op = rng.choice(["receipt", "issue", "return", "adjust", "void"])
        size = rng.choice(sizes)
        emp = rng.choice(["G1001", "G1002"])
        qty = rng.randint(1, 4)
        try:
            if op == "receipt":
                postings.append(("receipt", _stock(db, size, qty).id))
            elif op == "issue":
                lines = [IssueLineIn(polo.id, size, qty), IssueLineIn(suit.id, None, 1)]
                postings.append(("issue", svc.create_issue(db, employee_id=emp, lines=lines).id))
            elif op == "return":
                cond = rng.choice(["reusable", "damaged"])
                ret = svc.create_return(
                    db, employee_id=emp, lines=[ReturnLineIn(polo.id, size, qty, cond)]
                )
                postings.append(("return", ret.id))
            elif op == "adjust":
                delta = qty * rng.choice([-1, 1])
                (adj,) = svc.create_adjustments(
                    db, lines=[AdjustmentLineIn(size, delta, _on_hand(db, size))], reason="Count"
                )
                postings.append(("adjustment", adj.id))
            elif postings:
                kind, pid = rng.choice(postings)
                getattr(svc, f"void_{kind}")(db, pid, reason="Random void")
        except AppError:
            pass
        cached = uniform_repo.balances(db)
        ledger = uniform_repo.ledger_balances(db)
        assert all(cached[s] == ledger.get(s, 0) for s in sizes)
        assert all(value >= 0 for value in cached.values())
        assert all(h.qty > 0 for h in uniform_repo.holdings(db))


def test_every_mutation_writes_one_audit_row(db: Session) -> None:
    polo = _polo(db)
    m = _sid(polo, "M")
    steps = [
        lambda: _stock(db, m, 3),
        lambda: svc.create_issue(db, employee_id="G1001", lines=[IssueLineIn(polo.id, m, 1)]),
        lambda: svc.create_return(
            db, employee_id="G1001", lines=[ReturnLineIn(polo.id, m, 1, "reusable")]
        ),
        lambda: svc.create_adjustments(db, lines=[AdjustmentLineIn(m, 1, 3)], reason="Count"),
        lambda: svc.add_size(db, polo.id, label="XL"),
        lambda: svc.update_size(db, m, {"min_qty": 1}),
    ]
    for step in steps:
        before = _audits(db)
        step()
        assert _audits(db) == before + 1
    void_steps = [
        (
            "uniform_adjustment",
            "adjustment.voided",
            lambda: svc.void_adjustment(db, svc.list_adjustments(db)[0].id, reason="Correction"),
        ),
        (
            "uniform_return",
            "return.voided",
            lambda: svc.void_return(db, svc.list_returns(db)[0].id, reason="Correction"),
        ),
        (
            "uniform_issue",
            "issue.voided",
            lambda: svc.void_issue(db, svc.list_issues(db)[0].id, reason="Correction"),
        ),
        (
            "uniform_receipt",
            "receipt.voided",
            lambda: svc.void_receipt(db, svc.list_receipts(db)[0].id, reason="Correction"),
        ),
        ("uniform_size", "size.archived", lambda: svc.remove_size(db, m)),
        ("uniform_size", "size.deleted", lambda: svc.remove_size(db, _sid(polo, "S"))),
        ("uniform_item", "item.archived", lambda: svc.archive_item(db, polo.id)),
    ]
    for entity_type, action, step in void_steps:
        before = _audits(db)
        step()
        assert _audits(db) == before + 1
        audit = db.scalars(select(AuditLog).order_by(AuditLog.id.desc())).first()
        assert audit is not None
        assert (audit.entity_type, audit.action) == (entity_type, action)
    disposable = svc.create_item(
        db, name_en="Cap", name_ar="قبعة", group_key="guard", drawing="cap", sizes=["one"]
    )
    before = _audits(db)
    svc.delete_item(db, disposable.id)
    assert _audits(db) == before + 1
    audit = db.scalars(select(AuditLog).order_by(AuditLog.id.desc())).first()
    assert audit is not None
    assert (audit.entity_type, audit.action) == ("uniform_item", "item.deleted")


@pytest.mark.parametrize("operation", ["issue", "adjustment"])
def test_two_sessions_race_for_the_last_piece(tmp_path: Path, operation: str) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'uniform-race.db'}", connect_args={"check_same_thread": False}
    )
    attach_sqlite_pragmas(engine)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as setup:
        setup.add_all(
            [Employee(id="G1001", name_en="A", name_ar="أ"), Employee(id="G1002", name_en="B")]
        )
        setup.commit()
        polo = _polo(setup, ("M",))
        size_id = polo.sizes[0].id
        _stock(setup, size_id, 1)
    barrier = Barrier(2)

    def post(employee_id: str) -> str:
        with factory() as session:
            barrier.wait()
            try:
                if operation == "issue":
                    svc.create_issue(
                        session, employee_id=employee_id, lines=[IssueLineIn(polo.id, size_id, 1)]
                    )
                else:
                    svc.create_adjustments(
                        session, lines=[AdjustmentLineIn(size_id, -1, 1)], reason="Count"
                    )
            except AppError as exc:
                return exc.code
            return "ok"

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = sorted(pool.map(post, ["G1001", "G1002"]))
        conflict = "uniform_insufficient_stock" if operation == "issue" else "uniform_stale_count"
        assert results == ["ok", conflict]
        with factory() as check:
            assert _on_hand(check, size_id) == 0
            model = UniformIssue if operation == "issue" else UniformAdjustment
            assert check.scalar(select(func.count()).select_from(model)) == 1
    finally:
        engine.dispose()
