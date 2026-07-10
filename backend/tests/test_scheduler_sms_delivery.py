"""Tests for scheduler SMS delivery polling."""

from __future__ import annotations

from typing import Any


def test_run_sms_delivery_poll_invokes_service(monkeypatch: Any) -> None:
    """Verify _run_sms_delivery_poll calls poll_pending_deliveries."""
    from app.services import scheduler_service, sms_service

    calls: dict[str, int] = {"n": 0}

    def mock_poll(session: Any) -> int:
        calls["n"] += 1
        return 0

    monkeypatch.setattr(sms_service, "poll_pending_deliveries", mock_poll)
    scheduler_service._run_sms_delivery_poll()  # opens its own SessionLocal
    assert calls["n"] == 1
