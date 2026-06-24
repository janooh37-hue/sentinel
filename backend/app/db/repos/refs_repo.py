"""Persistence shim for :class:`app.core.refs.RefAllocator`.

The allocator itself is intentionally pure — it knows nothing about
SQLAlchemy. This module is the bridge:

* :func:`load_ref_allocator` reads the single-row ``book_ref_sequence``
  table (creating it on first call) and returns an allocator primed with
  the stored counter.
* :func:`persist_ref_allocator` writes the allocator's current counter
  back to that row.
* :func:`allocate_ref_with_retry` is the recommended call site — it wraps
  the ``BEGIN IMMEDIATE`` → load → next → persist critical section with a
  bounded retry for WAL lock contention.  Use this instead of calling
  ``load_ref_allocator`` / ``persist_ref_allocator`` directly; the lower-level
  helpers are exposed for completeness and testing.

Under concurrency (LAN multi-user) callers should use ``allocate_ref_with_retry``
directly.  The lower-level steps are shown here for reference only:

.. code-block:: python

    # Preferred entry point (handles locking + retries automatically):
    ref = allocate_ref_with_retry(session, "HR")

    # Low-level steps (for testing / one-off usage — no retry):
    allocator = load_ref_allocator(session)
    ref = allocator.next("HR")
    persist_ref_allocator(allocator, session)
    session.commit()
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.core.refs import RefAllocator
from app.db.models import REF_SEQUENCE_ID, BookRefSequence

log = logging.getLogger(__name__)


def load_ref_allocator(session: Session) -> RefAllocator:
    """Return a ``RefAllocator`` primed from the database.

    On a fresh DB the singleton row is created (``next_value=1``) and
    flushed so subsequent reads find it.
    """
    row = session.get(BookRefSequence, REF_SEQUENCE_ID)
    if row is None:
        row = BookRefSequence(id=REF_SEQUENCE_ID, next_value=1)
        session.add(row)
        session.flush()
    return RefAllocator(start=row.next_value)


def persist_ref_allocator(allocator: RefAllocator, session: Session) -> None:
    """Write the allocator's current counter back to the singleton row.

    Does not commit — callers control transaction boundaries.
    """
    row = session.get(BookRefSequence, REF_SEQUENCE_ID)
    if row is None:
        row = BookRefSequence(id=REF_SEQUENCE_ID, next_value=allocator.counter)
        session.add(row)
    else:
        row.next_value = allocator.counter
    session.flush()


def allocate_ref_with_retry(
    session: Session,
    category: str,
    *,
    attempts: int = 5,
) -> str:
    """Allocate the next ref number, serialised + bounded-retry.

    Runs the ``BEGIN IMMEDIATE`` → ``load`` → ``next`` → ``persist`` critical
    section. ``BEGIN IMMEDIATE`` serialises the counter increment; the retry
    covers the LAN case where a concurrent writer holds the write lock past
    ``busy_timeout`` (``OperationalError: database is locked``) or a stale read
    collides with ``uq_books_ref_number`` (``IntegrityError``). On failure the
    transaction is rolled back so no number is burned, then the loop re-reads
    the advanced counter and tries the *next* ref.

    Does NOT commit — the caller owns the outer transaction boundary so the
    ref allocation stays atomic with the Book/Document insert.
    """
    cat = (category or "").strip()
    last_exc: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            session.execute(text("BEGIN IMMEDIATE"))
            allocator = load_ref_allocator(session)
            ref = allocator.next(cat)
            persist_ref_allocator(allocator, session)
            return ref
        except (OperationalError, IntegrityError) as exc:
            last_exc = exc
            session.rollback()
            if attempt >= attempts:
                break
            log.warning(
                "ref allocation retry %d/%d for category %r: %s",
                attempt,
                attempts,
                cat,
                exc.__class__.__name__,
            )
    assert last_exc is not None
    raise last_exc
