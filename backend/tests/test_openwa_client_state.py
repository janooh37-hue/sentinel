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


def test_fetch_qr_returns_data_url_from_png(monkeypatch):
    import base64

    _cfg(monkeypatch)
    png = b"\x89PNG\r\n\x1a\nDEADBEEF"
    wa._transport = httpx.MockTransport(
        lambda r: httpx.Response(200, content=png, headers={"content-type": "image/png"})
    )
    assert wa.fetch_qr() == "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def test_fetch_qr_none_on_error(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(500, text="x"))
    assert wa.fetch_qr() is None


def test_logout_true_on_2xx(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"ok": True}))
    assert wa.logout() is True


def test_logout_false_on_error(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(500, text="x"))
    assert wa.logout() is False


def test_logout_false_on_transport_error(monkeypatch):
    _cfg(monkeypatch)

    def boom(r):
        raise httpx.ConnectError("down")

    wa._transport = httpx.MockTransport(boom)
    assert wa.logout() is False


def test_probe_timeout_is_short():
    assert wa._PROBE_TIMEOUT.read == 3.0
