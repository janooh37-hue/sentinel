# backend/tests/test_permission_request_service.py
import pytest
from app.api.errors import AppError
from app.services import permission_request_service as prs, perm_service
from tests.conftest import make_user


def test_create_request_for_missing_cap(db_session):
    u = make_user(db_session, role="operator")
    r = prs.create_request(db_session, u, "books.approve")
    assert r.status == "pending" and r.capability == "books.approve"


def test_cannot_request_cap_already_held(db_session):
    u = make_user(db_session, role="operator")  # operators have books.view
    with pytest.raises(AppError) as ei:
        prs.create_request(db_session, u, "books.view")
    assert ei.value.code == "ALREADY_GRANTED"


def test_cannot_request_sensitive_cap(db_session):
    u = make_user(db_session, role="operator")
    with pytest.raises(AppError) as ei:
        prs.create_request(db_session, u, "users.manage")
    assert ei.value.code == "FORBIDDEN_REQUEST"


def test_duplicate_request_collapses(db_session):
    u = make_user(db_session, role="operator")
    a = prs.create_request(db_session, u, "books.approve")
    b = prs.create_request(db_session, u, "books.approve")
    assert a.id == b.id


def test_decide_permanent_grants(db_session):
    u = make_user(db_session, role="operator")
    admin = make_user(db_session, role="admin", email="a@x.ae")
    r = prs.create_request(db_session, u, "books.approve")
    prs.decide(db_session, r.id, admin=admin, decision="permanent")
    assert "books.approve" in perm_service.effective_caps(db_session, u)
    assert r.status == "granted" and r.decision == "permanent"


def test_decide_once_sets_expiry(db_session):
    u = make_user(db_session, role="operator")
    admin = make_user(db_session, role="admin", email="a@x.ae")
    r = prs.create_request(db_session, u, "books.approve")
    prs.decide(db_session, r.id, admin=admin, decision="once", window="2h")
    from app.db.models import UserPermission
    row = db_session.get(UserPermission, (u.id, "books.approve"))
    assert row.expires_at is not None


def test_decide_refuse(db_session):
    u = make_user(db_session, role="operator")
    admin = make_user(db_session, role="admin", email="a@x.ae")
    r = prs.create_request(db_session, u, "books.approve")
    prs.decide(db_session, r.id, admin=admin, decision="refused", note="not now")
    assert r.status == "refused"
    assert "books.approve" not in perm_service.effective_caps(db_session, u)
