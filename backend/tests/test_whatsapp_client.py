# backend/tests/test_whatsapp_client.py
import httpx
import pytest

from app.services import whatsapp_client as wc


def _settings(monkeypatch):
    monkeypatch.setenv("GSSG_WHATSAPP_TOKEN", "tok")
    monkeypatch.setenv("GSSG_WHATSAPP_API_BASE", "https://x.api.infobip.com")
    monkeypatch.setenv("GSSG_WHATSAPP_SENDER", "447860099299")
    from app.config import get_settings
    get_settings.cache_clear()
    return get_settings()


def test_send_text_success_builds_template_payload(monkeypatch):
    _settings(monkeypatch)
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        import json
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200, json={"messages": [{"messageId": "mid-1", "status": {"groupName": "PENDING"}}]}
        )

    monkeypatch.setattr(wc, "_transport", httpx.MockTransport(handler))
    res = wc.send_text("+971501234567", "leave_approved_ar", "ar", ["A", "B"])
    assert res.ok is True
    assert res.message_id == "mid-1"
    assert captured["url"] == "https://x.api.infobip.com/whatsapp/1/message/template"
    assert captured["auth"] == "App tok"
    msg = captured["body"]["messages"][0]
    assert msg["from"] == "447860099299"
    assert msg["to"] == "971501234567"             # no leading +
    assert msg["content"]["templateName"] == "leave_approved_ar"
    assert msg["content"]["language"] == "ar"
    assert msg["content"]["templateData"]["body"]["placeholders"] == ["A", "B"]


def test_send_text_api_error_maps_message(monkeypatch):
    _settings(monkeypatch)

    def handler(request):
        return httpx.Response(
            400,
            json={"requestError": {"serviceException": {"text": "Invalid recipient"}}},
        )

    monkeypatch.setattr(wc, "_transport", httpx.MockTransport(handler))
    res = wc.send_text("+9710000", "leave_approved_en", "en", ["X"])
    assert res.ok is False
    assert "Invalid recipient" in res.error


def test_send_text_retries_once_then_fails(monkeypatch):
    _settings(monkeypatch)
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(wc, "_transport", httpx.MockTransport(handler))
    res = wc.send_text("+971501234567", "violation_en", "en", ["X"])
    assert res.ok is False
    assert calls["n"] == 2  # initial + one retry
    assert "boom" in res.error or "connect" in res.error.lower()
