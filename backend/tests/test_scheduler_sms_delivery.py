"""Tests for scheduler delivery polling (channel-aware, via notify_dispatch)."""

from __future__ import annotations

from typing import Any

import pytest


def test_run_notify_delivery_poll_invokes_dispatch(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify _run_notify_delivery_poll calls poll_deliveries when it returns 0."""
    from app.services import notify_dispatch, scheduler_service

    calls: dict[str, int] = {"n": 0}

    def mock_poll(session: Any) -> int:
        calls["n"] += 1
        return 0

    monkeypatch.setattr(notify_dispatch, "poll_deliveries", mock_poll)
    scheduler_service._run_notify_delivery_poll()  # opens its own SessionLocal
    assert calls["n"] == 1


def test_run_notify_delivery_poll_with_pending_deliveries(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify _run_notify_delivery_poll handles n > 0 deliveries (logs and continues)."""
    from app.services import notify_dispatch, scheduler_service

    calls: dict[str, int] = {"n": 0}

    def mock_poll(session: Any) -> int:
        calls["n"] += 1
        return 2

    monkeypatch.setattr(notify_dispatch, "poll_deliveries", mock_poll)
    scheduler_service._run_notify_delivery_poll()  # opens its own SessionLocal
    assert calls["n"] == 1
