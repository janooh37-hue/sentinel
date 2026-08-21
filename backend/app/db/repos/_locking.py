"""Serialisation helper shared by the ref-number allocators.

Both allocators serialise their counter increment with a raw ``BEGIN IMMEDIATE``
and retry on lock contention. That is correct only while the allocator owns the
transaction boundary. If the caller has already written in the same transaction,
SQLite rejects the statement with ``cannot start a transaction within a
transaction`` — and a handler that answers by calling ``session.rollback()``
throws away the caller's staged work, then succeeds on the next attempt, so the
request returns success with the caller's changes silently gone.

That is not hypothetical: `POST /api/v1/duty/transfer` returned
``200 {"moved": ["G-9001"]}`` and produced the transfer letter while the
employee's unit/post never changed and no ``duty_assignment_events`` row was
written, because the duty-transfer flow now enqueues an attendance
re-evaluation (which flushes) before minting the letter.

The rule this module encodes: take the write lock only when nobody holds it. If
the caller already holds it, contention with another writer is impossible, so
there is nothing to retry and nothing this code may roll back.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

__all__ = ["begin_immediate_if_idle"]


def begin_immediate_if_idle(session: Session) -> bool:
    """Start an immediate write transaction unless one is already open.

    Returns whether this call started the transaction, which is exactly the
    condition under which the caller may roll it back or retry.

    Reads do not count: pysqlite defers ``BEGIN`` until the first DML statement,
    so a session that has only queried is still idle at the database level.
    Non-SQLite backends report no driver-level flag; there the statement is
    skipped and ownership is reported as False, leaving the surrounding
    transaction untouched.
    """
    driver_connection = session.connection().connection.driver_connection
    in_transaction = getattr(driver_connection, "in_transaction", None)
    if in_transaction is None or in_transaction:
        return False
    session.execute(text("BEGIN IMMEDIATE"))
    return True
