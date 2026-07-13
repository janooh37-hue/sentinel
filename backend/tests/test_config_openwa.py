from app.config import Settings


def test_openwa_settings_default_dormant() -> None:
    s = Settings(_env_file=None)
    assert s.openwa_enabled is False
    assert s.openwa_api_base == ""
    assert s.openwa_api_key == ""
    assert s.openwa_session == "default"
    assert s.openwa_country_code == "971"
