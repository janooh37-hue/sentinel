import httpx

from app.services import openwa_client as wa


def teardown_function():
    wa._transport = None


def _cfg(monkeypatch, enabled=True):
    monkeypatch.setattr(
        wa,
        "get_settings",
        lambda: __import__("types").SimpleNamespace(
            openwa_enabled=enabled,
            openwa_api_base="http://x",
            openwa_api_key="k",
            openwa_session="s",
        ),
    )


def test_state_disabled(monkeypatch):
    _cfg(monkeypatch, enabled=False)
    assert wa.session_state() == "disabled"


def test_state_unreachable_on_error(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(500, text="down"))
    assert wa.session_state() == "unreachable"


def test_state_disconnected(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"status": "UNPAIRED"}))
    assert wa.session_state() == "disconnected"


def test_state_connected(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"status": "CONNECTED"}))
    assert wa.session_state() == "connected"


def test_fetch_qr_returns_string(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(
        lambda r: httpx.Response(200, json={"qr": "data:image/png;base64,AAAA"})
    )
    assert wa.fetch_qr() == "data:image/png;base64,AAAA"


def test_fetch_qr_none_on_error(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(500, text="x"))
    assert wa.fetch_qr() is None
