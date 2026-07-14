# backend/tests/test_announce_service_send.py
"""TDD: announce_service group-list + fan-out send functions."""

from types import SimpleNamespace

import pytest

from app.services import announce_service as a
from app.services import notify_dispatch


def _enabled(monkeypatch, on=True):
    monkeypatch.setattr(a, "get_settings", lambda: SimpleNamespace(openwa_enabled=on))


def test_send_text_to_each_group(db_session, monkeypatch):
    _enabled(monkeypatch)
    calls = []
    monkeypatch.setattr(
        a.openwa_client,
        "send_to_chat",
        lambda cid, txt: (
            calls.append((cid, txt)) or SimpleNamespace(ok=True, message_id="m", error=None)
        ),
    )
    res = a.send_announcement(
        db_session,
        groups=[("1@g.us", "Alpha"), ("2@g.us", "Bravo")],
        text="notice",
        attachment=None,
        book_id=None,
        sent_by=3,
    )
    assert res.sent == 2 and res.failed == 0
    assert [c[0] for c in calls] == ["1@g.us", "2@g.us"]
    assert all(c[1] == "notice" for c in calls)


def test_send_file_when_attachment(db_session, monkeypatch):
    _enabled(monkeypatch)
    seen = {}
    monkeypatch.setattr(
        a.openwa_client,
        "send_file",
        lambda cid, *, data, filename, caption: (
            seen.update(cid=cid, filename=filename, caption=caption, n=len(data))
            or SimpleNamespace(ok=True, message_id="f", error=None)
        ),
    )
    res = a.send_announcement(
        db_session,
        groups=[("1@g.us", "Alpha")],
        text="see doc",
        attachment=a.Attachment(filename="x.pdf", data=b"PDF"),
        book_id=None,
        sent_by=1,
    )
    assert res.sent == 1
    assert seen == {"cid": "1@g.us", "filename": "x.pdf", "caption": "see doc", "n": 3}


def test_failed_group_recorded(db_session, monkeypatch):
    _enabled(monkeypatch)
    monkeypatch.setattr(
        a.openwa_client,
        "send_to_chat",
        lambda cid, txt: SimpleNamespace(ok=False, message_id=None, error="HTTP 500"),
    )
    res = a.send_announcement(
        db_session,
        groups=[("1@g.us", "Alpha")],
        text="x",
        attachment=None,
        book_id=None,
        sent_by=None,
    )
    assert res.sent == 0 and res.failed == 1
    assert res.results[0].error == "HTTP 500"


def test_disabled_raises(db_session, monkeypatch):
    _enabled(monkeypatch, on=False)
    with pytest.raises(notify_dispatch.NotifyDisabledError):
        a.send_announcement(
            db_session,
            groups=[("1@g.us", "Alpha")],
            text="x",
            attachment=None,
            book_id=None,
            sent_by=None,
        )
