# backend/tests/test_perm_expiry.py
from datetime import UTC, datetime, timedelta

from app.db.models import UserPermission
from app.services import perm_service
from tests.conftest import make_user


def test_expired_grant_is_ignored(db_session):
    u = make_user(db_session)
    past = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=1)
    db_session.add(UserPermission(user_id=u.id, capability="leaves.edit", effect="grant", expires_at=past))
    db_session.commit()
    assert "leaves.edit" not in perm_service.effective_caps(db_session, u)


def test_future_grant_is_honored(db_session):
    u = make_user(db_session)
    future = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1)
    db_session.add(UserPermission(user_id=u.id, capability="leaves.edit", effect="grant", expires_at=future))
    db_session.commit()
    assert "leaves.edit" in perm_service.effective_caps(db_session, u)
