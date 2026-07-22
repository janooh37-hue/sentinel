"""Service-level tests for the security-permit register (feature 2026-07)."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.api.errors import NotFoundError, ValidationFailedError
from app.db.models import AuditLog, BookCategory
from app.schemas.permit import (
    PermitCreate,
    PermitPersonCreate,
    PermitUpdate,
    PermitVehicleCreate,
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
    payload = PermitCreate(
        company=over.pop("company", "Acme Contracting"),
        zones=over.pop("zones", ["green"]),
        start_date=over.pop("start_date", TODAY),
        end_date=over.pop("end_date", TODAY + timedelta(days=30)),
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


def test_create_requires_at_least_one_person(db_session):
    with pytest.raises(ValidationFailedError):
        svc.create_permit(
            db_session,
            PermitCreate(
                company="X",
                zones=["green"],
                start_date=TODAY,
                end_date=TODAY + timedelta(days=5),
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


def test_permit_requires_at_least_one_zone():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PermitCreate(
            company="X",
            zones=[],
            start_date=TODAY,
            end_date=TODAY + timedelta(days=3),
            people=[_person("A")],
        )


def test_zones_are_multi_and_deduped(db_session):
    row = _mk(db_session, zones=["green", "red", "green", "work_residence"])
    assert svc.to_read(row).zones == ["green", "red", "work_residence"]


def test_work_residence_filter_and_summary(db_session):
    _mk(db_session, zones=["work_residence"], people=[_person("A"), _person("B")])
    _mk(db_session, zones=["green"], people=[_person("C")])
    _, total = svc.list_permits(db_session, zone="work_residence")
    assert total == 1
    s = svc.summary(db_session)
    assert s["people_work_residence"] == 2
    assert s["people_green"] == 1


def test_export_csv_selected_ids_only(db_session):
    a = _mk(db_session, company="Alpha")
    _mk(db_session, company="Beta")
    out = svc.export_csv(db_session, ids=[a.id])
    # Only the selected id is exported.
    assert "Alpha" in out
    assert "Beta" not in out


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


def test_bad_window_rejected(db_session):
    with pytest.raises(ValidationFailedError):
        svc.create_permit(
            db_session,
            PermitCreate(
                company="X",
                zones=["red"],
                start_date=TODAY,
                end_date=TODAY - timedelta(days=1),
            ),
        )


def test_derived_status_expiring_and_expired(db_session):
    expiring = _mk(db_session, end_date=TODAY + timedelta(days=3))
    expired = _mk(
        db_session, start_date=TODAY - timedelta(days=40), end_date=TODAY - timedelta(days=1)
    )
    assert svc.to_list_item(expiring).derived_status == "expiring"
    assert svc.to_list_item(expired).derived_status == "expired"


def test_renew_extends_and_rejects_backwards(db_session):
    row = _mk(db_session, end_date=TODAY + timedelta(days=10))
    renewed = svc.renew_permit(db_session, row.id, new_end_date=TODAY + timedelta(days=40))
    assert renewed.end_date == TODAY + timedelta(days=40)
    with pytest.raises(ValidationFailedError):
        svc.renew_permit(db_session, row.id, new_end_date=TODAY)


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
    _mk(db_session, zones=["red"], end_date=TODAY + timedelta(days=30))
    _mk(db_session, zones=["green"], end_date=TODAY + timedelta(days=2))  # expiring
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


def test_summary_headcount_by_zone(db_session):
    _mk(db_session, zones=["green", "red"], people=[_person("A"), _person("B")])
    _mk(db_session, zones=["red"], people=[_person("C")])
    s = svc.summary(db_session)
    assert s["active"] == 2
    assert s["people_active"] == 3
    assert s["people_green"] == 2  # only the 'both' permit hits green
    assert s["people_red"] == 3  # both + red


def test_record_visit_hook(db_session):
    row = _mk(db_session)
    visit = svc.record_visit(
        db_session,
        row.id,
        PermitVisitCreate(direction="in", uae_id="784-1", gate="Gate 3", source="gate"),
    )
    assert visit.direction == "in" and visit.source == "gate"
    assert len(svc.list_visits(db_session, row.id)) == 1


def test_export_csv_has_header_and_rows(db_session):
    _mk(db_session, company="Acme")
    out = svc.export_csv(db_session)
    lines = out.strip().splitlines()
    # Branded title block leads; the machine header row follows, then data.
    assert lines[0].startswith("GSSG")
    header_idx = next(i for i, ln in enumerate(lines) if ln.startswith("permit_no,company,zone"))
    assert "Acme" in lines[header_idx + 1]


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
            zones=["green", "red"],
            start_date=TODAY,
            end_date=TODAY + timedelta(days=10),
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


def test_attach_person_and_vehicle_documents(db_session, tmp_path, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "data_dir", tmp_path)
    row = svc.create_permit(
        db_session,
        PermitCreate(
            company="X",
            zones=["red"],
            start_date=TODAY,
            end_date=TODAY + timedelta(days=10),
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
    svc.renew_permit(db_session, row.id, new_end_date=TODAY + timedelta(days=99))
    actions = {a.action for a in db_session.query(AuditLog).all()}
    assert "permit.created" in actions
    assert "permit.renewed" in actions
