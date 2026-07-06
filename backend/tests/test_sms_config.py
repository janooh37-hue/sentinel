def test_sms_settings_load_from_env(monkeypatch):
    monkeypatch.setenv("GSSG_SMS_ENABLED", "1")
    monkeypatch.setenv("GSSG_SMS_GATEWAY_URL", "http://192.168.1.50:8080")
    monkeypatch.setenv("GSSG_SMS_USERNAME", "user")
    monkeypatch.setenv("GSSG_SMS_PASSWORD", "pass")
    monkeypatch.setenv("GSSG_SMS_COUNTRY_CODE", "971")
    from app.config import get_settings

    get_settings.cache_clear()
    cfg = get_settings()
    assert cfg.sms_enabled is True
    assert cfg.sms_gateway_url == "http://192.168.1.50:8080"
    assert cfg.sms_username == "user"
    assert cfg.sms_password == "pass"
    assert cfg.sms_country_code == "971"
    get_settings.cache_clear()


def test_sms_disabled_by_default(monkeypatch):
    for k in ("GSSG_SMS_ENABLED", "GSSG_SMS_GATEWAY_URL", "GSSG_SMS_USERNAME", "GSSG_SMS_PASSWORD"):
        monkeypatch.delenv(k, raising=False)
    from app.config import Settings

    cfg = Settings(_env_file=None)  # ignore the live .env; assert true defaults
    assert cfg.sms_enabled is False
    assert cfg.sms_country_code == "971"
