"""Per-Word-session arrival order for DAV saves and Finish / discard.

A Word save (DAV ``PUT``) replaces the session's working file; Finish builds the version
from that file and discard deletes it. A save that arrived first must therefore land
before a later Finish / discard looks at the file, and a later save must not be written
into a session that has already been finalized.

:func:`session_turn` is that order: first come, first served among the requests that name
one session token (AnyIO's ``CapacityLimiter`` hands its token to waiters in arrival order),
waiting on the event loop, never on a worker-pool thread, so queued requests cannot exhaust
the thread pool. Different tokens never wait for each other.

Two callers take the turn, and the order they take it in matters:

* DAV ``PUT`` takes the turn first and then waits for the global ``run_exclusive`` lane
  (``_offload``) *inside* it: ``async with session_turn(token): await run_exclusive(...)``.
  The save keeps its lane place on purpose — a lane mail / announcement job may hold SQLite's
  write lock across network I/O, and a save outside the lane would replace the working file
  and then fail ``record_put`` after SQLite's busy timeout.
* Finish / discard take the same turn and then run in a worker thread
  (:func:`run_in_session_order`), never in the lane, so they wait for the session's earlier
  saves (including one still queued in the lane) and for nothing else.

No wait cycle exists: the turn is only ever taken *before* the lane, a lane job never waits
for a turn, and Finish / discard never wait for the lane. A request cancelled while it waits
for its turn (or, for a save, for the lane) never runs; a request cancelled while its worker
thread runs is not abandoned (AnyIO's default), so the turn, and with it the request-scoped
``Session`` that ``get_db`` closes afterwards, is released only once the thread is done.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from functools import partial

from anyio import CapacityLimiter, to_thread
from anyio.lowlevel import RunVar

# token -> (turn limiter, requests holding or awaiting it); per running event loop.
_turns: RunVar[dict[str, tuple[CapacityLimiter, int]]] = RunVar("sentinel_word_session_turns")


def _registry() -> dict[str, tuple[CapacityLimiter, int]]:
    try:
        return _turns.get()
    except LookupError:
        registry: dict[str, tuple[CapacityLimiter, int]] = {}
        _turns.set(registry)
        return registry


@asynccontextmanager
async def session_turn(token: str | None) -> AsyncIterator[None]:
    """Hold ``token``'s turn, in arrival order among requests for the same token.

    ``token=None`` (no session to order against) takes no turn.
    """
    if token is None:
        yield
        return
    registry = _registry()
    limiter, users = registry.get(token) or (CapacityLimiter(1), 0)
    registry[token] = (limiter, users + 1)
    try:
        async with limiter:
            yield
    finally:
        limiter, users = registry[token]
        if users <= 1:
            del registry[token]
        else:
            registry[token] = (limiter, users - 1)


async def run_in_session_order[**P, T](
    token: str | None, func: Callable[P, T], /, *args: P.args, **kwargs: P.kwargs
) -> T:
    """Run blocking ``func`` in a worker thread, in arrival order among requests for ``token``."""
    call = partial(func, *args, **kwargs)
    async with session_turn(token):
        return await to_thread.run_sync(call)
