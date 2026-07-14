import httpx
import pytest

from app.config import get_settings
from app.services import openwa_client


@pytest.fixture(autouse=True)
def _cfg(monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setenv("GSSG_OPENWA_ENABLED", "1")
    monkeypatch.setenv("GSSG_OPENWA_API_BASE", "http://openwa.test:2785")
    monkeypatch.setenv("GSSG_OPENWA_API_KEY", "k")
    monkeypatch.setenv("GSSG_OPENWA_SESSION", "default")
    yield
    get_settings.cache_clear()
    openwa_client._transport = None


def _mock(handler):
    openwa_client._transport = httpx.MockTransport(handler)


def test_send_ok_posts_sendtext_with_session_body():
    def handler(req):
        assert req.headers["X-API-Key"] == "k"
        assert req.url.path == "/api/sendText"
        import json

        body = json.loads(req.content)
        assert body == {"session": "default", "chatId": "971500000000@c.us", "text": "hi"}
        return httpx.Response(201, json={"id": "true_971500000000@c.us_3EB0"})

    _mock(handler)
    r = openwa_client.send("971500000000", "hi")
    assert r.ok and r.message_id == "true_971500000000@c.us_3EB0"


def test_send_extracts_serialized_id_object():
    def handler(req):
        return httpx.Response(201, json={"id": {"_serialized": "true_x@c.us_9F"}})

    _mock(handler)
    r = openwa_client.send("971500000000", "hi")
    assert r.ok and r.message_id == "true_x@c.us_9F"


def test_send_not_registered_maps_flag():
    def handler(req):
        return httpx.Response(422, json={"message": "not a WhatsApp user"})

    _mock(handler)
    r = openwa_client.send("971500000000", "hi")
    assert not r.ok and r.not_registered


def test_send_transport_error_retries_then_fails():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        raise httpx.ConnectError("boom")

    _mock(handler)
    r = openwa_client.send("971500000000", "hi")
    assert not r.ok and calls["n"] == 2


def test_send_not_registered_from_body_text_non_422():
    def handler(req):
        return httpx.Response(400, json={"message": "not registered"})

    _mock(handler)
    r = openwa_client.send("971500000000", "hi")
    assert not r.ok and r.not_registered


def test_send_file_posts_sendfile_with_file_object():
    import base64
    import json

    def handler(req):
        assert req.url.path == "/api/sendFile"
        body = json.loads(req.content)
        assert body["session"] == "default"
        assert body["chatId"] == "123@g.us"
        assert body["file"] == {
            "mimetype": "application/pdf",
            "filename": "book.pdf",
            "data": base64.b64encode(b"PDFDATA").decode("ascii"),
        }
        assert body["caption"] == "cap"
        return httpx.Response(201, json={"id": "true_123@g.us_AA"})

    _mock(handler)
    r = openwa_client.send_file("123@g.us", data=b"PDFDATA", filename="book.pdf", caption="cap")
    assert r.ok and r.message_id == "true_123@g.us_AA"


def test_get_ack_retries_on_transport_error():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        raise httpx.ConnectError("boom")

    _mock(handler)
    r = openwa_client.get_ack("m1")
    assert not r.ok and calls["n"] == 2


def test_is_registered_true():
    def handler(req):
        return httpx.Response(200, json={"numberExists": True})

    _mock(handler)
    assert openwa_client.is_registered("971500000000") is True


def test_is_registered_unknown_on_error():
    def handler(req):
        return httpx.Response(500, text="err")

    _mock(handler)
    assert openwa_client.is_registered("971500000000") is None


def test_health_true_when_connected():
    def handler(req):
        return httpx.Response(200, json={"status": "CONNECTED"})

    _mock(handler)
    assert openwa_client.health() is True
