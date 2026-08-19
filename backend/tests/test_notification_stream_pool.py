"""The SSE stream must not pin a pool connection for its lifetime.

`GET /api/v1/notifications/stream` is an endless `StreamingResponse`, and FastAPI
tears request-scoped dependencies down only *after* a response completes. An
injected `Depends(get_db)` session therefore stays checked out for as long as the
viewer's tab is open. With the production engine's default QueuePool (5 + 10
overflow) the sixteenth concurrent viewer exhausted the pool and unrelated
requests — login included — began failing with 500s and
``QueuePool limit of size 5 overflow 10 reached``.

The pool here is deliberately one connection with no overflow, which turns that
production ceiling into a deterministic assertion: if the stream still holds the
injected session after its first frame, the very next query cannot get a
connection.
"""

from __future__ import annotations

from pathlib import Path

import anyio
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.api.v1 import notifications
from app.db.models import Base, User
from tests.conftest import make_user


class _NeverDisconnects:
    """The one Request member the generator touches before its first frame."""

    async def is_disconnected(self) -> bool:
        return False


def _single_connection_engine(tmp_path: Path):
    """One connection, no overflow, fail fast rather than block the suite."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'stream-pool.db'}",
        connect_args={"check_same_thread": False},
        pool_size=1,
        max_overflow=0,
        pool_timeout=2,
        future=True,
    )
    Base.metadata.create_all(engine)
    return engine


def test_stream_releases_its_connection_before_the_endless_body(tmp_path: Path) -> None:
    engine = _single_connection_engine(tmp_path)
    factory: sessionmaker[Session] = sessionmaker(
        bind=engine, autoflush=False, expire_on_commit=False, future=True
    )

    with factory() as setup:
        user = make_user(setup, role="admin", email="stream@test.ae")
        user_id = user.id

    injected = factory()
    user_row = injected.get(User, user_id)
    assert user_row is not None

    response = anyio.run(lambda: notifications.stream(_NeverDisconnects(), injected, user_row))

    # Consume exactly the initial counts event, then stop: this is the moment a
    # real viewer reaches and then sits at for hours.
    async def first_frame() -> str:
        async for chunk in response.body_iterator:
            return str(chunk)
        raise AssertionError("the stream produced no initial event")

    frame = anyio.run(first_frame)
    assert frame.startswith("event: counts\ndata: "), frame

    assert engine.pool.checkedout() == 0, (
        "the stream is holding a pool connection while idle; "
        "concurrent viewers will exhaust the pool"
    )

    # The user-visible consequence: with the stream still open, an unrelated
    # request must still be servable. On the single-connection pool this raises
    # TimeoutError if anything is pinned.
    with factory() as concurrent:
        assert concurrent.scalar(select(User.id).where(User.id == user_id)) == user_id

    injected.close()
    engine.dispose()
