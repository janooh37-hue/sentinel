"""A dashboard layout persisted before a quick-action id was removed must still
load — the read path drops now-unknown ids instead of raising."""
from __future__ import annotations

import json

from app.db.models import AppSetting
from app.services import settings_service


def _store_layout(db, layout: dict) -> None:
    db.add(
        AppSetting(
            key="settings.dashboard_layout",
            value=json.dumps(None),
            dashboard_layout=layout,
        )
    )
    db.commit()


def test_stale_quick_action_id_is_dropped(db_session):
    _store_layout(
        db_session,
        {
            "widgets": [],
            "quick_actions": [
                {"id": "Leave Undertaking", "visible": True, "order": 0},
                {"id": "Leave Application Form", "visible": True, "order": 1},
            ],
        },
    )
    settings = settings_service.get_settings(db_session)
    ids = [qa.id for qa in settings.dashboard_layout.quick_actions]
    assert "Leave Undertaking" not in ids
    assert "Leave Application Form" in ids


def test_quick_action_ids_exclude_companions_but_keep_primary():
    from app.schemas.settings import DASHBOARD_QUICK_ACTION_IDS

    assert "Leave Undertaking" not in DASHBOARD_QUICK_ACTION_IDS
    assert "Resignation Declaration" not in DASHBOARD_QUICK_ACTION_IDS
    # The primary form (not a companion) must stay pinnable.
    assert "Resignation Letter" in DASHBOARD_QUICK_ACTION_IDS


def test_quick_action_tuple_and_literal_stay_in_sync():
    # The runtime tuple and the Pydantic Literal are hand-duplicated; a future
    # edit to one and not the other would silently diverge (the tuple gates the
    # tolerant read, the Literal gates API validation). Guard that they match.
    from typing import get_args

    from app.schemas.settings import DASHBOARD_QUICK_ACTION_IDS, DashboardQuickActionId

    assert set(DASHBOARD_QUICK_ACTION_IDS) == set(get_args(DashboardQuickActionId))
