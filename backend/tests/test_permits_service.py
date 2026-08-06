"""Service-level tests for the security-permit register (feature 2026-07)."""

from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

from app.api.errors import NotFoundError, ValidationFailedError
from app.db.models import AuditLog, BookCategory, Permit
from app.schemas.permit import (
    PermitCreate,
    PermitPersonCreate,
    PermitUpdate,
    PermitValidityPeriod,
    PermitVehicleCreate,
    PermitVehicleUpdate,
    PermitVisitCreate,
)
from app.services import document_service
from app.services import permit_service as svc

TODAY = date.today()


@pytest.fixture(autouse=True)
def _permit_docgen(db_session, tmp_path, monkeypatch):
    """Stub document_service so create_permit (which now generates a book) works
    in the test env without Word COM or a real data dir."""
    from app.config import Settings

    monkeypatch.setattr(
        document_service, "get_settings", lambda: Settings(data_dir=tmp_path / "data")
    )
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    if db_session.get(BookCategory, "GS") is None:
        db_session.add(BookCategory(id="GS", prefix="GS"))
        db_session.commit()


def _person(name, uae_id="784-1000-1000000-1", **kw):
    return PermitPersonCreate(name=name, uae_id=uae_id, **kw)


def _mk(db, **over):
    # A permit requires ≥1 person (with a UAE ID), so default to one.
    start = over.pop("start_date", TODAY)
    end = over.pop("end_date", None)
    validity = over.pop("validity", None)
    if validity is None:
        end = end or start + timedelta(days=30)
        validity = {"value": (end - start).days + 1, "unit": "day"}
    payload = PermitCreate(
        company=over.pop("company", "Acme Contracting"),
        access_areas=over.pop(
            "access_areas",
            {"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
        ),
        start_date=start,
        validity=validity,
        purpose=over.pop("purpose", None),
        people=over.pop("people", [_person("Worker")]),
    )
    return svc.create_permit(db, payload, actor="tester@x.ae")


def test_create_stamps_permit_no_and_defaults(db_session):
    row = _mk(db_session)
    assert row.permit_no == f"PMT-{row.id:04d}"
    assert row.status == "active"
    read = svc.to_read(row)
    assert read.duration_days == 31
    assert read.derived_status == "active"
    assert read.people_count == 1  # the default person
def test_create_persists_access_and_derives_zone_union(db_session):
    row = _mk(
        db_session,
        access_areas={
            "al_wathba_1": ["green", "red"],
            "al_wathba_2": ["green"],
            "work_residence": True,
        },
    )
    read = svc.to_read(row)
    assert read.access_areas is not None
    assert read.access_areas.al_wathba_1 == ["green", "red"]
    assert read.access_areas.al_wathba_2 == ["green"]
    assert read.zones == ["green", "red", "work_residence"]


def test_update_replaces_access_and_recomputes_union(db_session):
    row = _mk(db_session)
    updated = svc.update_permit(
        db_session,
        row.id,
        PermitUpdate(
            access_areas={
                "al_wathba_1": [],
                "al_wathba_2": ["red"],
                "work_residence": False,
            }
        ),
    )
    assert updated.access_areas == {
        "al_wathba_1": [],
        "al_wathba_2": ["red"],
        "work_residence": False,
    }
    assert updated.zones == ["red"]


def test_legacy_permit_keeps_flat_zones_and_null_access(db_session):
    row = Permit(
        company="Legacy",
        zones=["green", "work_residence"],
        access_areas=None,
        start_date=TODAY,
        validity_value=11,
        validity_unit="day",
        end_date=TODAY + timedelta(days=10),
    )
    db_session.add(row)
    db_session.commit()
    read = svc.to_read(row)
    assert read.access_areas is None
    assert read.zones == ["green", "work_residence"]


def test_create_requires_at_least_one_person(db_session):
    with pytest.raises(ValidationFailedError):
        svc.create_permit(
            db_session,
            PermitCreate(
                company="X",
                access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
                start_date=TODAY,
                validity={"value": 6, "unit": "day"},
                people=[],
            ),
        )


def test_vehicle_plate_is_optional(db_session):
    row = _mk(db_session)
    row = svc.add_vehicle(db_session, row.id, PermitVehicleCreate(make_model="Toyota Hilux"))
    v = svc.to_read(row).vehicles[0]
    assert v.plate_no is None
    assert v.make_model == "Toyota Hilux"


def test_person_requires_uae_id():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PermitPersonCreate(name="No Id")


def test_permit_requires_at_least_one_access_area():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PermitCreate(
            company="X",
            access_areas={"al_wathba_1": [], "al_wathba_2": [], "work_residence": False},
            start_date=TODAY,
            validity={"value": 4, "unit": "day"},
            people=[_person("A")],
        )


def test_zones_are_multi_and_deduped(db_session):
    row = _mk(
        db_session,
        access_areas={
            "al_wathba_1": ["green", "red", "green"],
            "al_wathba_2": [],
            "work_residence": True,
        },
    )
    assert svc.to_read(row).zones == ["green", "red", "work_residence"]


def test_work_residence_filter_and_summary(db_session):
    _mk(
        db_session,
        access_areas={"al_wathba_1": [], "al_wathba_2": [], "work_residence": True},
        people=[_person("A"), _person("B")],
    )
    _mk(
        db_session,
        access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
        people=[_person("C")],
    )
    _, total = svc.list_permits(db_session, zone="work_residence")
    assert total == 1
    s = svc.summary(db_session)
    assert s["people_work_residence"] == 2
    assert s["people_green"] == 1


def test_create_with_people_counts_active(db_session):
    row = _mk(
        db_session,
        people=[
            PermitPersonCreate(name="Ali", uae_id="784-1990-1", role="Welder"),
            _person("Bilal"),
        ],
    )
    read = svc.to_read(row)
    assert read.people_count == 2
    assert {p.name for p in read.people} == {"Ali", "Bilal"}


def test_invalid_validity_rejected():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PermitCreate(
            company="X",
            access_areas={"al_wathba_1": [], "al_wathba_2": ["red"], "work_residence": False},
            start_date=TODAY,
            validity={"value": 0, "unit": "day"},
            people=[_person("A")],
        )


def test_derived_status_expiring_and_expired(db_session):
    expiring = _mk(db_session, end_date=TODAY + timedelta(days=3))
    expired = _mk(
        db_session, start_date=TODAY - timedelta(days=40), end_date=TODAY - timedelta(days=1)
    )
    assert svc.to_list_item(expiring).derived_status == "expiring"
    assert svc.to_list_item(expired).derived_status == "expired"


def test_renew_extends_by_period(db_session):
    row = _mk(db_session, start_date=TODAY, validity={"value": 11, "unit": "day"})
    old_end = row.end_date
    renewed = svc.renew_permit(
        db_session, row.id, validity=PermitValidityPeriod(value=1, unit="month")
    )
    assert renewed.start_date == old_end + timedelta(days=1)
    assert renewed.end_date > renewed.start_date


def test_create_persists_validity_and_derives_end(db_session) -> None:
    row = _mk(
        db_session,
        start_date=date(2026, 7, 1),
        validity={"value": 1, "unit": "month"},
    )
    assert row.validity_value == 1
    assert row.validity_unit == "month"
    assert row.end_date == date(2026, 7, 31)


def test_update_start_or_validity_recomputes_end(db_session) -> None:
    row = _mk(db_session)
    updated = svc.update_permit(
        db_session,
        row.id,
        PermitUpdate(
            start_date=date(2026, 8, 6),
            validity={"value": 6, "unit": "month"},
        ),
    )
    assert updated.start_date == date(2026, 8, 6)
    assert updated.validity_value == 6
    assert updated.validity_unit == "month"
    assert updated.end_date == date(2027, 2, 5)


def test_renew_active_starts_after_current_end(db_session, monkeypatch) -> None:
    monkeypatch.setattr(svc, "_today", lambda: date(2026, 8, 6))
    row = _mk(
        db_session,
        start_date=date(2026, 8, 1),
        validity={"value": 31, "unit": "day"},
    )
    renewed = svc.renew_permit(
        db_session, row.id, validity=PermitValidityPeriod(value=1, unit="month")
    )
    assert renewed.start_date == date(2026, 9, 1)
    assert renewed.end_date == date(2026, 9, 30)


def test_renew_expired_starts_today(db_session, monkeypatch) -> None:
    monkeypatch.setattr(svc, "_today", lambda: date(2026, 8, 6))
    row = _mk(
        db_session,
        start_date=date(2026, 1, 1),
        validity={"value": 31, "unit": "day"},
    )
    renewed = svc.renew_permit(
        db_session, row.id, validity=PermitValidityPeriod(value=1, unit="week")
    )
    assert renewed.start_date == date(2026, 8, 6)
    assert renewed.end_date == date(2026, 8, 12)

def test_revoke_then_blocks_edits(db_session):
    row = _mk(db_session)
    revoked = svc.revoke_permit(db_session, row.id, reason="site closed")
    assert revoked.status == "revoked"
    assert svc.to_read(revoked).derived_status == "revoked"
    with pytest.raises(ValidationFailedError):
        svc.update_permit(db_session, row.id, PermitUpdate(company="New"))
    with pytest.raises(ValidationFailedError):
        svc.revoke_permit(db_session, row.id)


def test_add_and_remove_person(db_session):
    row = _mk(db_session)  # starts with 1 default person
    svc.add_person(db_session, row.id, _person("Ali"))
    row = svc.add_person(db_session, row.id, _person("Bilal"))
    assert svc.to_read(row).people_count == 3
    pid = svc.to_read(row).people[0].id
    row = svc.remove_person(db_session, row.id, pid)
    read = svc.to_read(row)
    assert read.people_count == 2  # soft-removed person no longer counted


def test_remove_missing_person_404(db_session):
    row = _mk(db_session)
    with pytest.raises(NotFoundError):
        svc.remove_person(db_session, row.id, 9999)


def test_list_filters_by_state_and_zone(db_session):
    _mk(
        db_session,
        access_areas={"al_wathba_1": [], "al_wathba_2": ["red"], "work_residence": False},
        end_date=TODAY + timedelta(days=30),
    )
    _mk(
        db_session,
        access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
        end_date=TODAY + timedelta(days=2),
    )  # expiring
    rows, total = svc.list_permits(db_session, state="expiring")
    assert total == 1
    rows, total = svc.list_permits(db_session, zone="red")
    assert total == 1 and "red" in rows[0].zones


def test_soft_delete_hides_from_list(db_session):
    row = _mk(db_session)
    svc.soft_delete_permit(db_session, row.id)
    _, total = svc.list_permits(db_session)
    assert total == 0
    with pytest.raises(NotFoundError):
        svc.get_permit(db_session, row.id)


def test_summary_headcount_by_derived_zone_union(db_session):
    _mk(
        db_session,
        access_areas={
            "al_wathba_1": ["green"],
            "al_wathba_2": ["green", "red"],
            "work_residence": False,
        },
        people=[_person("A"), _person("B")],
    )
    _mk(
        db_session,
        access_areas={
            "al_wathba_1": [],
            "al_wathba_2": ["red"],
            "work_residence": False,
        },
        people=[_person("C")],
    )
    summary = svc.summary(db_session)
    assert summary["people_green"] == 2
    assert summary["people_red"] == 3


def test_record_visit_hook(db_session):
    row = _mk(db_session)
    visit = svc.record_visit(
        db_session,
        row.id,
        PermitVisitCreate(direction="in", uae_id="784-1", gate="Gate 3", source="gate"),
    )
    assert visit.direction == "in" and visit.source == "gate"
    assert len(svc.list_visits(db_session, row.id)) == 1


def test_attach_and_fetch_document(db_session, tmp_path, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "data_dir", tmp_path)
    row = _mk(db_session)
    updated = svc.attach_document(db_session, row.id, "issued permit.pdf", b"%PDF-1.4 fake")
    assert updated.document_path
    assert svc.to_read(updated).document_name == "issued permit.pdf"
    assert svc.to_list_item(updated).has_document is True
    # File is readable back.
    path = svc.get_document_file(db_session, row.id)
    assert path.read_bytes() == b"%PDF-1.4 fake"
    # Remove clears it.
    cleared = svc.remove_document(db_session, row.id)
    assert cleared.document_path is None
    with pytest.raises(NotFoundError):
        svc.get_document_file(db_session, row.id)


def test_attach_document_rejects_empty(db_session, tmp_path, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "data_dir", tmp_path)
    row = _mk(db_session)
    with pytest.raises(ValidationFailedError):
        svc.attach_document(db_session, row.id, "x.pdf", b"")


def test_create_with_vehicles_counts_active(db_session):
    row = svc.create_permit(
        db_session,
        PermitCreate(
            company="X",
            access_areas={"al_wathba_1": ["green", "red"], "al_wathba_2": [], "work_residence": False},
            start_date=TODAY,
            validity={"value": 11, "unit": "day"},
            people=[_person("Driver")],
            vehicles=[
                PermitVehicleCreate(
                    plate_no="A 12345", plate_emirate="Dubai", make_model="Toyota Hilux"
                ),
                PermitVehicleCreate(plate_no="B 67890"),
            ],
        ),
    )
    read = svc.to_read(row)
    assert read.vehicle_count == 2
    assert svc.to_list_item(row).vehicle_count == 2
    assert {v.plate_no for v in read.vehicles} == {"A 12345", "B 67890"}


def test_add_and_remove_vehicle(db_session):
    row = _mk(db_session)
    row = svc.add_vehicle(db_session, row.id, PermitVehicleCreate(plate_no="C 111"))
    assert svc.to_read(row).vehicle_count == 1
    vid = svc.to_read(row).vehicles[0].id
    row = svc.remove_vehicle(db_session, row.id, vid)
    assert svc.to_read(row).vehicle_count == 0
    with pytest.raises(NotFoundError):
        svc.remove_vehicle(db_session, row.id, 9999)


def test_update_vehicle_sets_emirate(db_session):
    row = _mk(db_session)
    row = svc.add_vehicle(db_session, row.id, PermitVehicleCreate(plate_no="C 111"))
    vid = svc.to_read(row).vehicles[0].id
    row = svc.update_vehicle(db_session, row.id, vid, PermitVehicleUpdate(plate_emirate="دبي"))
    v = svc.to_read(row).vehicles[0]
    assert v.plate_emirate == "دبي"
    # A partial patch must leave the fields it didn't set untouched.
    assert v.plate_no == "C 111"


def test_update_vehicle_unknown_id_raises(db_session):
    row = _mk(db_session)
    with pytest.raises(NotFoundError):
        svc.update_vehicle(db_session, row.id, 9999, PermitVehicleUpdate(plate_emirate="دبي"))


def test_attach_person_and_vehicle_documents(db_session, tmp_path, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "data_dir", tmp_path)
    row = svc.create_permit(
        db_session,
        PermitCreate(
            company="X",
            access_areas={"al_wathba_1": [], "al_wathba_2": ["red"], "work_residence": False},
            start_date=TODAY,
            validity={"value": 11, "unit": "day"},
            people=[_person("Ali")],
            vehicles=[PermitVehicleCreate(plate_no="A 1")],
        ),
    )
    pid = svc.to_read(row).people[0].id
    vid = svc.to_read(row).vehicles[0].id

    row = svc.attach_person_document(db_session, row.id, pid, "uae-id.jpg", b"\xff\xd8ID")
    assert svc.to_read(row).people[0].id_doc_name == "uae-id.jpg"
    assert svc.get_person_document_file(db_session, row.id, pid).read_bytes() == b"\xff\xd8ID"

    row = svc.attach_vehicle_document(db_session, row.id, vid, "mulkiya.pdf", b"%PDF-lic")
    assert svc.to_read(row).vehicles[0].license_doc_name == "mulkiya.pdf"
    assert svc.get_vehicle_document_file(db_session, row.id, vid).read_bytes() == b"%PDF-lic"

    # Unknown ids raise.
    with pytest.raises(NotFoundError):
        svc.attach_person_document(db_session, row.id, 9999, "x.jpg", b"x")


def test_safe_filename_strips_traversal_and_bidi():
    assert "/" not in svc._safe_filename("../../etc/passwd")
    assert svc._safe_filename("   ") == "permit"


def test_mutations_write_audit_rows(db_session):
    row = _mk(db_session)
    svc.renew_permit(
        db_session, row.id, validity=PermitValidityPeriod(value=3, unit="month")
    )
    actions = {a.action for a in db_session.query(AuditLog).all()}
    assert "permit.created" in actions
    assert "permit.renewed" in actions


def test_access_update_audit_lists_access_areas_field(db_session):
    row = _mk(db_session)
    svc.update_permit(
        db_session,
        row.id,
        PermitUpdate(
            access_areas={
                "al_wathba_1": [],
                "al_wathba_2": ["red"],
                "work_residence": False,
            }
        ),
    )
    audit = (
        db_session.query(AuditLog)
        .filter_by(action="permit.updated", entity_id=str(row.id))
        .order_by(AuditLog.id.desc())
        .first()
    )
    assert audit is not None
    assert json.loads(audit.payload)["fields"] == ["access_areas"]
