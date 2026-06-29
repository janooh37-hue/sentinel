from app.config import Settings


def test_whatsapp_defaults_are_disabled_and_safe():
    s = Settings()
    assert s.whatsapp_enabled is False
    assert s.whatsapp_token == ""
    assert s.whatsapp_phone_number_id == ""
    assert s.whatsapp_api_base == "https://graph.facebook.com/v21.0"
    assert s.whatsapp_country_code == "971"


def test_whatsapp_env_override(monkeypatch):
    monkeypatch.setenv("GSSG_WHATSAPP_ENABLED", "1")
    monkeypatch.setenv("GSSG_WHATSAPP_TOKEN", "tok123")
    monkeypatch.setenv("GSSG_WHATSAPP_PHONE_NUMBER_ID", "55500011122")
    s = Settings()
    assert s.whatsapp_enabled is True
    assert s.whatsapp_token == "tok123"
    assert s.whatsapp_phone_number_id == "55500011122"
