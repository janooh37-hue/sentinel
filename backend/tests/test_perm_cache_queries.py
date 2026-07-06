"""B4/P7 — effective_caps is memoized per request (User instance), so repeated
capability checks within one request don't re-query role/user permissions."""

from app.db.models import User
from app.services import perm_service


def _operator(db) -> User:
    u = User(email="op@x.ae", password_hash="x", role="operator", status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_effective_caps_memoized_per_user_instance(db_session, count_queries):
    user = _operator(db_session)
    with count_queries() as q:
        perm_service.has_capability(db_session, user, "books.view")
        perm_service.has_capability(db_session, user, "leaves.view")
        perm_service.has_capability(db_session, user, "ledger.view")
    # first resolution = role-caps + user-overrides (2 queries); the next two
    # checks hit the cached set (0 queries). Not 2 per call.
    assert q.count <= 2, f"expected memoized caps, got {q.count} queries"


def test_effective_caps_still_correct(db_session):
    user = _operator(db_session)
    caps = perm_service.effective_caps(db_session, user)
    assert "app.access" in caps  # operator baseline
    assert "users.manage" not in caps  # not an operator capability
