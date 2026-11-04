"""Uniform queries: guarded shelf balance changes, balances and holdings.

Callers own the transaction (``begin_immediate_if_idle`` before writes). Holdings
and ledger balances count only non-voided postings.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, literal, select, union_all, update
from sqlalchemy.orm import Session

from app.db.models import (
    UniformAdjustment,
    UniformIssue,
    UniformIssueLine,
    UniformItem,
    UniformReceipt,
    UniformReceiptLine,
    UniformReturn,
    UniformReturnLine,
    UniformSize,
)


@dataclass(frozen=True, slots=True)
class Holding:
    employee_id: str
    item_id: int
    size_id: int | None
    qty: int


def decrement_on_hand(db: Session, size_id: int, qty: int) -> int:
    """Take ``qty`` off a shelf size only if that much is there.

    Returns the affected row count: 0 means not enough stock (or no such size),
    and the caller must fail the whole request.
    """
    if qty <= 0:
        raise ValueError("qty must be positive")
    result = db.execute(
        update(UniformSize)
        .where(UniformSize.id == size_id, UniformSize.on_hand >= qty)
        .values(on_hand=UniformSize.on_hand - qty)
        .execution_options(synchronize_session=False)
    )
    return int(result.rowcount)  # type: ignore[attr-defined]


def increment_on_hand(db: Session, size_id: int, qty: int) -> int:
    """Put ``qty`` back on a shelf size. Returns the affected row count."""
    if qty <= 0:
        raise ValueError("qty must be positive")
    result = db.execute(
        update(UniformSize)
        .where(UniformSize.id == size_id)
        .values(on_hand=UniformSize.on_hand + qty)
        .execution_options(synchronize_session=False)
    )
    return int(result.rowcount)  # type: ignore[attr-defined]


def balances(db: Session, *, item_id: int | None = None) -> dict[int, int]:
    """Cached ``on_hand`` per non-archived size, optionally for one item."""
    stmt = select(UniformSize.id, UniformSize.on_hand).where(UniformSize.archived_at.is_(None))
    if item_id is not None:
        stmt = stmt.where(UniformSize.item_id == item_id)
    return {size_id: on_hand for size_id, on_hand in db.execute(stmt)}


def ledger_balances(db: Session) -> dict[int, int]:
    """On-hand per size recomputed from non-voided postings.

    Receipts add, hand-outs subtract, reusable returns add, adjustments add
    their signed delta. Used to prove the cached ``on_hand`` invariant.
    """
    receipts = (
        select(UniformReceiptLine.size_id.label("size_id"), UniformReceiptLine.qty.label("qty"))
        .join(UniformReceipt, UniformReceipt.id == UniformReceiptLine.receipt_id)
        .where(UniformReceipt.voided_at.is_(None))
    )
    issues = (
        select(UniformIssueLine.size_id, (-UniformIssueLine.qty).label("qty"))
        .join(UniformIssue, UniformIssue.id == UniformIssueLine.issue_id)
        .where(UniformIssue.voided_at.is_(None), UniformIssueLine.size_id.is_not(None))
    )
    returns = (
        select(UniformReturnLine.size_id, UniformReturnLine.qty)
        .join(UniformReturn, UniformReturn.id == UniformReturnLine.return_id)
        .where(
            UniformReturn.voided_at.is_(None),
            UniformReturnLine.size_id.is_not(None),
            UniformReturnLine.condition == literal("reusable"),
        )
    )
    adjustments = select(UniformAdjustment.size_id, UniformAdjustment.delta).where(
        UniformAdjustment.voided_at.is_(None)
    )
    moves = union_all(receipts, issues, returns, adjustments).subquery()
    stmt = select(moves.c.size_id, func.sum(moves.c.qty)).group_by(moves.c.size_id)
    return {int(row[0]): int(row[1]) for row in db.execute(stmt).tuples()}


def holdings(
    db: Session, *, employee_id: str | None = None, item_id: int | None = None
) -> list[Holding]:
    """Net held quantity per (employee, item, size); zero and below are omitted."""
    issued = (
        select(
            UniformIssue.employee_id.label("employee_id"),
            UniformIssueLine.item_id.label("item_id"),
            UniformIssueLine.size_id.label("size_id"),
            UniformIssueLine.qty.label("qty"),
        )
        .join(UniformIssue, UniformIssue.id == UniformIssueLine.issue_id)
        .where(UniformIssue.voided_at.is_(None))
    )
    returned = (
        select(
            UniformReturn.employee_id,
            UniformReturnLine.item_id,
            UniformReturnLine.size_id,
            (-UniformReturnLine.qty).label("qty"),
        )
        .join(UniformReturn, UniformReturn.id == UniformReturnLine.return_id)
        .where(UniformReturn.voided_at.is_(None))
    )
    moves = union_all(issued, returned).subquery()
    total = func.sum(moves.c.qty)
    stmt = (
        select(moves.c.employee_id, moves.c.item_id, moves.c.size_id, total)
        .group_by(moves.c.employee_id, moves.c.item_id, moves.c.size_id)
        .having(total > 0)
        .order_by(moves.c.employee_id, moves.c.item_id, moves.c.size_id)
    )
    if employee_id is not None:
        stmt = stmt.where(moves.c.employee_id == employee_id)
    if item_id is not None:
        stmt = stmt.where(moves.c.item_id == item_id)
    return [
        Holding(str(e), int(i), None if s is None else int(s), int(q))
        for e, i, s, q in db.execute(stmt).tuples()
    ]


def held_qty(db: Session, *, employee_id: str, item_id: int, size_id: int | None) -> int:
    """Net quantity one employee holds of one item and size."""
    size_match = (
        UniformIssueLine.size_id.is_(None)
        if size_id is None
        else UniformIssueLine.size_id == size_id
    )
    return_size_match = (
        UniformReturnLine.size_id.is_(None)
        if size_id is None
        else UniformReturnLine.size_id == size_id
    )
    issued = db.scalar(
        select(func.coalesce(func.sum(UniformIssueLine.qty), 0))
        .join(UniformIssue, UniformIssue.id == UniformIssueLine.issue_id)
        .where(
            UniformIssue.voided_at.is_(None),
            UniformIssue.employee_id == employee_id,
            UniformIssueLine.item_id == item_id,
            size_match,
        )
    )
    returned = db.scalar(
        select(func.coalesce(func.sum(UniformReturnLine.qty), 0))
        .join(UniformReturn, UniformReturn.id == UniformReturnLine.return_id)
        .where(
            UniformReturn.voided_at.is_(None),
            UniformReturn.employee_id == employee_id,
            UniformReturnLine.item_id == item_id,
            return_size_match,
        )
    )
    return int(issued or 0) - int(returned or 0)


def list_items(db: Session, *, include_archived: bool = False) -> list[UniformItem]:
    stmt = select(UniformItem).order_by(UniformItem.sort_order, UniformItem.id)
    if not include_archived:
        stmt = stmt.where(UniformItem.archived_at.is_(None))
    return list(db.scalars(stmt))


def used_drawings(db: Session, *, exclude_item_id: int | None = None) -> set[str]:
    """Drawings taken by non-archived items, optionally ignoring one item."""
    stmt = select(UniformItem.drawing).where(UniformItem.archived_at.is_(None))
    if exclude_item_id is not None:
        stmt = stmt.where(UniformItem.id != exclude_item_id)
    return set(db.scalars(stmt))


def low_stock_size_ids(db: Session) -> list[int]:
    """Active sizes at or below their alert level."""
    stmt = (
        select(UniformSize.id)
        .join(UniformItem, UniformItem.id == UniformSize.item_id)
        .where(
            UniformSize.archived_at.is_(None),
            UniformItem.archived_at.is_(None),
            UniformSize.min_qty.is_not(None),
            UniformSize.on_hand <= UniformSize.min_qty,
        )
        .order_by(UniformSize.id)
    )
    return list(db.scalars(stmt))
