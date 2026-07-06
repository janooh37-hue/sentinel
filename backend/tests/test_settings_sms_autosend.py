from app.schemas.settings import AppSettingsUpdate
from app.services import settings_service as ss


def test_autosend_defaults_true(db_session):
    assert ss.get_settings(db_session).sms_autosend_enabled is True


def test_autosend_toggle_roundtrip(db_session):
    ss.update_settings(db_session, AppSettingsUpdate(sms_autosend_enabled=False))
    assert ss.get_settings(db_session).sms_autosend_enabled is False
    ss.update_settings(db_session, AppSettingsUpdate(sms_autosend_enabled=True))
    assert ss.get_settings(db_session).sms_autosend_enabled is True
