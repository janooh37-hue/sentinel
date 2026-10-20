"""Run blocking route work off the event loop without losing its one-at-a-time ordering.

``async def`` handlers execute on the single event loop, so a synchronous call inside
them (OCR, PyMuPDF, IMAP, an HTTP gateway, a contended SQLite write) freezes every
other request, the SSE heartbeat and ``/system/health`` for as long as it runs.

Before this module, that same property meant the upload/ingest/broadcast handlers also
ran strictly **one at a time**: the loop could not interleave them. A plain thread
offload (or ``async def`` → ``def``) silently drops that exclusion and exposes work that
was never written to overlap — PyMuPDF (documented as unsupported across threads),
read-modify-write of a Record's approval state and ``attachment_paths``, collision-safe
file naming, a Session-per-request that two worker threads would otherwise race over.

:func:`run_exclusive` keeps the exclusion but moves the work off the loop:

* it runs ``func`` in an AnyIO worker thread, so the loop (and every plain ``def`` route
  served from the shared worker pool) stays responsive;
* at most **one** such call runs at a time per event loop. Waiters queue on the loop
  itself (a ``CapacityLimiter`` token wait), *not* on a pool thread, so a stuck call
  cannot exhaust the 40-thread worker pool and freeze every ``def`` route behind it;
* the caller hands its request-scoped ``Session`` to the one worker thread that runs the
  whole body; ``get_db`` setup and teardown run before/after, never concurrently. A
  cancelled request does not abandon the thread (AnyIO's default), so the dependency
  teardown cannot close a ``Session`` the thread is still using.
* waiters are woken first-come-first-served, so work that must land in arrival order keeps
  it: the DAV ``PUT`` that replaces a Word working file takes the lane for exactly that
  reason (overlapping saves must not let an older body overwrite a newer one).

This preserves — it does not improve — the previous overlap profile. It is deliberately
not a PyMuPDF confinement (process isolation is a later, separate change) and not a
throughput feature: lane members still wait for each other, but no longer freeze the app.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import partial

from anyio import CapacityLimiter, to_thread
from anyio.lowlevel import RunVar

# One lane per running event loop (the way AnyIO keeps its own default thread limiter):
# safe to create lazily, and correct when tests start many loops in one process.
_lane: RunVar[CapacityLimiter] = RunVar("sentinel_exclusive_lane")


def _exclusive_lane() -> CapacityLimiter:
    try:
        return _lane.get()
    except LookupError:
        limiter = CapacityLimiter(1)
        _lane.set(limiter)
        return limiter


async def run_exclusive[**P, T](func: Callable[P, T], /, *args: P.args, **kwargs: P.kwargs) -> T:
    """Run blocking ``func`` in a worker thread, one lane member at a time."""
    return await to_thread.run_sync(partial(func, *args, **kwargs), limiter=_exclusive_lane())
