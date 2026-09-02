"""Vehicle license and maintenance reminder contracts."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import date, timedelta
from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.db.models import User, UserPermission, Vehicle, VehicleMaintenance, VehicleSite
from app.schemas.vehicle import LicenseRenewCreate
from app.services import (
    scheduler_service,
    settings_service,
    vehicle_reminder_service,
    vehicle_service,
)

_TODAY = date(2026, 9, 2)
_PLATE = "14 \\ 58216"


def _make_user(
    db: Session,
    *,
    email: str,
    status: str = "active",
    can_view_vehicles: bool = False,
) -> User:
    user = User(email=email, password_hash="x", role="operator", status=status)
    db.add(user)
    db.flush()
    if can_view_vehicles:
        db.add(
            UserPermission(
                user_id=user.id,
                capability="vehicles.view",
                effect="grant",
            )
        )
    db.commit()
    return user


def _make_vehicle(db: Session, *, expiry: date) -> Vehicle:
    site = VehicleSite(name_ar="موقع الاختبار", name_en="Test Site")
    db.add(site)
    db.flush()
    vehicle = Vehicle(
        plate_code="14",
        plate_number="58216",
        traffic_code="1180021637",
        type_ar="تويوتا هايس",
        type_en="Toyota Hiace",
        class_ar="باص خفيف",
        class_en="Light bus",
        site_id=site.id,
        license_start=_TODAY - timedelta(days=355),
        license_expiry=expiry,
    )
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return vehicle


def _capture_pushes(
    monkeypatch: pytest.MonkeyPatch,
) -> list[tuple[int, dict[str, tuple[str, str]], str]]:
    pushes: list[tuple[int, dict[str, tuple[str, str]], str]] = []

    def fake_send_to_user(
        _db: Session,
        user_id: int,
        messages: dict[str, tuple[str, str]],
        url: str,
    ) -> None:
        pushes.append((user_id, messages, url))

    monkeypatch.setattr(
        vehicle_reminder_service.push_service,
        "send_to_user",
        fake_send_to_user,
    )
    return pushes


def test_expiring_vehicle_pushes_each_active_view_recipient_once(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings_service.set_vehicle_notify_days(db_session, 30)
    vehicle = _make_vehicle(db_session, expiry=_TODAY + timedelta(days=10))
    recipients = {
        _make_user(
            db_session,
            email="viewer-one@test.ae",
            can_view_vehicles=True,
        ).id,
        _make_user(
            db_session,
            email="viewer-two@test.ae",
            can_view_vehicles=True,
        ).id,
    }
    no_capability = _make_user(db_session, email="operator@test.ae")
    inactive = _make_user(
        db_session,
        email="inactive-viewer@test.ae",
        status="disabled",
        can_view_vehicles=True,
    )
    pushes = _capture_pushes(monkeypatch)

    assert vehicle_reminder_service.send_due_reminders(db_session, today=_TODAY) == 2

    assert {user_id for user_id, _, _ in pushes} == recipients
    assert no_capability.id not in {user_id for user_id, _, _ in pushes}
    assert inactive.id not in {user_id for user_id, _, _ in pushes}
    assert {url for _, _, url in pushes} == {f"/vehicles/{vehicle.id}"}

    expected_messages = {
        "en": (
            "GSSG Manager",
            "License expiring\n"
            f"{_PLATE} · Toyota Hiace expires on {vehicle.license_expiry:%d/%m/%Y}",
        ),
        "ar": (
            "GSSG Manager",
            "ترخيص على وشك الانتهاء\n"
            f"\u2068{_PLATE}\u2069 · تويوتا هايس ينتهي في "
            f"{vehicle.license_expiry:%d/%m/%Y}",
        ),
    }
    assert all(messages == expected_messages for _, messages, _ in pushes)
    db_session.refresh(vehicle)
    assert vehicle.expiry_reminder_sent_for == vehicle.license_expiry

    pushes.clear()
    assert vehicle_reminder_service.send_due_reminders(db_session, today=_TODAY) == 0
    assert pushes == []


def test_renewal_resets_marker_and_new_expiry_can_be_reminded(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings_service.set_vehicle_notify_days(db_session, 30)
    vehicle = _make_vehicle(db_session, expiry=_TODAY + timedelta(days=10))
    recipient = _make_user(
        db_session,
        email="renewal-viewer@test.ae",
        can_view_vehicles=True,
    )
    pushes = _capture_pushes(monkeypatch)

    assert vehicle_reminder_service.send_due_reminders(db_session, today=_TODAY) == 1
    assert [push[0] for push in pushes] == [recipient.id]
    old_expiry = vehicle.license_expiry
    assert vehicle.expiry_reminder_sent_for == old_expiry

    new_start = old_expiry + timedelta(days=1)
    new_expiry = _TODAY + timedelta(days=25)
    vehicle_service.renew_license(
        db_session,
        vehicle.id,
        LicenseRenewCreate(start=new_start, expiry=new_expiry, cost=1450),
        actor="renewal-test@test.ae",
    )
    db_session.refresh(vehicle)
    assert vehicle.license_expiry == new_expiry
    assert vehicle.expiry_reminder_sent_for is None

    pushes.clear()
    assert vehicle_reminder_service.send_due_reminders(db_session, today=_TODAY) == 1
    assert [push[0] for push in pushes] == [recipient.id]
    assert new_expiry.strftime("%d/%m/%Y") in pushes[0][1]["en"][1]
    db_session.refresh(vehicle)
    assert vehicle.expiry_reminder_sent_for == new_expiry


def test_overdue_maintenance_pushes_once_and_marks_next_due(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings_service.set_vehicle_notify_days(db_session, 30)
    vehicle = _make_vehicle(db_session, expiry=_TODAY + timedelta(days=365))
    recipient = _make_user(
        db_session,
        email="maintenance-viewer@test.ae",
        can_view_vehicles=True,
    )
    next_due = _TODAY - timedelta(days=1)
    maintenance = VehicleMaintenance(
        vehicle_id=vehicle.id,
        date=_TODAY - timedelta(days=100),
        type="service",
        cost=500,
        next_due=next_due,
    )
    db_session.add(maintenance)
    db_session.commit()
    pushes = _capture_pushes(monkeypatch)

    assert vehicle_reminder_service.send_due_reminders(db_session, today=_TODAY) == 1

    assert len(pushes) == 1
    user_id, messages, url = pushes[0]
    assert user_id == recipient.id
    assert url == f"/vehicles/{vehicle.id}"
    assert messages["en"][0] == "GSSG Manager"
    assert "overdue" in messages["en"][1].lower()
    assert _PLATE in messages["en"][1]
    assert next_due.strftime("%d/%m/%Y") in messages["en"][1]
    assert messages["ar"][0] == "GSSG Manager"
    assert "متأخر" in messages["ar"][1]
    assert f"\u2068{_PLATE}\u2069" in messages["ar"][1]
    assert next_due.strftime("%d/%m/%Y") in messages["ar"][1]
    db_session.refresh(maintenance)
    assert maintenance.reminder_sent_for == next_due

    pushes.clear()
    assert vehicle_reminder_service.send_due_reminders(db_session, today=_TODAY) == 0
    assert pushes == []


def test_zero_recipients_leaves_marker_retryable_for_a_later_recipient(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings_service.set_vehicle_notify_days(db_session, 30)
    vehicle = _make_vehicle(db_session, expiry=_TODAY + timedelta(days=10))
    pushes = _capture_pushes(monkeypatch)

    assert vehicle_reminder_service.send_due_reminders(db_session, today=_TODAY) == 0
    assert pushes == []
    db_session.refresh(vehicle)
    assert vehicle.expiry_reminder_sent_for is None

    recipient = _make_user(
        db_session,
        email="later-viewer@test.ae",
        can_view_vehicles=True,
    )

    assert vehicle_reminder_service.send_due_reminders(db_session, today=_TODAY) == 1
    assert [push[0] for push in pushes] == [recipient.id]
    db_session.refresh(vehicle)
    assert vehicle.expiry_reminder_sent_for == vehicle.license_expiry


def test_all_failed_pushes_leave_vehicle_and_maintenance_markers_retryable(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings_service.set_vehicle_notify_days(db_session, 30)
    vehicle = _make_vehicle(db_session, expiry=_TODAY + timedelta(days=10))
    recipient = _make_user(
        db_session,
        email="failed-delivery-viewer@test.ae",
        can_view_vehicles=True,
    )
    maintenance = VehicleMaintenance(
        vehicle_id=vehicle.id,
        date=_TODAY - timedelta(days=100),
        type="service",
        cost=500,
        next_due=_TODAY - timedelta(days=1),
    )
    db_session.add(maintenance)
    db_session.commit()
    attempted_urls: list[str] = []

    def fail_send_to_user(
        _db: Session,
        user_id: int,
        _messages: dict[str, tuple[str, str]],
        url: str,
    ) -> None:
        assert user_id == recipient.id
        attempted_urls.append(url)
        raise RuntimeError("push delivery failed")

    monkeypatch.setattr(
        vehicle_reminder_service.push_service,
        "send_to_user",
        fail_send_to_user,
    )

    assert vehicle_reminder_service.send_due_reminders(db_session, today=_TODAY) == 0
    db_session.refresh(vehicle)
    db_session.refresh(maintenance)
    assert vehicle.expiry_reminder_sent_for is None
    assert maintenance.reminder_sent_for is None

    assert vehicle_reminder_service.send_due_reminders(db_session, today=_TODAY) == 0
    assert attempted_urls == [
        f"/vehicles/{vehicle.id}",
        f"/vehicles/{vehicle.id}",
        f"/vehicles/{vehicle.id}",
        f"/vehicles/{vehicle.id}",
    ]
    db_session.refresh(vehicle)
    db_session.refresh(maintenance)
    assert vehicle.expiry_reminder_sent_for is None
    assert maintenance.reminder_sent_for is None


def test_recipient_failure_is_logged_and_does_not_block_marker_or_others(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings_service.set_vehicle_notify_days(db_session, 30)
    vehicle = _make_vehicle(db_session, expiry=_TODAY + timedelta(days=10))
    failing = _make_user(
        db_session,
        email="broken-subscription@test.ae",
        can_view_vehicles=True,
    )
    healthy = _make_user(
        db_session,
        email="healthy-subscription@test.ae",
        can_view_vehicles=True,
    )
    attempted: list[int] = []
    delivered: list[int] = []

    def fake_send_to_user(
        _db: Session,
        user_id: int,
        _messages: dict[str, tuple[str, str]],
        _url: str,
    ) -> None:
        attempted.append(user_id)
        if user_id == failing.id:
            raise RuntimeError("stale push subscription")
        delivered.append(user_id)

    monkeypatch.setattr(
        vehicle_reminder_service.push_service,
        "send_to_user",
        fake_send_to_user,
    )

    with caplog.at_level(logging.ERROR, logger=vehicle_reminder_service.__name__):
        assert vehicle_reminder_service.send_due_reminders(db_session, today=_TODAY) == 1

    assert set(attempted) == {failing.id, healthy.id}
    assert delivered == [healthy.id]
    assert any(
        record.exc_info is not None and str(failing.id) in record.getMessage()
        for record in caplog.records
    )
    db_session.refresh(vehicle)
    assert vehicle.expiry_reminder_sent_for == vehicle.license_expiry

    attempted.clear()
    assert vehicle_reminder_service.send_due_reminders(db_session, today=_TODAY) == 0
    assert attempted == []


def test_scheduler_registers_vehicle_reminders_at_0910_dubai(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs: list[tuple[Callable[..., Any], Any, dict[str, Any]]] = []

    class FakeScheduler:
        def __init__(self, **_kwargs: Any) -> None:
            self.running = False

        def start(self) -> None:
            self.running = True

        def add_job(
            self,
            func: Callable[..., Any],
            *,
            trigger: Any,
            **kwargs: Any,
        ) -> None:
            jobs.append((func, trigger, kwargs))

    monkeypatch.setattr(scheduler_service, "_scheduler", None)
    monkeypatch.setattr(scheduler_service, "_disabled_in_environment", lambda: False)
    monkeypatch.setattr(scheduler_service, "BackgroundScheduler", FakeScheduler)
    monkeypatch.setattr(scheduler_service, "reschedule_email_sync", lambda: None)
    monkeypatch.setattr(scheduler_service, "reschedule_workforce_sync", lambda: None)

    scheduler_service.start()

    matches = [job for job in jobs if job[2].get("id") == "vehicle_reminders"]
    assert len(matches) == 1
    func, trigger, kwargs = matches[0]
    assert func is scheduler_service._run_vehicle_reminders
    assert kwargs["replace_existing"] is True
    cron_fields = {field.name: str(field) for field in trigger.fields}
    assert cron_fields["hour"] == "9"
    assert cron_fields["minute"] == "10"
    assert str(trigger.timezone) == "Asia/Dubai"
