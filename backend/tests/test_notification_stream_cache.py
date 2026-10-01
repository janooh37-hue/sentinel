"""Several open tabs of one user must not multiply the SSE counts work."""

from __future__ import annotations

import time
from pathlib import Path

import anyio
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.v1 import notifications
from app.db.models import Base, User
from app.services import notification_service
from tests.conftest import make_user


class _NeverDisconnects:
    async def is_disconnected(self) -> bool:
        return False


def test_tabs_of_one_user_share_one_counts_computation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'tabs.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    factory: sessionmaker[Session] = sessionmaker(
        bind=engine, autoflush=False, expire_on_commit=False, future=True
    )
    with factory() as setup:
        user_id = make_user(setup, role="admin", email="tabs@test.ae").id

    # Isolate from other tests' cached users (ids repeat across test DBs).
    monkeypatch.setattr(notifications, "_counts_cache", {})
    computed: list[int] = []
    real = notification_service.relevant_counts

    def counting(db, user, **kwargs):  # type: ignore[no-untyped-def]
        computed.append(user.id)
        return real(db, user, **kwargs)

    monkeypatch.setattr(notification_service, "relevant_counts", counting)

    def open_tab() -> str:
        injected = factory()
        user = injected.get(User, user_id)
        response = anyio.run(lambda: notifications.stream(_NeverDisconnects(), injected, user))

        async def first_frame() -> str:
            async for chunk in response.body_iterator:
                return str(chunk)
            raise AssertionError("no initial event")

        return anyio.run(first_frame)

    first, second = open_tab(), open_tab()

    assert first == second
    assert first.startswith("event: counts\ndata: ")
    assert computed == [user_id]
    engine.dispose()


def test_counts_poll_refreshes_what_sibling_streams_see(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """After a mutation the client re-polls /counts; a sibling tab's stream must
    not then emit the older cached value (spurious 'needs approval' alert)."""
    engine = create_engine(f"sqlite:///{tmp_path / 'poll.db'}")
    Base.metadata.create_all(engine)
    factory: sessionmaker[Session] = sessionmaker(bind=engine, future=True)
    with factory() as db:
        user = make_user(db, role="admin", email="poll@test.ae")
        fresh = notification_service.relevant_counts(db, user)
        stale = fresh.model_copy(update={"approvals": fresh.approvals + 1})
        # A sibling stream cached an older value moments ago (entry still live).
        monkeypatch.setattr(notifications, "_counts_cache", {user.id: (time.monotonic(), stale)})

        assert notifications.get_counts(db, user) == fresh
        assert notifications._shared_counts(factory, user.id) == fresh
    engine.dispose()
