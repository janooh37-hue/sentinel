"""Allocating a ref number must never discard the caller's staged rows.

Both allocators serialise their counter with a raw ``BEGIN IMMEDIATE``. SQLite
rejects that statement when the caller has already written in the same
transaction (``cannot start a transaction within a transaction``), and the
bounded-retry handler used to answer by calling ``session.rollback()`` — which
threw away the caller's work and then succeeded on the next attempt.

The failure this guards was reproduced end to end: `POST /api/v1/duty/transfer`
answered ``200 {"moved": ["G-9001"]}`` and wrote the transfer letter while the
employee's unit and post were unchanged and no ``duty_assignment_events`` row
existed, because the duty flow enqueues an attendance re-evaluation (a flush)
before minting the letter.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Employee
from app.db.repos.classified_refs_repo import allocate_classified_serial
from app.db.repos.refs_repo import allocate_ref_with_retry


def _employee(db: Session, employee_id: str) -> Employee:
    row = Employee(
        id=employee_id,
        name_en="Ported Guard",
        name_ar=None,
        status="Active",
        department="Operations",
        duty_unit="First Company",
        duty_post="Main Gate",
    )
    db.add(row)
    db.commit()
    return row


@pytest.mark.parametrize(
    ("allocate", "label"),
    [
        (lambda db: allocate_ref_with_retry(db, "HR"), "book ref"),
        (lambda db: allocate_classified_serial(db), "classified serial"),
    ],
)
def test_allocation_keeps_the_callers_pending_write(
    db_session: Session, allocate, label: str
) -> None:
    employee = _employee(db_session, "G-8001")

    # The caller stages a change and flushes — exactly what enqueueing an
    # attendance re-evaluation does inside the duty-transfer transaction. The
    # flush is what opens the SQLite write transaction.
    employee.duty_post = "South Gate"
    db_session.flush()

    allocated = allocate(db_session)
    assert allocated, f"{label} must still be allocated"

    db_session.commit()

    db_session.expire_all()
    persisted = db_session.scalar(select(Employee.duty_post).where(Employee.id == "G-8001"))
    assert persisted == "South Gate", (
        f"{label} allocation discarded the caller's staged write"
    )
