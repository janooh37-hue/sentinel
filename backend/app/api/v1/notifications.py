"""GET /api/v1/notifications/{counts,stream} — per-user instant signals (SSE).

The stream holds a connection per authed user, emits an initial counts event
immediately, then polls every POLL_SECONDS and emits only when the counts
change. A heartbeat comment is emitted every HEARTBEAT_SECONDS to keep the
connection alive through proxy idle timeouts.

Per-tick DB sessions: we do NOT hold the injected ``db`` session open across
the whole stream — a long-lived session would pin a SQLite connection. Only
the initial event reuses the injected session; subsequent ticks open a
short-lived session and close it in a ``finally`` block.

The ``Cache-Control: no-cache`` and ``X-Accel-Buffering: no`` headers defeat
proxy/CDN buffering so events flush immediately — relevant once Phase 5 puts
Caddy in front of this server.

Disconnect detection: the generator checks ``await request.is_disconnected()``
before the sleep so it exits cleanly when the client closes without needing
anyio task cancellation (which doesn't propagate from the httpx sync
TestClient's stream context-manager close).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
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

POLL_SECONDS = 2.5
HEARTBEAT_SECONDS = 15.0


@router.get("/counts", response_model=NotificationCounts)
def get_counts(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> NotificationCounts:
    """Return the current notification counts for the authenticated user.

    This is the JSON safety-poll fallback consumed by the frontend when the
    EventSource connection is unavailable or not yet open.
    """
    return notification_service.relevant_counts(db, user)


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
    emits only when the counts change. Sends a ``: heartbeat`` comment every
    HEARTBEAT_SECONDS to keep the connection alive.

    ``max_events`` bounds the generator — after that many count-events it
    returns. Pass ``?max_events=1`` in tests to get a finite response without
    hanging on the infinite poll loop. Production clients never pass it.

    Client-disconnect cancels the async generator (FastAPI / anyio propagates
    the cancellation as GeneratorExit); the per-tick session is always closed
    in a finally block.

    Per-tick session: we do NOT hold the injected ``db`` open for the whole
    stream (would pin a SQLite connection). Instead each tick opens a new
    session from the same engine that backed the injected ``db`` — this way
    the test-fixture engine override also applies to the per-tick sessions.
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

    async def gen() -> AsyncIterator[str]:
        # Initial event from the injected (request-scoped) session.
        last = await anyio.to_thread.run_sync(
            lambda: notification_service.relevant_counts(db, user)
        )
        yield _frame(last)
        emitted = 1
        if max_events is not None and emitted >= max_events:
            return
        since_emit = 0.0

        while True:
            # Sleep in short slices so we can detect client disconnect
            # promptly. anyio task cancellation doesn't propagate from
            # the httpx sync TestClient's stream context-manager close,
            # so we must poll is_disconnected() periodically instead.
            _SLICE = 0.05  # 50ms slices → disconnect detected within 50ms
            slept = 0.0
            while slept < POLL_SECONDS:
                await anyio.sleep(_SLICE)
                slept += _SLICE
                if await request.is_disconnected():
                    return

            def _recompute() -> NotificationCounts | None:
                s = _tick_session()
                try:
                    u = s.get(User, user_id)
                    if u is None:
                        return None  # user row inaccessible — signal caller to exit
                    return notification_service.relevant_counts(s, u)
                finally:
                    s.close()

            current = await anyio.to_thread.run_sync(_recompute)
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
