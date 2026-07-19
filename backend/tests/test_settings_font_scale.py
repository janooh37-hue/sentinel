"""Fresh-install regression: migration-era font_scale=15 must not 500 GET /settings."""

from sqlalchemy.orm import Session

from app.services import settings_service
from app.services.settings_service import _set


def test_font_scale_below_floor_is_clamped(db_session: Session) -> None:
    """Migration 0007 seeded settings.font_scale=15; AppSettingsRead requires >=16.
    A fresh install must not 500 on GET /settings (2026-07-19 sandbox audit)."""
    _set(db_session, "settings.font_scale", 15)
    db_session.commit()
    out = settings_service.get_settings(db_session)
    assert out.font_scale >= 16
