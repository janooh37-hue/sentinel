"""Runtime configuration loaded from environment / .env."""

from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _bundle_root() -> Path:
    """Return the root of the bundled assets tree.

    * PyInstaller frozen build → ``sys._MEIPASS`` (the extraction dir).
    * Source layout → project root (two levels up from this file).
    """
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return PROJECT_ROOT


def _default_templates_dir() -> Path:
    """Resolve the templates directory for both frozen and source layouts.

    Frozen layout (PyInstaller): ``_MEIPASS/templates/``
    Source layout: ``<project_root>/backend/templates/``
    """
    root = _bundle_root()
    # Frozen: post_build places templates directly under _MEIPASS/templates/
    frozen_candidate = root / "templates"
    if getattr(sys, "frozen", False) and frozen_candidate.is_dir():
        return frozen_candidate
    return root / "backend" / "templates"


class Settings(BaseSettings):
    """Application settings.

    Resolved from environment variables prefixed with ``GSSG_``, plus an
    optional ``.env`` file at the project root.
    """

    model_config = SettingsConfigDict(
        env_prefix="GSSG_",
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    data_dir: Path = Field(default_factory=lambda: PROJECT_ROOT / "data")
    host: str = "127.0.0.1"  # GSSG_HOST — bind address; serve.py sets "0.0.0.0" for LAN
    templates_dir: Path = Field(default_factory=_default_templates_dir)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    dev_mode: bool = False
    port: int = 0  # 0 → probe a free port at startup
    # Flip to True when a TLS terminator (Caddy) is in front so the session
    # cookie carries the Secure flag. Leave False for plain LAN-HTTP dev.
    # Set via env: GSSG_SECURE_COOKIES=1
    secure_cookies: bool = False

    # --- WhatsApp Business Cloud API (employee notifications) ----------------
    # All GSSG_WHATSAPP_* env vars. Disabled by default so the "Send" button is
    # hidden until an operator provisions a token + phone-number-id.
    whatsapp_enabled: bool = False
    whatsapp_token: str = ""              # Meta permanent access token (secret)
    whatsapp_phone_number_id: str = ""    # the WhatsApp Business phone-number id
    whatsapp_api_base: str = "https://graph.facebook.com/v21.0"
    whatsapp_country_code: str = "971"    # default CC for normalizing contact

    @property
    def db_path(self) -> Path:
        return self.data_dir / "gssg.db"

    @property
    def vault_dir(self) -> Path:
        return self.data_dir / "vault"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.vault_dir, self.logs_dir):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached singleton accessor — safe to call from anywhere."""
    settings = Settings()
    settings.ensure_dirs()
    return settings
