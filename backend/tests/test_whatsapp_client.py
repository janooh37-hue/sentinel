# backend/tests/test_whatsapp_client.py
import httpx
import pytest

from app.services import whatsapp_client as wc


def _settings(monkeypatch):
    monkeypatch.setenv("GSSG_WHATSAPP_TOKEN", "tok")
    monkeypatch.setenv("GSSG_WHATSAPP_PHONE_NUMBER_ID", "PNID")
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
        return httpx.Response(200, json={"messages": [{"id": "wamid.ABC"}]})

    monkeypatch.setattr(wc, "_transport", httpx.MockTransport(handler))
    res = wc.send_text("+971501234567", "leave_approved_ar", "ar", ["A", "B"])
    assert res.ok is True
    assert res.message_id == "wamid.ABC"
    assert captured["url"].endswith("/PNID/messages")
    assert captured["auth"] == "Bearer tok"
    body = captured["body"]
    assert body["to"] == "971501234567"            # no leading +
    assert body["type"] == "template"
    assert body["template"]["name"] == "leave_approved_ar"
    assert body["template"]["language"]["code"] == "ar"
    texts = [p["text"] for p in body["template"]["components"][0]["parameters"]]
    assert texts == ["A", "B"]


def test_send_text_api_error_maps_message(monkeypatch):
    _settings(monkeypatch)

    def handler(request):
        return httpx.Response(400, json={"error": {"message": "Invalid number"}})

    monkeypatch.setattr(wc, "_transport", httpx.MockTransport(handler))
    res = wc.send_text("+9710000", "leave_approved_en", "en", ["X"])
    assert res.ok is False
    assert "Invalid number" in res.error


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
