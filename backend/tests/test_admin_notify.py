from app.db.models import BookCategory
from app.services import admin_notify
from app.services import capability_catalog_service as catalog_service
from tests.conftest import make_user


def test_active_admins_only(db_session):
    make_user(db_session, role="operator", email="o@x.ae")
    a1 = make_user(db_session, role="admin", email="a1@x.ae")
    make_user(db_session, role="admin", status="disabled", email="a2@x.ae")
    ids = {a.id for a in admin_notify.active_admins(db_session)}
    assert ids == {a1.id}


def test_notify_uses_catalog_labels_and_request_link(db_session, monkeypatch):
    admin = make_user(db_session, role="admin", email="a@x.ae")
    requester = make_user(db_session, email="r@x.ae")
    requester.display_name = "Requester"
    entry = catalog_service.get_catalog_entry(db_session, "books.approve")
    assert entry is not None
    sends: list[tuple[int, dict[str, tuple[str, str]], str]] = []
    monkeypatch.setattr(
        admin_notify.push_service,
        "send_to_user",
        lambda _db, user_id, messages, url: sends.append((user_id, messages, url)),
    )

    admin_notify.notify_admins_new_request(
        db_session,
        requester,
        capability_id=entry.id,
        entry=entry,
        request_id=1,
    )

    assert sends == [
        (
            admin.id,
            {
                "en": (
                    "GSSG Manager",
                    "New access request\n\u2068Requester\u2069 is requesting "
                    "“\u2068Approve / reject records\u2069”",
                ),
                "ar": (
                    "GSSG Manager",
                    "طلب صلاحية جديد\n\u2068Requester\u2069 يطلب الوصول إلى "
                    "”\u2068اعتماد / رفض السجلات\u2069“",  # noqa: RUF001
                ),
            },
            "/access-requests?tab=permission-requests",
        )
    ]


def test_notify_falls_back_from_arabic_to_english_then_id(db_session, monkeypatch):
    make_user(db_session, role="admin", email="fallback-admin@x.ae")
    requester = make_user(db_session, email="fallback-requester@x.ae")
    category = BookCategory(
        id="NOAR",
        name_en="Operations",
        name_ar=None,
        prefix="NOAR",
    )
    db_session.add(category)
    db_session.commit()
    entry = catalog_service.get_catalog_entry(db_session, "books.category.NOAR")
    assert entry is not None
    messages_sent: list[dict[str, tuple[str, str]]] = []
    monkeypatch.setattr(
        admin_notify.push_service,
        "send_to_user",
        lambda _db, _user_id, messages, _url: messages_sent.append(messages),
    )

    admin_notify.notify_admins_new_request(
        db_session,
        requester,
        capability_id=entry.id,
        entry=entry,
        request_id=2,
    )
    admin_notify.notify_admins_new_request(
        db_session,
        requester,
        capability_id="unknown.capability",
        entry=None,
        request_id=3,
    )

    assert messages_sent == [
        {
            "en": (
                "GSSG Manager",
                "New access request\n\u2068fallback-requester@x.ae\u2069 is "
                "requesting “\u2068Operations\u2069”",
            ),
            "ar": (
                "GSSG Manager",
                "طلب صلاحية جديد\n\u2068fallback-requester@x.ae\u2069 يطلب الوصول "
                "إلى ”\u2068Operations\u2069“",
            ),
        },
        {
            "en": (
                "GSSG Manager",
                "New access request\n\u2068fallback-requester@x.ae\u2069 is "
                "requesting “\u2068unknown.capability\u2069”",
            ),
            "ar": (
                "GSSG Manager",
                "طلب صلاحية جديد\n\u2068fallback-requester@x.ae\u2069 يطلب الوصول "
                "إلى ”\u2068unknown.capability\u2069“",
            ),
        },
    ]


def test_notify_continues_after_one_admin_delivery_fails(db_session, monkeypatch):
    first = make_user(db_session, role="admin", email="first@x.ae")
    second = make_user(db_session, role="admin", email="second@x.ae")
    requester = make_user(db_session, email="continue-requester@x.ae")
    entry = catalog_service.get_catalog_entry(db_session, "books.approve")
    assert entry is not None
    attempted: list[int] = []

    def fake_send(_db, user_id, _messages, _url):
        attempted.append(user_id)
        if user_id == first.id:
            raise RuntimeError("synthetic delivery failure")

    monkeypatch.setattr(admin_notify.push_service, "send_to_user", fake_send)

    admin_notify.notify_admins_new_request(
        db_session,
        requester,
        capability_id=entry.id,
        entry=entry,
        request_id=4,
    )

    assert attempted == [first.id, second.id]
    # no exception == pass
