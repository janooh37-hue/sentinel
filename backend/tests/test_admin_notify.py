from app.services import admin_notify
from tests.conftest import make_user


def test_active_admins_only(db_session):
    make_user(db_session, role="operator", email="o@x.ae")
    a1 = make_user(db_session, role="admin", email="a1@x.ae")
    make_user(db_session, role="admin", status="disabled", email="a2@x.ae")
    ids = {a.id for a in admin_notify.active_admins(db_session)}
    assert ids == {a1.id}


def test_notify_is_safe_without_subscriptions(db_session):
    a = make_user(db_session, role="admin", email="a@x.ae")
    admin_notify.notify_admins_new_request(db_session, make_user(db_session, email="r@x.ae"), "Approve books", 1)
    # no exception == pass
