from __future__ import annotations

import asyncio
import json
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import UploadFile
from fastapi.testclient import TestClient
from sqlalchemy import event, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import AppError
from app.api.v1.employees import upload_to_vault
from app.config import Settings
from app.db.models import (
    Absence,
    AppSetting,
    AuditLog,
    Book,
    BookCategory,
    BookEditSession,
    BookVersion,
    Document,
    Employee,
    EmployeeFormerId,
    InmateViolationWorkflow,
    Leave,
    OutboundMessage,
    SmsMessage,
    Submitter,
    TimesheetOverride,
    TimesheetPeriod,
    TimesheetSnapshotRow,
    TimesheetStartAck,
    UniformIssue,
    User,
    UserPermission,
    VaultFile,
    Violation,
    WhatsAppMessage,
)
from app.db.session import get_db
from app.db.workforce_models import (
    AttendanceCase,
    AttendancePunchProfile,
    DutyAssignmentEvent,
    WorkShiftOverride,
)
from app.main import create_app
from app.services import (
    book_service,
    document_service,
    employee_service,
    inmate_statistics_service,
    photo_service,
    vault_service,
    word_book_service,
)
from app.services import employee_id_change_service as service


@pytest.fixture()
def setup(api_db: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    settings = Settings(data_dir=tmp_path / "data")
    settings.ensure_dirs()
    for module in (service, photo_service, vault_service):
        monkeypatch.setattr(module, "get_settings", lambda: settings)
    api_db.add_all(
        [
            Employee(id="G100", name_en="ALPHA", name_ar="ألف"),
            Employee(id="G200", name_en="BETA", supervisor_id="G100"),
        ]
    )
    api_db.commit()
    user = User(
        email="admin@x.ae",
        password_hash="x",
        role="admin",
        status="active",
        employee_id="G100",
        display_name="ALPHA",
    )
    api_db.add(user)
    api_db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    return api_db, user, settings, TestClient(app)


def _seed_linked(db: Session, user: User, settings: Settings) -> None:
    folder = settings.vault_dir / "G100"
    (folder / "photo").mkdir(parents=True)
    (folder / "photo" / "photo.png").write_bytes(b"avatar")
    (folder / "issued.docx").write_bytes(b"Issued to G100")
    db.add_all(
        [
            VaultFile(
                employee_id="G100", kind="photo", filename="photo.png", path="G100/photo/photo.png"
            ),
            Document(
                employee_id="G100",
                template_id="Employment Certificate",
                ref_number="HR-0001",
                docx_path=str(folder / "issued.docx"),
                submission_id="00000000-0000-0000-0000-000000000001",
            ),
            Leave(
                employee_id="G100",
                leave_type="Annual",
                start_date=date(2026, 1, 1),
                end_date=date(2026, 1, 2),
                days=2,
            ),
            Leave(
                employee_id="G100",
                leave_type="Annual",
                start_date=date(2026, 2, 1),
                end_date=date(2026, 2, 2),
                days=2,
                deleted_at=datetime(2026, 3, 1),
            ),
            Violation(employee_id="G100", violation_type="Late", date=date(2026, 1, 1)),
            Absence(employee_id="G100", date=date(2026, 1, 3)),
            TimesheetOverride(employee_id="G100", year=2026, month=1, day=4, code="R"),
            TimesheetStartAck(employee_id="G100", year=2026, month=1),
            UniformIssue(employee_id="G100", issued_on=date(2026, 1, 1)),
            AppSetting(key="settings.admin_employee_id", value=json.dumps("G100")),
            Submitter(
                employee_id="G100", name="Alpha", stored_sig_path=str(folder / "signature.png")
            ),
            BookCategory(id="HR", prefix="HR"),
            BookEditSession(
                user_id=user.id,
                token="test-token",
                working_path="word/test.docx",
                signer_employee_id="G100",
            ),
            TimesheetPeriod(id=1, year=2026, month=1),
            AuditLog(
                action="old",
                entity_type="employee",
                entity_id="G100",
                payload='{"employee_id":"G100"}',
            ),
            AttendancePunchProfile(
                employee_id="G100",
                shift_code="DAY",
                sample_days=1,
                arrival_early_offset=0,
                arrival_typical_offset=5,
                departure_typical_offset=0,
                departure_late_offset=5,
                window_days=30,
            ),
        ]
    )
    for model in (SmsMessage, WhatsAppMessage, OutboundMessage):
        values = dict(
            employee_id="G100",
            event_type="leave",
            event_ref="1",
            language="en",
            phone="0500000000",
            status="sent",
        )
        if model is WhatsAppMessage:
            values["template"] = "leave"
        db.add(model(**values))
    db.commit()
    db.add_all(
        [
            Book(
                category_id="HR",
                ref_number="HR-0001",
                employee_id="G100",
                doc_path="G100/issued.docx",
                attachment_paths=["vault/G100/photo/photo.png"],
                merged_attachment_paths=[
                    {"path": str(folder / "issued.docx"), "slot_key": "paper"}
                ],
            ),
            TimesheetSnapshotRow(
                period_id=1, employee_id="G100", row_no=1, name_en="ALPHA", codes=[], stat_codes=[]
            ),
            WorkShiftOverride(
                id=1,
                employee_id="G100",
                assignment_kind="off",
                reason_kind="other",
                reason="Rest day",
                starts_at=datetime(2026, 1, 1),
                ends_at=datetime(2026, 1, 2),
                created_by_user_id=user.id,
            ),
        ]
    )
    db.commit()
    db.add(
        AttendanceCase(
            employee_id="G100",
            shift_override_id=1,
            employee_status_snapshot="Active",
            shift_code_snapshot="DAY",
            scheduled_start_at=datetime(2026, 1, 1),
            scheduled_end_at=datetime(2026, 1, 2),
            operational_date=date(2026, 1, 1),
            organization_snapshot_state="unknown",
        )
    )
    db.commit()


def test_preview_statuses_and_all_impact_counts(setup):
    db, user, settings, client = setup
    _seed_linked(db, user, settings)
    db.add(
        EmployeeFormerId(
            employee_id="G200", former_id="G222", new_id="G200", reason="Import correction"
        )
    )
    db.commit()
    for candidate, status, owner in [
        ("bad", "invalid", None),
        (" g100 ", "same", None),
        ("G200", "taken", "G200"),
        ("G222", "taken", "G200"),
        (" g300 ", "ok", None),
    ]:
        response = client.get(
            "/api/v1/employees/G100/id-change/preview", params={"new_id": candidate}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["new_id"] == candidate.strip().upper()
        assert body["status"] == status
        assert body["owner_id"] == owner
        if owner:
            assert body["owner_name_en"] == "BETA"
        assert {item["key"]: item["count"] for item in body["impact"]} == {
            "documents": 1,
            "leaves": 1,
            "violations": 1,
            "absences": 1,
            "attendance": 1,
            "timesheet": 2,
            "messages": 3,
            "uniform": 1,
            "vault_files": 2,
        }


def test_rename_moves_live_references_paths_folder_and_preserves_history(setup):
    db, user, settings, client = setup
    _seed_linked(db, user, settings)
    statements = []

    def record(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(db.get_bind(), "before_cursor_execute", record)
    response = client.post(
        "/api/v1/employees/G100/id-change",
        json={"new_id": " g300 ", "reason": "  Correct the original typo  "},
    )
    event.remove(db.get_bind(), "before_cursor_execute", record)
    assert response.status_code == 200, response.text
    assert response.json()["id"] == "G300"
    assert response.json()["former_ids"] == ["G100"]
    assert response.json()["has_photo"] is True
    assert any("PRAGMA defer_foreign_keys = ON" in statement for statement in statements)
    assert client.get("/api/v1/employees/G100").status_code == 404
    assert client.get("/api/v1/employees/G300").json()["former_ids"] == ["G100"]
    assert client.patch("/api/v1/employees/G300", json={"notes": "Updated"}).json()[
        "former_ids"
    ] == ["G100"]
    assert client.get("/api/v1/employees/G300/detail").json()["employee"]["former_ids"] == ["G100"]
    assert client.get("/api/v1/employees", params={"q": "G100"}).json()["items"][0]["id"] == "G300"
    assert client.get("/api/v1/employees", params={"q": "G100"}).json()["items"][0][
        "former_ids"
    ] == ["G100"]
    for column in service.employee_reference_columns():
        assert db.scalar(select(column).where(column == "G100").limit(1)) is None, str(column)
    assert db.get(Employee, "G200").supervisor_id == "G300"
    assert db.scalar(select(TimesheetStartAck.employee_id)) == "G300"
    assert db.scalar(select(BookEditSession.signer_employee_id)) == "G300"
    assert db.scalar(select(AttendancePunchProfile.employee_id)) == "G300"
    assert db.scalar(
        select(AppSetting.value).where(AppSetting.key == "settings.admin_employee_id")
    ) == json.dumps("G300")
    assert db.scalar(select(VaultFile.path)) == "G300/photo/photo.png"
    assert (
        db.scalar(select(Document.docx_path))
        == (settings.vault_dir / "G300/issued.docx").as_posix()
    )
    book = db.scalar(select(Book))
    assert book.doc_path == "G300/issued.docx"
    assert book.attachment_paths == ["vault/G300/photo/photo.png"]
    assert (
        book.merged_attachment_paths[0]["path"]
        == (settings.vault_dir / "G300/issued.docx").as_posix()
    )
    assert (
        db.scalar(select(Submitter.stored_sig_path))
        == (settings.vault_dir / "G300/signature.png").as_posix()
    )
    assert not (settings.vault_dir / "G100").exists()
    assert (settings.vault_dir / "G300/issued.docx").read_bytes() == b"Issued to G100"
    assert db.scalar(select(TimesheetSnapshotRow.employee_id)) == "G100"
    old_audit = db.scalar(select(AuditLog).where(AuditLog.action == "old"))
    assert old_audit.entity_id == "G100" and json.loads(old_audit.payload)["employee_id"] == "G100"
    history = db.scalar(select(EmployeeFormerId))
    assert (history.employee_id, history.former_id, history.new_id, history.reason) == (
        "G300",
        "G100",
        "G300",
        "Correct the original typo",
    )
    activity = client.get(
        "/api/v1/employees/activity", params={"employee_id": "G300", "kind": "id_change"}
    ).json()["items"]
    assert len(activity) == 1
    assert {
        key: activity[0][key] for key in ("kind", "reference", "title", "reason", "actor_name")
    } == {
        "kind": "id_change",
        "reference": "G100",
        "title": "G300",
        "reason": "Correct the original typo",
        "actor_name": "ALPHA",
    }
    assert db.execute(text("PRAGMA foreign_key_check")).all() == []


def test_change_back_to_own_former_number_preserves_assigned_history(setup):
    db, _user, settings, client = setup
    (settings.vault_dir / "G100").mkdir()
    for old, new in [("G100", "G300"), ("G300", "G100"), ("G100", "G400")]:
        assert (
            client.get(f"/api/v1/employees/{old}/id-change/preview", params={"new_id": new}).json()[
                "status"
            ]
            == "ok"
        )
        response = client.post(
            f"/api/v1/employees/{old}/id-change",
            json={"new_id": new, "reason": "Correction reason"},
        )
        assert response.status_code == 200, response.text
    assert response.json()["former_ids"] == ["G100", "G300"]
    history = list(db.scalars(select(EmployeeFormerId).order_by(EmployeeFormerId.id)))
    assert [row.new_id for row in history] == ["G300", "G100", "G400"]
    assert {row.employee_id for row in history} == {"G400"}
    assert client.get("/api/v1/employees", params={"q": "G300"}).json()["items"][0]["id"] == "G400"


@pytest.mark.parametrize("role", ["operator", "manager"])
def test_capability_required_for_preview_and_change(setup, role):
    db, user, _settings, client = setup
    user.role = role
    db.commit()
    assert client.get("/api/v1/employees/G100/id-change/preview?new_id=G300").status_code == 403
    assert (
        client.post(
            "/api/v1/employees/G100/id-change",
            json={"new_id": "G300", "reason": "Correction reason"},
        ).status_code
        == 403
    )
    db.add(UserPermission(user_id=user.id, capability="employees.change_id", effect="grant"))
    db.commit()
    user._effective_caps_cache = None
    assert (
        client.post(
            "/api/v1/employees/G100/id-change",
            json={"new_id": "G300", "reason": "Correction reason"},
        ).status_code
        == 200
    )


@pytest.mark.parametrize(
    "candidate,code,status",
    [
        ("bad", "EMPLOYEE_ID_INVALID", 422),
        ("G100", "EMPLOYEE_ID_SAME", 409),
        ("G200", "EMPLOYEE_ID_TAKEN", 409),
    ],
)
def test_change_reports_contract_errors(setup, candidate, code, status):
    _db, _user, _settings, client = setup
    response = client.post(
        "/api/v1/employees/G100/id-change",
        json={"new_id": candidate, "reason": "Correction reason"},
    )
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


@pytest.mark.parametrize("reason", ["    ", " abcd ", "x" * 501])
def test_reason_is_trimmed_and_length_validated(setup, reason):
    _db, _user, _settings, client = setup
    assert (
        client.post(
            "/api/v1/employees/G100/id-change", json={"new_id": "G300", "reason": reason}
        ).status_code
        == 422
    )


def test_vault_conflict_does_not_modify_database_or_files(setup):
    db, _user, settings, client = setup
    for number in ("G100", "G300"):
        (settings.vault_dir / number).mkdir()
    response = client.post(
        "/api/v1/employees/G100/id-change", json={"new_id": "G300", "reason": "Correction reason"}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "EMPLOYEE_ID_VAULT_CONFLICT"
    assert db.get(Employee, "G100") is not None
    assert db.get(Employee, "G300") is None
    assert db.scalar(select(EmployeeFormerId)) is None


@pytest.mark.parametrize("failure", ["move", "commit"])
def test_failed_move_or_commit_restores_database_and_folder(setup, failure):
    db, user, settings, _client = setup
    _seed_linked(db, user, settings)
    target = (
        patch.object(Path, "rename", side_effect=OSError("move failed"))
        if failure == "move"
        else patch.object(db, "commit", side_effect=RuntimeError("commit failed"))
    )
    with target, pytest.raises((OSError, RuntimeError)):
        service.change(db, user, "G100", "G300", "Correction reason")
    assert (settings.vault_dir / "G100/issued.docx").is_file()
    assert not (settings.vault_dir / "G300").exists()
    assert db.get(Employee, "G100") is not None
    assert db.get(Employee, "G300") is None
    assert db.scalar(select(VaultFile.path)) == "G100/photo/photo.png"
    assert db.scalar(select(EmployeeFormerId)) is None


def test_former_ids_lookup_is_batched(setup):
    db, _user, _settings, _client = setup
    db.add_all(
        [
            EmployeeFormerId(
                employee_id="G100", former_id="G099", new_id="G100", reason="Earlier correction"
            ),
            EmployeeFormerId(
                employee_id="G200", former_id="G199", new_id="G200", reason="Earlier correction"
            ),
        ]
    )
    db.commit()
    statements = []

    def record(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(db.get_bind(), "before_cursor_execute", record)
    result = employee_service.former_ids_by_employee(db, ["G100", "G200"])
    event.remove(db.get_bind(), "before_cursor_execute", record)
    assert result == {"G100": ["G099"], "G200": ["G199"]}
    assert len(statements) == 1


def test_corrected_number_stays_reserved_for_new_employees(setup):
    db, _user, _settings, client = setup
    response = client.post(
        "/api/v1/employees/G100/id-change", json={"new_id": "G300", "reason": "Correction reason"}
    )
    assert response.status_code == 200, response.text
    for candidate in ("G100", "g100"):
        created = client.post("/api/v1/employees", json={"id": candidate, "name_en": "GAMMA"})
        assert created.status_code == 409, created.text
        assert created.json()["error"]["code"] == "EMPLOYEE_ID_TAKEN"
    assert db.get(Employee, "G100") is None
    assert (
        client.post("/api/v1/employees", json={"id": "G500", "name_en": "GAMMA"}).status_code == 201
    )


def test_pending_report_assignments_follow_correction_but_completed_stages_keep_number(setup):
    db, user, _settings, client = setup
    reviewer = User(
        email="reviewer@x.ae", password_hash="x", role="admin", status="active", employee_id="G200"
    )
    db.add(reviewer)
    db.flush()
    pending = InmateViolationWorkflow(
        year=2026,
        month=1,
        state="awaiting_review",
        reviewer_user_id=user.id,
        reviewer_employee_id="G100",
        actors={"prepared": {"user_id": reviewer.id, "employee_id": "G200", "name_ar": "ب"}},
    )
    reviewed = InmateViolationWorkflow(
        year=2026,
        month=2,
        state="awaiting_manager",
        reviewer_user_id=user.id,
        reviewer_employee_id="G100",
        manager_user_id=reviewer.id,
        manager_employee_id="G200",
        actors={"reviewed": {"user_id": user.id, "employee_id": "G100", "name_ar": "ألف"}},
    )
    db.add_all([pending, reviewed])
    db.commit()
    response = client.post(
        "/api/v1/employees/G100/id-change", json={"new_id": "G300", "reason": "Correction reason"}
    )
    assert response.status_code == 200, response.text
    pending = db.scalar(select(InmateViolationWorkflow).where(InmateViolationWorkflow.month == 1))
    reviewed = db.scalar(select(InmateViolationWorkflow).where(InmateViolationWorkflow.month == 2))
    assert pending.reviewer_employee_id == "G300"
    assert reviewed.reviewer_employee_id == "G100"
    assert reviewed.actors["reviewed"]["employee_id"] == "G100"
    actor = db.get(User, user.id)
    facts = inmate_statistics_service._stage_actor(db, pending, actor, "review")
    assert facts["employee_id"] == "G300"


@pytest.mark.parametrize("template", ["Inmate Conduct Violations", "Report"])
@pytest.mark.parametrize(
    "state,action", [("none", "revise"), ("returned", "revise"), ("none", "submit")]
)
def test_corrected_reporter_can_write_unchanged_document_fields(setup, template, state, action):
    db, user, _settings, _client = setup
    user_id = user.id
    fields = {"reporter_id": "G100", "signer_employee_id": "G100", "signed": True}
    db.add(BookCategory(id="GS", prefix="GS"))
    db.commit()
    book = Book(
        category_id="GS",
        ref_number="REPORT-0001" if template == "Report" else "IV-0001",
        approval_state=state,
        versions=[
            BookVersion(
                version_no=1,
                template_id=template,
                fields=fields,
                status="approved",
                created_by_user_id=user_id,
            )
        ],
    )
    db.add(book)
    db.commit()
    book_id = book.id
    service.change(db, user, "G100", "G300", "Correction reason")
    service.change(db, db.get(User, user_id), "G300", "G400", "Second correction")
    version = book_service.require_inmate_report_write_access(
        db, db.get(User, user_id), db.get(Book, book_id), action=action
    )
    assert version.fields == fields


@pytest.mark.parametrize("with_history", [False, True])
def test_open_register_resolves_corrected_reporter_name_and_duty_unit(setup, with_history):
    db, user, _settings, _client = setup
    db.get(Employee, "G100").duty_unit = "السرية الخامسة"
    if with_history:
        db.add(
            DutyAssignmentEvent(
                employee_id="G100",
                event_type="baseline",
                to_unit="السرية الأولى",
                effective_at=datetime(2026, 1, 1),
            )
        )
    db.add(BookCategory(id="INV", prefix="IV"))
    db.commit()
    fields = {"reporter_id": "G100", "report_date": "2026-08-05", "inmates": [{"name": "نزيل"}]}
    book = Book(
        category_id="INV",
        ref_number="IV-0001",
        versions=[
            BookVersion(version_no=1, template_id="Inmate Conduct Violations", fields=fields)
        ],
    )
    db.add(book)
    db.commit()
    service.change(db, user, "G100", "G300", "Correction reason")
    entry = inmate_statistics_service.build_month(db, 2026, 8).entries[0]
    assert entry.reporter_id == "G100"
    assert entry.reporter_name == "ألف"
    assert entry.duty_unit == ("السرية الأولى" if with_history else "السرية الخامسة")


@pytest.mark.parametrize("stage", ["review", "approve"])
def test_corrected_employee_cannot_fill_another_role_through_second_account(setup, stage):
    db, user, _settings, _client = setup
    twin = User(
        email="twin@x.ae", password_hash="x", role="admin", status="active", employee_id="G100"
    )
    db.add(twin)
    db.commit()
    twin_id = twin.id
    earlier = [inmate_statistics_service._identity(db, user, "prepare")]
    service.change(db, user, "G100", "G300", "Correction reason")
    with pytest.raises(AppError) as error:
        inmate_statistics_service._identity(db, db.get(User, twin_id), stage, earlier=earlier)
    assert error.value.code == "INMATE_REGISTER_ACTORS_NOT_DISTINCT"
    assert earlier[0]["employee_id"] == "G100"


def test_upload_rechecks_employee_after_correction_during_read(setup):
    db, user, settings, _client = setup
    user_id = user.id
    stale_employee = db.get(Employee, "G100")
    upload = UploadFile(filename="scan.pdf", file=BytesIO(b"scan"))

    async def read_after_correction():
        with Session(db.get_bind()) as other:
            service.change(other, other.get(User, user_id), "G100", "G300", "Correction reason")
        assert db.get(Employee, "G100") is stale_employee
        return b"scan"

    with (
        patch.object(upload, "read", side_effect=read_after_correction),
        pytest.raises(AppError) as error,
    ):
        asyncio.run(upload_to_vault("G100", db, user, "other", upload))
    assert error.value.code == "EMPLOYEE_NOT_FOUND"
    assert not (settings.vault_dir / "G100").exists()


def test_upload_holds_correction_write_lock_until_file_is_saved(setup):
    db, user, settings, _client = setup
    original_save = vault_service.save_upload

    def save_while_locked(*args):
        with Session(db.get_bind()) as other:
            other.connection().exec_driver_sql("PRAGMA busy_timeout=1")
            with pytest.raises(OperationalError, match="database is locked"):
                other.connection().exec_driver_sql("BEGIN IMMEDIATE")
        return original_save(*args)

    upload = UploadFile(filename="scan.pdf", file=BytesIO(b"scan"))
    with patch.object(vault_service, "save_upload", side_effect=save_while_locked):
        entry = asyncio.run(upload_to_vault("G100", db, user, "other", upload))
    assert (settings.vault_dir / "G100/documents/other" / entry.filename).read_bytes() == b"scan"
    service.change(db, user, "G100", "G300", "Correction after upload")
    assert (settings.vault_dir / "G300/documents/other" / entry.filename).read_bytes() == b"scan"


def test_signed_violation_template_resolves_reporter_but_keeps_recorded_number(setup):
    db, user, _settings, _client = setup
    fields = {"reporter_id": "G100", "submitter_g": "G100"}
    service.change(db, user, "G100", "G300", "Correction reason")
    data = document_service._build_template_data(
        db,
        template_id="Inmate Conduct Violations",
        employee=None,
        employee_id=None,
        fields=fields,
        manager_id=None,
        submitter_id=None,
        embed_signature=None,
        current_user=None,
    )
    assert data["reporter_name"] == "ألف"
    assert data["reporter_g"] == data["submitter_g"] == "G100"
    assert fields == {"reporter_id": "G100", "submitter_g": "G100"}


def test_reopened_word_report_resolves_live_signer_without_changing_prior_fields(
    setup, monkeypatch
):
    from docx import Document as DocxFile

    db, user, settings, _client = setup
    user_id = user.id
    monkeypatch.setattr(word_book_service, "get_settings", lambda: settings)
    source = settings.data_dir / "report.docx"
    DocxFile().save(source)
    db.add(BookCategory(id="GS", prefix="GS"))
    document = Document(
        template_id="Report",
        ref_number="REPORT-0001",
        docx_path=str(source),
        submission_id="report-test",
    )
    db.add(document)
    db.commit()
    fields = {"signer_employee_id": "G100", "signed": True}
    book = Book(
        category_id="GS",
        ref_number="REPORT-0001",
        approval_state="returned",
        versions=[
            BookVersion(
                version_no=1,
                template_id="Report",
                document_id=document.id,
                fields=fields,
                created_by_user_id=user_id,
            )
        ],
    )
    db.add(book)
    db.commit()
    book_id = book.id
    service.change(db, user, "G100", "G300", "Correction reason")
    info = word_book_service.reopen_word_session(db, user=db.get(User, user_id), book_id=book_id)
    session = db.scalar(select(BookEditSession).where(BookEditSession.token == info.token))
    assert session.signer_employee_id == "G300"
    assert session.sign_on_finish is True
    assert db.get(Book, book_id).versions[0].fields == fields
