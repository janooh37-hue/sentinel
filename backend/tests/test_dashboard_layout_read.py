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


def test_layout_saved_before_canvas_width_reads_as_compact(db_session):
    # The field was added after operators already had saved layouts; the read
    # must not silently widen their dashboard.
    _store_layout(db_session, {"widgets": [], "quick_actions": []})
    settings = settings_service.get_settings(db_session)
    assert settings.dashboard_layout is not None
    assert settings.dashboard_layout.canvas_width == "compact"


def test_wide_canvas_width_round_trips(db_session):
    _store_layout(
        db_session,
        {"widgets": [], "quick_actions": [], "canvas_width": "wide"},
    )
    settings = settings_service.get_settings(db_session)
    assert settings.dashboard_layout is not None
    assert settings.dashboard_layout.canvas_width == "wide"


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


def test_widget_tuple_and_literal_stay_in_sync():
    # Same hand-duplication risk as the quick-action ids above, for the widget
    # catalog (e.g. `pending_departures`): the tuple gates the tolerant read
    # in settings_service, the Literal gates API validation. If they diverge,
    # an operator can enable a widget in Customize, save, and watch it vanish
    # on reload because the read path silently drops the unknown id.
    from typing import get_args

    from app.schemas.settings import DASHBOARD_WIDGET_IDS, DashboardWidgetId

    assert set(DASHBOARD_WIDGET_IDS) == set(get_args(DashboardWidgetId))
