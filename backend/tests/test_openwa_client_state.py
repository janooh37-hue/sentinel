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

    def handler(request):
        # fetch_qr probes the session first so it can revive a stopped one.
        if request.url.path.endswith("/auth/qr"):
            return httpx.Response(200, content=png, headers={"content-type": "image/png"})
        return httpx.Response(200, json={"status": "SCAN_QR_CODE"})

    wa._transport = httpx.MockTransport(handler)
    assert wa.fetch_qr() == "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def test_fetch_qr_none_on_error(monkeypatch):
    _cfg(monkeypatch)
    wa._transport = httpx.MockTransport(lambda r: httpx.Response(500, text="x"))
    assert wa.fetch_qr() is None


def _qr_router(statuses, calls):
    """Mock WAHA: /restart records the call, /auth/qr serves a PNG, else session status.

    ``statuses`` is consumed one entry per status probe; the last entry sticks.
    """
    png = b"\x89PNG\r\n\x1a\nDEADBEEF"

    def handle(request):
        path = request.url.path
        if path.endswith("/restart"):
            calls.append("restart")
            return httpx.Response(201, json={"status": "STARTING"})
        if path.endswith("/auth/qr"):
            calls.append("qr")
            return httpx.Response(200, content=png, headers={"content-type": "image/png"})
        return httpx.Response(
            200, json={"status": statuses.pop(0) if len(statuses) > 1 else statuses[0]}
        )

    return handle


def test_fetch_qr_starts_a_stopped_session(monkeypatch):
    """WAHA force-stops the session ~90s after an unscanned QR — the dialog must revive it."""
    _cfg(monkeypatch)
    calls = []
    wa._transport = httpx.MockTransport(_qr_router(["STOPPED", "SCAN_QR_CODE"], calls))
    assert wa.fetch_qr() is not None
    assert calls == ["restart", "qr"]


def test_fetch_qr_restarts_a_failed_session(monkeypatch):
    _cfg(monkeypatch)
    calls = []
    wa._transport = httpx.MockTransport(_qr_router(["FAILED", "SCAN_QR_CODE"], calls))
    assert wa.fetch_qr() is not None
    assert calls == ["restart", "qr"]


def test_fetch_qr_does_not_restart_while_scanning(monkeypatch):
    """The dialog polls every 20s; restarting a live QR session would reset it each time."""
    _cfg(monkeypatch)
    calls = []
    wa._transport = httpx.MockTransport(_qr_router(["SCAN_QR_CODE"], calls))
    assert wa.fetch_qr() is not None
    assert calls == ["qr"]


def test_fetch_qr_does_not_restart_while_starting(monkeypatch):
    """STARTING is mid-handshake — restarting it would thrash so it never settles."""
    _cfg(monkeypatch)
    calls = []
    wa._transport = httpx.MockTransport(_qr_router(["STARTING"], calls))
    wa.fetch_qr()
    assert "restart" not in calls


def test_fetch_qr_short_circuits_a_working_session(monkeypatch):
    """Linked means nothing to scan — and WAHA stalls ~10s before 422ing that request."""
    _cfg(monkeypatch)
    calls = []
    wa._transport = httpx.MockTransport(_qr_router(["WORKING"], calls))
    assert wa.fetch_qr() is None
    assert calls == []  # neither restarted (would unlink) nor asked for a QR


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


def test_cached_session_state_collapses_calls(monkeypatch):
    wa.reset_status_cache()
    calls = {"n": 0}

    def counting():
        calls["n"] += 1
        return "connected"

    monkeypatch.setattr(wa, "session_state", counting)
    assert wa.cached_session_state() == "connected"
    assert wa.cached_session_state() == "connected"
    assert wa.cached_session_state() == "connected"
    assert calls["n"] == 1  # cached within the TTL window
    wa.reset_status_cache()
    assert wa.cached_session_state() == "connected"
    assert calls["n"] == 2  # re-probed after reset
