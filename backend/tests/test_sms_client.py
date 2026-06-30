import base64
import json

import httpx

from app.services import sms_client as sc


def _settings(monkeypatch, base="http://192.168.1.50:8080"):
    monkeypatch.setenv("GSSG_SMS_GATEWAY_URL", base)
    monkeypatch.setenv("GSSG_SMS_USERNAME", "user")
    monkeypatch.setenv("GSSG_SMS_PASSWORD", "pass")
    from app.config import get_settings
    get_settings.cache_clear()
    return get_settings()


def test_send_success_builds_payload_and_basic_auth(monkeypatch):
    _settings(monkeypatch)
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "sms-1", "state": "Pending"})

    monkeypatch.setattr(sc, "_transport", httpx.MockTransport(handler))
    res = sc.send("+971501234567", "Hello world")
    assert res.ok is True
    assert res.message_id == "sms-1"
    assert captured["url"] == "http://192.168.1.50:8080/message"
    expected = "Basic " + base64.b64encode(b"user:pass").decode()
    assert captured["auth"] == expected
    assert captured["body"] == {
        "textMessage": {"text": "Hello world"},
        "phoneNumbers": ["+971501234567"],
    }


def test_send_tolerates_schemeless_base_defaults_http(monkeypatch):
    _settings(monkeypatch, base="192.168.1.50:8080/")
    captured = {}

    def handler(request):
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"id": "sms-2"})

    monkeypatch.setattr(sc, "_transport", httpx.MockTransport(handler))
    res = sc.send("+971501234567", "hi")
    assert res.ok is True
    assert captured["url"] == "http://192.168.1.50:8080/message"


def test_send_http_error_maps_message(monkeypatch):
    _settings(monkeypatch)

    def handler(request):
        return httpx.Response(401, text="Unauthorized")

    monkeypatch.setattr(sc, "_transport", httpx.MockTransport(handler))
    res = sc.send("+971501234567", "hi")
    assert res.ok is False
    assert "401" in res.error
    assert "Unauthorized" in res.error


def test_send_retries_once_then_fails(monkeypatch):
    _settings(monkeypatch)
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(sc, "_transport", httpx.MockTransport(handler))
    res = sc.send("+971501234567", "hi")
    assert res.ok is False
    assert calls["n"] == 2  # initial + one retry
    assert "boom" in res.error or "connect" in res.error.lower()
