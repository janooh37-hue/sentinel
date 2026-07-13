"""Tests for the monthly leave-digest scheduler worker."""

import contextlib
from types import SimpleNamespace

from app.services import scheduler_service as sched


def test_run_monthly_digest_noops_without_channel(monkeypatch):
    """When neither openwa nor SMS is enabled, send_all_digests must not be called."""
    called = {"n": 0}
    monkeypatch.setattr(
        sched, "get_settings", lambda: SimpleNamespace(openwa_enabled=False, sms_enabled=False)
    )

    def fake_all(*a, **k):
        called["n"] += 1
        return SimpleNamespace(sent=0, messages=[], skips=[])

    monkeypatch.setattr(sched.digest_service, "send_all_digests", fake_all)
    sched._run_monthly_digest()
    assert called["n"] == 0  # skipped before opening a session


def test_run_monthly_digest_calls_send_all_when_enabled(monkeypatch):
    """When a channel is enabled, send_all_digests is called exactly once."""
    called = {"n": 0}
    monkeypatch.setattr(
        sched, "get_settings", lambda: SimpleNamespace(openwa_enabled=True, sms_enabled=False)
    )

    # Provide a SessionLocal that returns a no-op context manager
    dummy_session = SimpleNamespace()

    @contextlib.contextmanager
    def _fake_session_local():
        yield dummy_session

    monkeypatch.setattr(sched, "SessionLocal", _fake_session_local)

    def fake_all(db, *, month, sent_by):
        called["n"] += 1
        return SimpleNamespace(sent=2, messages=[1, 2], skips=[])

    monkeypatch.setattr(sched.digest_service, "send_all_digests", fake_all)
    sched._run_monthly_digest()
    assert called["n"] == 1
