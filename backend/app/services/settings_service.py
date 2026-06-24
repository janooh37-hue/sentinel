"""Settings service — typed read/write over the app_settings key-value table.

Each logical setting is stored under a key like ``settings.theme``. Missing
keys fall back to module-level defaults so a fresh install works without any
seed migration having run first.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import STAMP_STYLE_HEADER
from app.db.models import AppSetting
from app.schemas.settings import AppSettingsRead, AppSettingsUpdate, DashboardLayout

# Well-known key for the singleton row that owns the dashboard_layout JSON
# column. The column is nullable and only populated on this one row; all
# other settings continue to use the (key, value) text pattern.
_DASHBOARD_LAYOUT_KEY = "settings.dashboard_layout"

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

_DEFAULTS: dict[str, object] = {
    "settings.stamp_style": STAMP_STYLE_HEADER,
    "settings.theme": "light",
    "settings.language": "en",
    "settings.font_scale": 16,
    "settings.manager_hand_sign_default": False,
    "settings.default_manager_id": None,
    "settings.sig_personnel_path": None,
    "settings.sig_admin_path": None,
    "settings.legacy_signature_path": None,
    "settings.sentry_opt_in": False,
    "settings.signature_size_mm": 45,
    "settings.signature_boldness": 1,
}

# ---------------------------------------------------------------------------
# Admin-gate (soft file-existence gate, matches v3 behaviour)
# ---------------------------------------------------------------------------

_ADMIN_KEY_ENV = "GSSG_ADMIN_KEY_PATH"


def _admin_key_path() -> Path:
    """Return path to the admin-key file.

    Override via ``GSSG_ADMIN_KEY_PATH`` env var (used in tests to avoid
    touching ``%USERPROFILE%``).
    """
    override = os.environ.get(_ADMIN_KEY_ENV)
    if override:
        return Path(override)
    return Path.home() / ".gssg_admin_key"


def is_admin_gate_enabled() -> bool:
    """True if the admin-key file exists."""
    return _admin_key_path().exists()


def set_admin_gate(enabled: bool) -> bool:
    """Write (enabled=True) or delete (enabled=False) the admin-key file.

    Returns the new state.
    """
    path = _admin_key_path()
    if enabled:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("")
    else:
        path.unlink(missing_ok=True)
    return path.exists()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get(db: Session, key: str, default: object = None) -> object:
    row = db.execute(select(AppSetting).where(AppSetting.key == key)).scalar_one_or_none()
    if row is None:
        return default
    return json.loads(row.value)


def _set(db: Session, key: str, value: object) -> None:
    existing = db.execute(select(AppSetting).where(AppSetting.key == key)).scalar_one_or_none()
    encoded = json.dumps(value)
    if existing is None:
        db.add(AppSetting(key=key, value=encoded))
    else:
        existing.value = encoded


def _get_dashboard_layout(db: Session) -> DashboardLayout | None:
    """Read the dashboard layout from the JSON column on the singleton row.

    Returns ``None`` when either the row doesn't exist or the column is NULL —
    in both cases the frontend falls back to its built-in defaults.
    """
    row = db.execute(
        select(AppSetting).where(AppSetting.key == _DASHBOARD_LAYOUT_KEY)
    ).scalar_one_or_none()
    if row is None or row.dashboard_layout is None:
        return None
    # Already a dict thanks to the JSON column; let pydantic validate the shape.
    return DashboardLayout.model_validate(row.dashboard_layout)


def _set_dashboard_layout(db: Session, layout: DashboardLayout | None) -> None:
    """Write the dashboard layout to the JSON column on the singleton row.

    Passing ``None`` resets to "use defaults". The row's ``value`` column is
    kept as JSON-encoded ``null`` purely to satisfy the NOT-NULL Text column —
    the real payload lives on ``dashboard_layout``.
    """
    payload = layout.model_dump(mode="json") if layout is not None else None
    row = db.execute(
        select(AppSetting).where(AppSetting.key == _DASHBOARD_LAYOUT_KEY)
    ).scalar_one_or_none()
    if row is None:
        db.add(
            AppSetting(
                key=_DASHBOARD_LAYOUT_KEY,
                value=json.dumps(None),
                dashboard_layout=payload,
            )
        )
    else:
        row.dashboard_layout = payload


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_settings(db: Session) -> AppSettingsRead:
    """Read all settings from DB, falling back to defaults for missing keys."""
    sentry_opt_in = bool(_get(db, "settings.sentry_opt_in", False))
    if sentry_opt_in:
        log.info("Sentry would initialize here — actual SDK integration is Phase 10+.")
    raw: dict[str, object] = {
        "stamp_style": _get(db, "settings.stamp_style", _DEFAULTS["settings.stamp_style"]),
        "default_manager_id": _get(db, "settings.default_manager_id", None),
        "manager_hand_sign_default": _get(
            db, "settings.manager_hand_sign_default", _DEFAULTS["settings.manager_hand_sign_default"]
        ),
        "theme": _get(db, "settings.theme", _DEFAULTS["settings.theme"]),
        "language": _get(db, "settings.language", _DEFAULTS["settings.language"]),
        "font_scale": _get(db, "settings.font_scale", _DEFAULTS["settings.font_scale"]),
        "sig_personnel_path": _get(db, "settings.sig_personnel_path", None),
        "sig_admin_path": _get(db, "settings.sig_admin_path", None),
        "legacy_signature_path": _get(db, "settings.legacy_signature_path", None),
        "admin_gate_enabled": is_admin_gate_enabled(),
        "sentry_opt_in": sentry_opt_in,
        "email_signature": _get(db, "settings.email_signature", "") or "",
        "signature_size_mm": _get(
            db, "settings.signature_size_mm", _DEFAULTS["settings.signature_size_mm"]
        ),
        "signature_boldness": _get(
            db, "settings.signature_boldness", _DEFAULTS["settings.signature_boldness"]
        ),
        "dashboard_layout": _get_dashboard_layout(db),
    }
    return AppSettingsRead.model_validate(raw)


def update_settings(db: Session, payload: AppSettingsUpdate) -> AppSettingsRead:
    """Upsert only the non-None fields in *payload*, then return the full state."""
    from app.core.signature_render import clamp_boldness, clamp_size

    if "signature_size_mm" in payload.model_fields_set and payload.signature_size_mm is not None:
        _set(db, "settings.signature_size_mm", clamp_size(payload.signature_size_mm))
    if "signature_boldness" in payload.model_fields_set and payload.signature_boldness is not None:
        _set(db, "settings.signature_boldness", clamp_boldness(payload.signature_boldness))
    mapping = {
        "stamp_style": "settings.stamp_style",
        "default_manager_id": "settings.default_manager_id",
        "manager_hand_sign_default": "settings.manager_hand_sign_default",
        "theme": "settings.theme",
        "language": "settings.language",
        "font_scale": "settings.font_scale",
        "sig_personnel_path": "settings.sig_personnel_path",
        "sig_admin_path": "settings.sig_admin_path",
        "legacy_signature_path": "settings.legacy_signature_path",
        "sentry_opt_in": "settings.sentry_opt_in",
        "email_signature": "settings.email_signature",
    }
    # Use model_fields_set to distinguish "explicitly set to null" from "not provided"
    for field, key in mapping.items():
        if field in payload.model_fields_set:
            _set(db, key, getattr(payload, field))
    if "dashboard_layout" in payload.model_fields_set:
        _set_dashboard_layout(db, payload.dashboard_layout)
    db.commit()
    return get_settings(db)
