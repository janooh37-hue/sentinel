"""GET /api/v1/notifications/{counts,stream} — per-user instant signals (SSE).

The stream holds a connection per authed user, emits an initial counts event
immediately, then polls every POLL_SECONDS and emits only when the counts
change. A heartbeat comment is emitted roughly every HEARTBEAT_SECONDS (on the
next tick) to keep the connection alive through proxy idle timeouts.

Counts are cached per user for POLL_SECONDS, so a user's open tabs share one
computation per tick instead of each paying for it.

Per-tick DB sessions: we do NOT hold the injected ``db`` session open across
the whole stream — a long-lived session would pin a SQLite connection. Every
computation opens a short-lived session and closes it in a ``finally`` block.

The ``Cache-Control: no-cache`` and ``X-Accel-Buffering: no`` headers defeat
proxy/CDN buffering so events flush immediately — relevant once Phase 5 puts
Caddy in front of this server.

Disconnect detection: in production Starlette cancels the generator when the
client disconnects. The httpx sync TestClient doesn't propagate that
cancellation, so each tick also checks ``request.is_disconnected()`` once.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator, Callable
from typing import Annotated

import anyio
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm import sessionmaker as _make_sm

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import SessionLocal, get_db
from app.schemas.notifications import NotificationCounts
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])

POLL_SECONDS = 10.0
HEARTBEAT_SECONDS = 15.0

# ponytail: per-process cache, fine for the single uvicorn worker; move it to a
# shared store if the app ever runs several workers.
_counts_cache: dict[int, tuple[float, NotificationCounts]] = {}


def _shared_counts(open_session: Callable[[], Session], user_id: int) -> NotificationCounts | None:
    """This user's counts, computed at most once per POLL_SECONDS across tabs.

    ``None`` when the user row is gone. Runs in a worker thread; two tabs racing
    past an expired entry both compute, which is harmless.
    """
    now = time.monotonic()
    hit = _counts_cache.get(user_id)
    if hit is not None and now - hit[0] < POLL_SECONDS:
        return hit[1]
    session = open_session()
    try:
        user = session.get(User, user_id)
        if user is None:
            return None
        counts = notification_service.relevant_counts(session, user)
    finally:
        session.close()
    _counts_cache[user_id] = (now, counts)
    return counts


@router.get("/counts", response_model=NotificationCounts)
def get_counts(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> NotificationCounts:
    """Return the current notification counts for the authenticated user.

    This is the JSON safety-poll fallback consumed by the frontend when the
    EventSource connection is unavailable or not yet open.
    """
    counts = notification_service.relevant_counts(db, user)
    # Write through: the client re-polls after its own mutations, so sibling
    # tabs' streams must not keep emitting the older cached value.
    _counts_cache[user.id] = (time.monotonic(), counts)
    return counts


def _frame(counts: NotificationCounts) -> str:
    return f"event: counts\ndata: {counts.model_dump_json()}\n\n"


@router.get("/stream")
async def stream(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    max_events: int | None = None,
) -> StreamingResponse:
    """Per-user SSE stream of notification counts.

    Emits an initial event immediately, then polls every POLL_SECONDS and
    emits only when the counts change. Sends a ``: heartbeat`` comment after
    HEARTBEAT_SECONDS without a change to keep the connection alive.

    ``max_events`` bounds the generator — after that many count-events it
    returns. Pass ``?max_events=1`` in tests to get a finite response without
    hanging on the infinite poll loop. Production clients never pass it.

    Client-disconnect cancels the async generator (FastAPI / anyio propagates
    the cancellation as GeneratorExit); the per-tick session is always closed
    in a finally block.

    Per-tick session: we do NOT use the injected ``db`` beyond reading its bind.
    A ``StreamingResponse`` finishes only when the stream does, and FastAPI
    tears request-scoped dependencies down *after* the response completes — so
    an injected session on an endless stream stays checked out for the life of
    the connection, pinning one pool connection per viewer. With the default
    QueuePool (5 + 10 overflow) the 16th concurrent viewer exhausted the pool
    and unrelated requests, login included, began failing with 500s. The
    injected session is therefore closed immediately once its engine has been
    captured, and every counts computation opens its own session from that
    same engine, so test-fixture engine overrides still apply.
    """
    user_id = user.id
    # Capture the engine from the injected session so that test overrides
    # (which replace the session factory via dependency_overrides) also apply
    # inside the generator. get_bind() is the SA 2.x idiom (db.bind is removed
    # in SA 2.0; get_bind() works across both 1.x and 2.x).
    tick_engine = db.get_bind()

    def _tick_session() -> Session:
        if tick_engine is not None:
            factory = _make_sm(
                bind=tick_engine, autoflush=False, expire_on_commit=False, future=True
            )
            return factory()
        # Fallback to the module-level factory (production path when bind is None).
        return SessionLocal()

    # Release the request-scoped connection before the endless response starts;
    # `get_db` closing it again later is a no-op.
    db.close()

    async def gen() -> AsyncIterator[str]:
        last = await anyio.to_thread.run_sync(_shared_counts, _tick_session, user_id)
        if last is None:
            return  # user row inaccessible — exit the stream cleanly
        yield _frame(last)
        emitted = 1
        if max_events is not None and emitted >= max_events:
            return
        since_emit = 0.0

        while True:
            await anyio.sleep(POLL_SECONDS)
            if await request.is_disconnected():
                return
            current = await anyio.to_thread.run_sync(_shared_counts, _tick_session, user_id)
            if current is None:
                return  # user row inaccessible — exit the stream cleanly
            if current != last:
                last = current
                since_emit = 0.0
                yield _frame(current)
                emitted += 1
                if max_events is not None and emitted >= max_events:
                    return
            else:
                since_emit += POLL_SECONDS
                if since_emit >= HEARTBEAT_SECONDS:
                    since_emit = 0.0
                    yield ": heartbeat\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
