"""Dashboard layout schema and tolerant per-user read contracts."""

from __future__ import annotations

from typing import get_args

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.deps import get_current_user
from app.db.models import User, UserDashboardLayout
from app.db.session import get_db
from app.main import create_app
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


def test_pre_zone_layout_keeps_legacy_role_for_frontend_migration(db_session):
    user = _store_layout(db_session, {"widgets": [{"id": "pending", "order": 4, "visible": False}]})
    layout = dashboard_service.get_user_layout(db_session, user.id)
    assert layout is not None
    assert layout.widgets[0].size == "M"
    assert layout.widgets[0].zone == "top"


def test_legacy_permits_panel_reads_as_extra_large_and_xl_round_trips(db_session):
    user = _store_layout(
        db_session,
        {
            "widgets": [
                {"id": "permits", "order": 0, "visible": True, "zone": "under_quick_actions"},
                {"id": "on_leave_today", "order": 1, "visible": True, "zone": "under_workspace"},
            ]
        },
    )
    layout = dashboard_service.get_user_layout(db_session, user.id)
    assert layout is not None
    assert [(w.id, w.size) for w in layout.widgets] == [("permits", "XL"), ("on_leave_today", "L")]
    saved = DashboardLayout.model_validate(
        {"widgets": [{"id": "permits", "order": 0, "visible": True, "size": "XL"}]}
    )
    assert saved.widgets[0].size == "XL"


@pytest.mark.parametrize(
    ("widgets", "expected_widgets"),
    [
        pytest.param([], [], id="empty-legacy"),
        pytest.param(
            [
                {"id": "recent_docs", "visible": True, "order": 0, "zone": "under_workspace"},
                {"id": "recent_ledger", "visible": True, "order": 1, "zone": "under_workspace"},
                {"id": "email_sync_status", "visible": True, "order": 2, "zone": "top"},
            ],
            [],
            id="all-retired-legacy",
        ),
        pytest.param(
            [{"id": "unknown_widget", "visible": True, "order": 0}],
            [],
            id="all-unknown-legacy",
        ),
        pytest.param(
            [
                {"id": "recent_docs", "visible": True, "order": 0},
                {"id": "quick_actions", "visible": False, "order": 1, "size": "W"},
            ],
            [{"id": "quick_actions", "visible": False, "order": 1, "size": "W"}],
            id="hidden-v2-actions",
        ),
    ],
)
def test_layout_read_serializes_legacy_and_v2_shapes_for_frontend(
    api_db, widgets, expected_widgets
):
    user = _store_layout(
        api_db,
        {
            "widgets": widgets,
            "quick_actions": [
                {"id": "Report", "visible": True, "order": 0},
                {"id": "General Book", "visible": False, "order": 1},
            ],
            "canvas_width": "wide",
        },
    )
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user

    response = TestClient(app).get("/api/v1/dashboard/layout")

    assert response.status_code == 200, response.text
    # These exact response shapes are exercised by resolveLayout's regression tests.
    assert response.json() == {
        "widgets": expected_widgets,
        "quick_actions": [
            {"id": "Report", "visible": True, "order": 0},
            {"id": "General Book", "visible": False, "order": 1},
        ],
        "canvas_width": "wide",
    }
