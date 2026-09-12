"""Disposable legacy archives and safe inverse migration proof."""

import json
from datetime import date
from io import BytesIO

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from openpyxl import load_workbook
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.api.v1.inmate_statistics import _month_out
from app.config import get_settings
from app.db.models import Employee, User
from app.schemas.inmate_statistics import SubmissionOut, SubmissionSummaryOut
from app.services import inmate_statistics_service as service
from app.services import perm_service


def test_workflow_migration_is_the_single_sequential_head():
    config = Config("alembic.ini")
    scripts = ScriptDirectory.from_config(config)
    assert scripts.get_heads() == ["0088_inmate_statistics_workflow"]
    assert (
        scripts.get_revision(scripts.get_heads()[0]).down_revision == "0087_vehicle_photo_library"
    )


@pytest.mark.parametrize("state", ["untouched", "reopened", "new_seal"])
def test_legacy_upgrade_and_downgrade_preserve_only_current_force_reason(
    tmp_path, monkeypatch, state
):
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path / "data"))
    get_settings.cache_clear()
    config = Config("alembic.ini")
    url = f"sqlite:///{(tmp_path / 'legacy.db').as_posix()}"
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "0087_vehicle_photo_library")
    engine = create_engine(url)
    with engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO inmate_violation_periods (id,year,month,closed_at,closed_by,force_reason) VALUES (1,2026,8,'2026-09-01 10:00:00',91,'historical reason')"
            )
        )
        db.execute(
            text(
                "INSERT INTO inmate_violation_stat_rows (period_id,row_handle,origin,row_no,population,name,violation_date,wing,incomplete_marks) VALUES (1,'manual:7','manual',1,'pending','legacy synthetic','2026-08-02','A1','[\"nationality\"]')"
            )
        )
        db.execute(
            text(
                "INSERT INTO inmate_violation_periods (id,year,month,reopened_at,reopened_by) VALUES (2,2026,7,'2026-08-02 10:00:00',92)"
            )
        )
        db.execute(
            text(
                "INSERT INTO inmate_violation_stat_rows (period_id,row_handle,origin,row_no,population,name,violation_date) VALUES (2,'manual:8','manual',1,'expats','retained synthetic','2026-07-02')"
            )
        )
    command.upgrade(config, "0088_inmate_statistics_workflow")
    cache_root = tmp_path / "data"
    cache_root.mkdir(exist_ok=True)
    (cache_root / "legacy.xlsx").write_bytes(b"old legacy cache without archive label")
    with engine.begin() as db:
        db.execute(text("UPDATE inmate_violation_periods SET export_path='legacy.xlsx' WHERE id=1"))
    with Session(engine) as db:
        default_payload, _ = service.export_workbook(db, 2026, 8)
        assert default_payload.startswith(b"PK")
        summary = service.submission_history(db, 2026, 8)[0]
        assert summary["approved_at"] is None
        assert summary["created_at"] is None
        assert SubmissionSummaryOut(**summary).created_at is None
        for submission_id, month in ((1, 8), (2, 7)):
            view = service.submission_month(db, 2026, month, submission_id)
            detail = SubmissionOut(
                **_month_out(view).model_dump(),
                **service.submission_detail(db, 2026, month, submission_id),
            )
            assert detail.created_at is None
            payload, _ = service.export_workbook(
                db, 2026, month, submission_id=submission_id, language="en"
            )
            workbook = load_workbook(BytesIO(payload))
            summary = {row[0].value: row[1].value for row in workbook["الملخص"] if len(row) >= 2}
            assert summary["Status"] == "Legacy report"
    with engine.begin() as db:
        legacy = db.execute(
            text("SELECT payload,legacy_metadata FROM inmate_violation_submissions ORDER BY id")
        ).all()
        assert len(legacy) == 2
        assert json.loads(legacy[0].payload)["entries"][0]["population"] == "pending"
        assert json.loads(legacy[0].legacy_metadata)["force_reason"] == "historical reason"
        raw = json.loads(legacy[0].legacy_metadata).get("stored_rows")
        assert raw and raw[0]["uid"] is None and raw[0]["duty_unit"] is None
        assert json.loads(legacy[1].legacy_metadata)["closed_at"] is None
        assert db.scalar(text("SELECT count(*) FROM inmate_violation_workflow_actions")) == 0
        if state == "reopened":
            db.execute(text("UPDATE inmate_violation_periods SET closed_at=NULL WHERE id=1"))
            db.execute(
                text(
                    "UPDATE inmate_violation_workflows SET state='draft' WHERE year=2026 AND month=8"
                )
            )
    if state == "new_seal":
        with Session(engine, autoflush=False, expire_on_commit=False) as db:
            old = service.submission_month(db, 2026, 8, 1)
            assert old.workflow["legacy"] and old.workflow["approved"] is None
            assert old.entries[0].population == "pending"
            perm_service.seed_role_defaults(db)
            actors = []
            for index in range(3):
                employee = Employee(
                    id=f"GMIG{index}", name_ar=f"موظف ترحيل تجريبي {index}", name_en="Synthetic"
                )
                db.add(employee)
                db.flush()
                actor = User(
                    email=f"migration{index}@example.test",
                    password_hash="x",
                    role="admin",
                    status="active",
                    employee_id=employee.id,
                )
                db.add(actor)
                actors.append(actor)
            db.commit()
            opened = service.reopen_month(
                db, 2026, 8, actor=actors[0], expected_version=0, reason="new reviewed report"
            )
            assert opened.workflow["prepared"] is None
            service.create_manual_row(
                db,
                2026,
                8,
                actor=actors[0],
                name="new synthetic seal",
                violation_date=date(2026, 8, 2),
                reason="correct old data",
                wing="1A",
                nationality_label="الإمارات",
                details_text="complete",
            )
            view = service.build_month(db, 2026, 8)
            view = service.prepare_month(
                db,
                2026,
                8,
                actor=actors[0],
                expected_version=view.workflow["version"],
                expected_projection_fingerprint=view.projection_fingerprint,
                reviewer_user_id=actors[1].id,
            )
            view = service.review_month(
                db,
                2026,
                8,
                actor=actors[1],
                expected_version=view.workflow["version"],
                submission_id=view.workflow["active_submission_id"],
                manager_user_id=actors[2].id,
            )
            view = service.approve_month(
                db,
                2026,
                8,
                actor=actors[2],
                expected_version=view.workflow["version"],
                submission_id=view.workflow["active_submission_id"],
                today=date(2026, 9, 12),
            )
            assert view.closed and not view.workflow["legacy"]
            assert service.submission_month(db, 2026, 8, 1).entries[0].population == "pending"
    with engine.connect() as db:
        before = db.execute(text("SELECT * FROM inmate_violation_stat_rows ORDER BY id")).all()
    command.downgrade(config, "0087_vehicle_photo_library")
    with engine.connect() as db:
        assert db.scalar(text("SELECT force_reason FROM inmate_violation_periods WHERE id=1")) == (
            "historical reason" if state == "untouched" else None
        )
        assert db.scalar(text("SELECT count(*) FROM inmate_violation_stat_rows")) == 2
        assert (
            db.execute(text("SELECT * FROM inmate_violation_stat_rows ORDER BY id")).all() == before
        )
    command.upgrade(config, "0088_inmate_statistics_workflow")
    engine.dispose()
    get_settings.cache_clear()
