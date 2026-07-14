import base64

import httpx

from app.services import openwa_client as wa


def _mock(handler):
    wa._transport = httpx.MockTransport(handler)


def teardown_function():
    wa._transport = None


def test_send_to_chat_posts_group_chat_id(monkeypatch):
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"] = str(req.url)
        seen["json"] = __import__("json").loads(req.content)
        return httpx.Response(200, json={"id": "G1"})

    _mock(handler)
    monkeypatch.setattr(
        wa,
        "get_settings",
        lambda: __import__("types").SimpleNamespace(
            openwa_api_base="http://x", openwa_api_key="k", openwa_session="s"
        ),
    )
    res = wa.send_to_chat("123-456@g.us", "hi")
    assert res.ok and res.message_id == "G1"
    assert seen["json"]["chatId"] == "123-456@g.us"  # group id passed verbatim, no @c.us
    assert "send-text" in seen["url"]


def test_send_still_wraps_phone_as_c_us(monkeypatch):
    seen = {}

    def handler(req):
        seen["json"] = __import__("json").loads(req.content)
        return httpx.Response(200, json={"id": "m1"})

    _mock(handler)
    monkeypatch.setattr(
        wa,
        "get_settings",
        lambda: __import__("types").SimpleNamespace(
            openwa_api_base="http://x", openwa_api_key="k", openwa_session="s"
        ),
    )
    wa.send("971500", "hi")
    assert seen["json"]["chatId"] == "971500@c.us"


def test_list_groups_parses(monkeypatch):
    def handler(req):
        return httpx.Response(
            200, json=[{"id": "1@g.us", "name": "Alpha"}, {"id": "2@g.us", "name": "Bravo"}]
        )

    _mock(handler)
    monkeypatch.setattr(
        wa,
        "get_settings",
        lambda: __import__("types").SimpleNamespace(
            openwa_api_base="http://x", openwa_api_key="k", openwa_session="s"
        ),
    )
    groups = wa.list_groups()
    assert [(g.id, g.name) for g in groups] == [("1@g.us", "Alpha"), ("2@g.us", "Bravo")]


def test_list_groups_empty_on_error(monkeypatch):
    _mock(lambda req: httpx.Response(500, text="boom"))
    monkeypatch.setattr(
        wa,
        "get_settings",
        lambda: __import__("types").SimpleNamespace(
            openwa_api_base="http://x", openwa_api_key="k", openwa_session="s"
        ),
    )
    assert wa.list_groups() == []


def test_send_file_posts_base64(monkeypatch):
    seen = {}

    def handler(req):
        seen["json"] = __import__("json").loads(req.content)
        return httpx.Response(200, json={"id": "f1"})

    _mock(handler)
    monkeypatch.setattr(
        wa,
        "get_settings",
        lambda: __import__("types").SimpleNamespace(
            openwa_api_base="http://x", openwa_api_key="k", openwa_session="s"
        ),
    )
    res = wa.send_file("1@g.us", data=b"PDFBYTES", filename="a.pdf", caption="see this")
    assert res.ok and res.message_id == "f1"
    assert base64.b64decode(seen["json"]["file"]) == b"PDFBYTES"
    assert seen["json"]["chatId"] == "1@g.us"
    assert seen["json"]["filename"] == "a.pdf"
    assert seen["json"]["caption"] == "see this"
