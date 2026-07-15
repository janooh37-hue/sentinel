"""Tests for the daily leave-ending reminder scheduler worker."""

import contextlib
from types import SimpleNamespace

from app.services import scheduler_service as sched


def test_run_leave_ending_reminder_calls_dispatch(monkeypatch):
    called = {"n": 0}
    dummy_session = SimpleNamespace()

    @contextlib.contextmanager
    def _fake_session_local():
        yield dummy_session

    monkeypatch.setattr(sched, "SessionLocal", _fake_session_local)

    def fake_send(db):
        called["n"] += 1
        return 2

    monkeypatch.setattr(sched.notify_dispatch, "send_ending_reminders", fake_send)
    sched._run_leave_ending_reminder()
    assert called["n"] == 1


def test_run_leave_ending_reminder_swallows_errors(monkeypatch):
    dummy_session = SimpleNamespace()

    @contextlib.contextmanager
    def _fake_session_local():
        yield dummy_session

    monkeypatch.setattr(sched, "SessionLocal", _fake_session_local)

    def boom(db):
        raise RuntimeError("gateway down")

    monkeypatch.setattr(sched.notify_dispatch, "send_ending_reminders", boom)
    sched._run_leave_ending_reminder()  # must not raise
