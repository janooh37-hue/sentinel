"""Typed settings schemas — wraps the app_settings key-value table."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AppSettingsRead(BaseModel):
    stamp_style: str
    default_manager_id: int | None
    manager_hand_sign_default: bool
    theme: Literal["light", "dark"]
    language: Literal["en", "ar"]
    font_scale: int = Field(
        ge=16, le=24
    )  # was Literal["sm","md","lg"] before Phase 17; widened to 16..24 in Phase 18 (client snaps to discrete stops)
    # Legacy signature slots — preserved verbatim; consumed by doc gen pipeline.
    sig_personnel_path: str | None
    sig_admin_path: str | None
    legacy_signature_path: str | None
    # Read-only — toggled via POST /system/admin-key, not via PATCH /settings.
    admin_gate_enabled: bool
    # Observability opt-in (off by default; actual SDK integration is Phase 10+).
    sentry_opt_in: bool
    # Master on/off switch for SMS auto-send (on by default).
    sms_autosend_enabled: bool
    # HTML signature appended to outgoing email when use_signature=True.
    email_signature: str
    # Global signature appearance (key-value; no migration). Boldness 0..3.
    signature_size_mm: int
    signature_boldness: int


class AppSettingsUpdate(BaseModel):
    """PATCH semantics — every field is optional."""

    stamp_style: str | None = None
    default_manager_id: int | None = None
    manager_hand_sign_default: bool | None = None
    theme: Literal["light", "dark"] | None = None
    language: Literal["en", "ar"] | None = None
    font_scale: int | None = Field(
        default=None, ge=16, le=24
    )  # was Literal["sm","md","lg"] before Phase 17; widened to 16..24 in Phase 18 (client snaps to discrete stops)
    sig_personnel_path: str | None = None
    sig_admin_path: str | None = None
    legacy_signature_path: str | None = None
    sentry_opt_in: bool | None = None
    sms_autosend_enabled: bool | None = None
    email_signature: str | None = None
    signature_size_mm: int | None = None
    signature_boldness: int | None = None
