"""Armory guarded projection mutations and set-based lookups.

Callers own the transaction: ``armory_service.write`` takes ``BEGIN IMMEDIATE``
before any read that feeds a decision. Every projection change here is a
guarded ``UPDATE ... WHERE <expected>``; a zero row count means the expected
state no longer holds and the caller must fail the whole request.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Collection, Iterable

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.models import (
    ARMORY_MAX_QTY,
    ArmoryAssignment,
    ArmoryAssignmentLine,
    ArmorySafe,
    ArmorySerial,
    ArmoryStock,
)


def stock_row(db: Session, *, safe_id: int, item_id: int, batch_id: int | None) -> ArmoryStock:
    """The bucket for one safe/item (/batch), created empty when absent."""
    stmt = select(ArmoryStock).where(
        ArmoryStock.safe_id == safe_id,
        ArmoryStock.item_id == item_id,
        ArmoryStock.batch_id.is_(None) if batch_id is None else ArmoryStock.batch_id == batch_id,
    )
    row = db.scalar(stmt)
    if row is None:
        row = ArmoryStock(safe_id=safe_id, item_id=item_id, batch_id=batch_id, on_hand=0)
        db.add(row)
        db.flush()
    return row


def find_stock_row(
    db: Session, *, safe_id: int, item_id: int, batch_id: int | None
) -> ArmoryStock | None:
    return db.scalar(
        select(ArmoryStock).where(
            ArmoryStock.safe_id == safe_id,
            ArmoryStock.item_id == item_id,
            ArmoryStock.batch_id.is_(None)
            if batch_id is None
            else ArmoryStock.batch_id == batch_id,
        )
    )


def apply_stock_delta(db: Session, stock_id: int, delta: int) -> tuple[int, int] | None:
    """Add ``delta`` to one bucket if the result stays in ``[0, ARMORY_MAX_QTY]``.

    Returns ``(before, after)`` or ``None`` when the guard refused (not enough
    stock, or an increment past the integer ceiling).
    """
    if delta == 0:
        current = db.scalar(select(ArmoryStock.on_hand).where(ArmoryStock.id == stock_id))
        return None if current is None else (current, current)
    if delta < 0:
        guard = ArmoryStock.on_hand >= -delta
    else:
        guard = ArmoryStock.on_hand <= ARMORY_MAX_QTY - delta
    result = db.execute(
        update(ArmoryStock)
        .where(ArmoryStock.id == stock_id, guard)
        .values(on_hand=ArmoryStock.on_hand + delta)
        .execution_options(synchronize_session=False)
    )
    if int(result.rowcount) != 1:  # type: ignore[attr-defined]
        return None
    after = db.scalar(select(ArmoryStock.on_hand).where(ArmoryStock.id == stock_id))
    assert after is not None
    db.expire_all()
    return after - delta, after


def set_opening(db: Session, stock_id: int, qty: int | None, *, expected: int | None) -> bool:
    """Set the attested opening on an unbatched bucket if it still equals ``expected``."""
    guard = (
        ArmoryStock.opening_qty.is_(None)
        if expected is None
        else ArmoryStock.opening_qty == expected
    )
    result = db.execute(
        update(ArmoryStock)
        .where(ArmoryStock.id == stock_id, ArmoryStock.batch_id.is_(None), guard)
        .values(opening_qty=qty)
        .execution_options(synchronize_session=False)
    )
    db.expire_all()
    return int(result.rowcount) == 1  # type: ignore[attr-defined]


def bump_revisions(db: Session, safe_ids: Iterable[int]) -> None:
    """Advance the stock projection version of every affected safe once."""
    ids = sorted(set(safe_ids))
    if not ids:
        return
    db.execute(
        update(ArmorySafe)
        .where(ArmorySafe.id.in_(ids))
        .values(stock_revision=ArmorySafe.stock_revision + 1)
        .execution_options(synchronize_session=False)
    )
    db.expire_all()


def transition_serial(
    db: Session,
    serial_id: int,
    *,
    expected_state: str | None,
    expected_safe_id: int | None,
    expected_last_posting_id: int | None,
    state: str | None,
    safe_id: int | None,
    last_posting_id: int,
    at: dt.datetime | None,
) -> bool:
    """Move one serial only if it is still in the expected state/safe (/last posting)."""
    clauses = [
        ArmorySerial.id == serial_id,
        ArmorySerial.state.is_(None)
        if expected_state is None
        else ArmorySerial.state == expected_state,
        ArmorySerial.safe_id.is_(None)
        if expected_safe_id is None
        else ArmorySerial.safe_id == expected_safe_id,
    ]
    if expected_last_posting_id is not None:
        clauses.append(ArmorySerial.last_posting_id == expected_last_posting_id)
    result = db.execute(
        update(ArmorySerial)
        .where(*clauses)
        .values(
            state=state,
            safe_id=safe_id,
            state_at=at if state is not None else None,
            last_posting_id=last_posting_id,
        )
        .execution_options(synchronize_session=False)
    )
    db.expire_all()
    return int(result.rowcount) == 1  # type: ignore[attr-defined]


def set_remaining(db: Session, line_id: int, *, expected: int, remaining: int) -> bool:
    """Change an assignment line's outstanding quantity if it still equals ``expected``."""
    result = db.execute(
        update(ArmoryAssignmentLine)
        .where(
            ArmoryAssignmentLine.id == line_id,
            ArmoryAssignmentLine.remaining_qty == expected,
        )
        .values(remaining_qty=remaining)
        .execution_options(synchronize_session=False)
    )
    db.expire_all()
    return int(result.rowcount) == 1  # type: ignore[attr-defined]


def set_firearm_open(db: Session, assignment_id: int, *, expected: bool, value: bool) -> bool:
    result = db.execute(
        update(ArmoryAssignment)
        .where(
            ArmoryAssignment.posting_id == assignment_id,
            ArmoryAssignment.firearm_open == expected,
        )
        .values(firearm_open=value)
        .execution_options(synchronize_session=False)
    )
    db.expire_all()
    return int(result.rowcount) == 1  # type: ignore[attr-defined]


def open_lines_for_serials(
    db: Session, serial_ids: Collection[int]
) -> dict[int, ArmoryAssignmentLine]:
    """The outstanding assignment line holding each serial (at most one by index)."""
    if not serial_ids:
        return {}
    rows = db.scalars(
        select(ArmoryAssignmentLine).where(
            ArmoryAssignmentLine.serial_id.in_(list(serial_ids)),
            ArmoryAssignmentLine.remaining_qty > 0,
        )
    )
    return {row.serial_id: row for row in rows if row.serial_id is not None}


def live_serial_by_code(db: Session, code: str) -> ArmorySerial | None:
    return db.scalar(
        select(ArmorySerial).where(
            ArmorySerial.serial_code == code, ArmorySerial.state.is_not(None)
        )
    )
