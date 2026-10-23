"""Exercise live-session authorization through the public SSE HTTP endpoint."""

import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.api.v1 import notifications
from app.core.security import hash_token
from app.db.models import AuthSession, User
from app.db.session import get_db
from app.main import create_app
from tests.conftest import make_user


@pytest.mark.parametrize("transition", ["revoke", "expire", "disable", "setup", "reporter"])
@pytest.mark.parametrize("warm_cache", [True, False])
def test_stream_stops_when_originating_session_loses_authority(
    api_db: Session, monkeypatch: pytest.MonkeyPatch, transition: str, warm_cache: bool
) -> None:
    user = make_user(api_db, email="stream@lifecycle.test")
    other = make_user(api_db, email="authorized@lifecycle.test")
    now = datetime.now(UTC).replace(tzinfo=None)
    for token, user_id in (("stream-a", user.id), ("stream-b", user.id), ("other", other.id)):
        api_db.add(
            AuthSession(
                user_id=user_id,
                token_hash=hash_token(token),
                expires_at=now + timedelta(days=1),
                last_seen_at=now,
            )
        )
    api_db.commit()
    factory = sessionmaker(bind=api_db.get_bind(), autoflush=False, expire_on_commit=False)
    app = create_app()

    def request_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = request_db
    client = TestClient(app)
    client.cookies.set("gssg_session", "stream-a")
    monkeypatch.setattr(notifications, "_counts_cache", {})
    warmed = client.get("/api/v1/notifications/counts")
    assert warmed.status_code == 200, warmed.text
    original_counts = notifications._counts_cache[user.id][1]
    expected_state = []
    sleeps = []

    def account_state(db):
        return [
            tuple(getattr(row, col.name) for col in row.__table__.columns)
            for model in (User, AuthSession)
            for row in db.scalars(select(model).order_by(model.id))
        ]

    async def transition_on_tick(seconds):
        sleeps.append(seconds)
        assert len(sleeps) == 1, "stream failed to end after authorization loss"
        with factory() as db:
            session = db.scalar(
                select(AuthSession).where(AuthSession.token_hash == hash_token("stream-a"))
            )
            account = db.get(User, user.id)
            assert session is not None and account is not None
            if transition == "revoke":
                session.revoked = True
            elif transition == "expire":
                session.expires_at = now - timedelta(seconds=1)
            elif transition == "disable":
                account.status = "disabled"
            elif transition == "setup":
                account.password_change_required = True
            else:
                account.role = "inmate_reporter"
            db.commit()
            db.expire_all()
            expected_state.extend(account_state(db))
        if warm_cache:
            # Another tab refreshed counts. A warm per-user cache must not
            # authorize this connection or disclose its changed metadata.
            notifications._counts_cache[user.id] = (
                time.monotonic(),
                original_counts.model_copy(update={"approvals": original_counts.approvals + 1}),
            )
        else:
            notifications._counts_cache.clear()

    monkeypatch.setattr(
        notifications, "anyio", SimpleNamespace(sleep=transition_on_tick, to_thread=anyio.to_thread)
    )
    response = client.get("/api/v1/notifications/stream?max_events=2")
    assert response.status_code == 200, response.text
    assert response.text.count("event: counts") == 1, response.text
    assert sleeps == [notifications.POLL_SECONDS]
    with factory() as db:
        assert account_state(db) == expected_state
        sibling = db.scalar(
            select(AuthSession).where(AuthSession.token_hash == hash_token("stream-b"))
        )
        assert sibling is not None and not sibling.revoked and sibling.expires_at > now

    client.cookies.set(
        "gssg_session", "stream-b" if transition in ("revoke", "expire") else "other"
    )
    authorized = client.get("/api/v1/notifications/stream?max_events=1")
    assert authorized.status_code == 200, authorized.text
    assert authorized.text.count("event: counts") == 1
