from datetime import UTC, datetime, timedelta

from app.db.models import UserPermission
from app.services import perm_service
from tests.conftest import make_user


def test_set_override_with_expiry_persists(db_session):
    u = make_user(db_session)
    exp = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=2)
    perm_service.set_user_override(db_session, u.id, "leaves.edit", "grant", expires_at=exp)
    row = db_session.get(UserPermission, (u.id, "leaves.edit"))
    assert row.expires_at == exp


def test_sweep_deletes_only_expired_grants(db_session):
    u = make_user(db_session)
    now = datetime.now(UTC).replace(tzinfo=None)
    db_session.add(UserPermission(user_id=u.id, capability="leaves.edit", effect="grant", expires_at=now - timedelta(minutes=1)))
    db_session.add(UserPermission(user_id=u.id, capability="books.view", effect="grant", expires_at=now + timedelta(hours=1)))
    db_session.add(UserPermission(user_id=u.id, capability="violations.view", effect="grant", expires_at=None))
    db_session.add(UserPermission(user_id=u.id, capability="ledger.send", effect="deny", expires_at=now - timedelta(days=1)))
    db_session.commit()
    n = perm_service.sweep_expired_grants(db_session)
    assert n == 1
    remaining = {r.capability for r in db_session.query(UserPermission).all()}
    assert remaining == {"books.view", "violations.view", "ledger.send"}
