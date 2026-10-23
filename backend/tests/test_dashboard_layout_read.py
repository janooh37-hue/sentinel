"""Dashboard layout schema and tolerant per-user read contracts."""

from __future__ import annotations

from typing import get_args

import pytest
from pydantic import ValidationError

from app.db.models import User, UserDashboardLayout
from app.schemas.dashboard import (
    DASHBOARD_QUICK_ACTION_IDS,
    DASHBOARD_WIDGET_IDS,
    DashboardLayout,
    DashboardQuickActionId,
    DashboardWidgetId,
)
from app.services import dashboard_service


def _store_layout(db, layout: dict) -> User:
    user = User(
        email=f"layout-{id(layout)}@x.ae",
        password_hash="x",
        role="operator",
        status="active",
    )
    db.add(user)
    db.flush()
    db.add(UserDashboardLayout(user_id=user.id, layout=layout))
    db.commit()
    return user


def test_stale_quick_action_is_pruned_without_discarding_valid_layout(db_session):
    user = _store_layout(
        db_session,
        {
            "widgets": [
                {
                    "id": "workspace",
                    "visible": False,
                    "order": 2,
                    "zone": "top",
                }
            ],
            "quick_actions": [
                {"id": "Leave Undertaking", "visible": True, "order": 0},
                {"id": "General Book", "visible": False, "order": 1},
            ],
            "canvas_width": "wide",
        },
    )

    layout = dashboard_service.get_user_layout(db_session, user.id)

    assert layout is not None
    assert layout.canvas_width == "wide"
    assert layout.widgets[0].model_dump() == {
        "id": "workspace",
        "visible": False,
        "order": 2,
        "zone": "top",
        "size": "M",
    }
    assert [action.model_dump() for action in layout.quick_actions] == [
        {"id": "General Book", "visible": False, "order": 1}
    ]


def test_layout_saved_before_canvas_width_reads_as_compact(db_session):
    user = _store_layout(db_session, {"widgets": [], "quick_actions": []})

    layout = dashboard_service.get_user_layout(db_session, user.id)
    assert layout is not None
    assert layout.canvas_width == "compact"


def test_wide_canvas_width_round_trips(db_session):
    user = _store_layout(
        db_session,
        {"widgets": [], "quick_actions": [], "canvas_width": "wide"},
    )

    layout = dashboard_service.get_user_layout(db_session, user.id)
    assert layout is not None
    assert layout.canvas_width == "wide"


def test_quick_action_ids_exclude_companions_but_keep_primary():
    assert "Leave Undertaking" not in DASHBOARD_QUICK_ACTION_IDS
    assert "Resignation Declaration" not in DASHBOARD_QUICK_ACTION_IDS
    assert "Resignation Letter" in DASHBOARD_QUICK_ACTION_IDS


def test_quick_action_tuple_and_literal_stay_in_sync():
    assert set(DASHBOARD_QUICK_ACTION_IDS) == set(get_args(DashboardQuickActionId))


def test_widget_tuple_and_literal_stay_in_sync():
    assert set(DASHBOARD_WIDGET_IDS) == set(get_args(DashboardWidgetId))


def test_dashboard_layout_accepts_workforce_pulse_as_hidden_lower_widget():
    layout = DashboardLayout.model_validate(
        {
            "widgets": [
                {
                    "id": "workforce_pulse",
                    "visible": False,
                    "order": 13,
                    "zone": "under_workspace",
                }
            ],
            "quick_actions": [],
            "canvas_width": "compact",
        }
    )

    assert layout.widgets[0].id == "workforce_pulse"


def test_stale_widget_ids_are_pruned_without_resetting_layout(db_session):
    user = _store_layout(
        db_session,
        {
            "widgets": [
                {"id": widget_id, "visible": False, "order": order, "zone": "under_workspace"}
                for order, widget_id in enumerate(
                    [
                        "recent_docs",
                        "workspace",
                        "email_sync_status",
                        "unknown_widget",
                        "recent_ledger",
                    ]
                )
            ],
            "canvas_width": "wide",
        },
    )
    layout = dashboard_service.get_user_layout(db_session, user.id)
    assert layout is not None
    assert layout.canvas_width == "wide"
    assert [(widget.id, widget.visible, widget.order) for widget in layout.widgets] == [
        ("workspace", False, 1)
    ]


def test_duplicate_widget_ids_are_rejected():
    with pytest.raises(ValidationError, match="Duplicate dashboard widget ids"):
        DashboardLayout.model_validate(
            {"widgets": [{"id": "pending", "order": 0}, {"id": "pending", "order": 1}]}
        )
