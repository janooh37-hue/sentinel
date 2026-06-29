from app.config import Settings


def test_whatsapp_defaults_are_disabled_and_safe():
    s = Settings()
    assert s.whatsapp_enabled is False
    assert s.whatsapp_token == ""
    assert s.whatsapp_api_base == ""        # Infobip base URL is per-account; no default
    assert s.whatsapp_sender == ""
    assert s.whatsapp_country_code == "971"


def test_whatsapp_env_override(monkeypatch):
    monkeypatch.setenv("GSSG_WHATSAPP_ENABLED", "1")
    monkeypatch.setenv("GSSG_WHATSAPP_TOKEN", "tok123")
    monkeypatch.setenv("GSSG_WHATSAPP_API_BASE", "https://abc.api.infobip.com")
    monkeypatch.setenv("GSSG_WHATSAPP_SENDER", "447860099299")
    s = Settings()
    assert s.whatsapp_enabled is True
    assert s.whatsapp_token == "tok123"
    assert s.whatsapp_api_base == "https://abc.api.infobip.com"
    assert s.whatsapp_sender == "447860099299"
