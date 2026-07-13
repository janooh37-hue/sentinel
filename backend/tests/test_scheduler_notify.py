from app.config import get_settings
from app.services import notify_dispatch, openwa_client, scheduler_service


def test_retry_runner_invokes_dispatch(monkeypatch, db_session):
    called = {"n": 0}
    monkeypatch.setattr(
        notify_dispatch, "retry_queued", lambda db: called.__setitem__("n", called["n"] + 1) or 0
    )
    scheduler_service._run_notify_retry()
    assert called["n"] == 1


def test_delivery_poll_runner_invokes_dispatch(monkeypatch, db_session):
    called = {"n": 0}
    monkeypatch.setattr(
        notify_dispatch, "poll_deliveries", lambda db: called.__setitem__("n", called["n"] + 1) or 0
    )
    scheduler_service._run_notify_delivery_poll()
    assert called["n"] == 1


def test_health_runner_skips_when_disabled(monkeypatch):
    monkeypatch.setenv("GSSG_OPENWA_ENABLED", "0")
    get_settings.cache_clear()
    called = {"n": 0}
    monkeypatch.setattr(openwa_client, "health", lambda: called.__setitem__("n", 1) or True)
    scheduler_service._run_openwa_health()
    get_settings.cache_clear()
    assert called["n"] == 0
