"""Atomic serial allocator for classified General Book refs (1/{tab}/GSSG/{serial}).

Mirrors :mod:`app.db.repos.refs_repo` BEGIN-IMMEDIATE / bounded-retry structure,
operating on the single-row ``ClassifiedRefSequence`` (id=1).  Caller owns the
commit so the allocation stays atomic with the Book insert.
"""

from __future__ import annotations

import logging

from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.db.models import ClassifiedRefSequence
from app.db.repos._locking import begin_immediate_if_idle

log = logging.getLogger(__name__)

_SEQUENCE_ID = 1


def allocate_classified_serial(
    session: Session,
    *,
    attempts: int = 5,
) -> int:
    """Allocate and return the next classified serial number.

    Runs BEGIN IMMEDIATE → read row (create if missing) → return current
    value → increment.  Retries on lock contention or integrity collisions.
    Does NOT commit — caller owns the transaction boundary.

    When the caller already holds the write lock (it has flushed in this same
    transaction), the lock is not re-taken and a failure is raised rather than
    retried: rolling back here would silently discard the caller's staged work.
    See :mod:`app.db.repos._locking`.
    """
    last_exc: Exception | None = None
    for attempt in range(1, attempts + 1):
        owns_transaction = False
        try:
            owns_transaction = begin_immediate_if_idle(session)
            row = session.get(ClassifiedRefSequence, _SEQUENCE_ID)
            if row is None:
                row = ClassifiedRefSequence(id=_SEQUENCE_ID, next_value=1)
                session.add(row)
                session.flush()
            serial = row.next_value
            row.next_value = serial + 1
            session.flush()
            return serial
        except (OperationalError, IntegrityError) as exc:
            last_exc = exc
            if not owns_transaction:
                raise
            session.rollback()
            if attempt >= attempts:
                break
            log.warning(
                "classified serial allocation retry %d/%d: %s",
                attempt,
                attempts,
                exc.__class__.__name__,
            )
    assert last_exc is not None
    raise last_exc
