"""Routes, capability gates, and the freeze-on-download contract."""

from __future__ import annotations

import io
from dataclasses import fields
from datetime import date
from typing import get_args
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.core import permissions, timesheet_xlsx
from app.core.constants import ARABIC_MONTHS
from app.db import session as session_mod
from app.db.models import (
    Absence,
    Base,
    Employee,
    TimesheetDesignation,
    TimesheetPeriod,
    TimesheetStartAck,
    User,
)
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.schemas import timesheet as schemas
from app.services import perm_service
from app.services import timesheet_service as svc

XLSX_PREFIX = "application/vnd.openxmlformats-officedocument.spreadsheetml"


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    db_file = tmp_path / "timesheet.db"
    eng = create_engine(
        f"sqlite:///{db_file}", future=True, connect_args={"check_same_thread": False}
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    svc.seed_designations(db)  # metadata.create_all skips the migration seed
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def db_session(api_db) -> Session:
    """Shadow the conftest fixture so the client and the seeds share one DB."""
    return api_db


def _client_for(api_db: Session, role: str, email: str) -> TestClient:
    user = User(email=email, password_hash="x", role=role, status="active")
    api_db.add(user)
    api_db.commit()
    api_db.refresh(user)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app, raise_server_exceptions=True)
    client.user_id = user.id  # type: ignore[attr-defined]
    return client


@pytest.fixture()
def client(api_db) -> TestClient:
    """A manager: `timesheet.view` (inherited) + `timesheet.edit`."""
    return _client_for(api_db, "manager", "mgr@x.ae")


@pytest.fixture()
def viewer_client(api_db) -> TestClient:
    """An operator: `timesheet.view` only — the read-only half of the page."""
    return _client_for(api_db, "operator", "ops@x.ae")


def _guard(db: Session) -> None:
    designation = db.query(TimesheetDesignation).filter_by(name_en="Security Guard").one()
    db.add(
        Employee(
            id="G1001",
            name_en="TEST GUARD",
            nationality="الإمارات",
            doj=date(2020, 1, 1),
            designation_id=designation.id,
        )
    )
    db.commit()


def _driver(db: Session) -> None:
    designation = db.query(TimesheetDesignation).filter_by(name_en="Driver").one()
    db.add(
        Employee(
            id="G2000",
            name_en="TEST DRIVER",
            nationality="الإمارات",
            doj=date(2020, 1, 1),
            designation_id=designation.id,
        )
    )
    db.commit()


# --------------------------------------------------------------------------- #
# the grid
# --------------------------------------------------------------------------- #


def test_get_returns_the_grid(client, db_session):
    _guard(db_session)
    body = client.get("/api/v1/timesheet/2026/7").json()
    assert body["days_in_month"] == 31
    assert body["post_count"] == 249
    assert body["rows"][0]["employee_id"] == "G1001"
    assert body["rows"][0]["codes"][0] == "P"


def test_the_grid_response_loses_no_field(client, db_session):
    """Every ``MonthGrid`` and ``GridRow`` field reaches the page.

    Asserted against the dataclasses, so a field added to the service and
    forgotten in the schema fails here instead of silently disabling a feature.
    """

    _guard(db_session)
    client.put(
        "/api/v1/timesheet/2026/7/cell",
        json={"employee_id": "G1001", "day": 9, "code": "AB", "note": "no show"},
    )
    body = client.get("/api/v1/timesheet/2026/7").json()

    grid_fields = {f.name for f in fields(svc.MonthGrid)}
    row_fields = {f.name for f in fields(svc.GridRow)}
    assert len(grid_fields) == 11 and len(row_fields) == 15
    assert set(body) == grid_fields
    row = body["rows"][0]
    assert set(row) == row_fields
    assert row["stat_filler"] is None
    assert row["joined_day"] is None
    assert row["left_day"] is None
    assert row["start_confirmed"] is False


def test_notes_serialise_with_string_keys(client, db_session):
    """``dict[int, str]`` in Python; the page indexes it as ``notes[String(day)]``."""

    _guard(db_session)
    client.put(
        "/api/v1/timesheet/2026/7/cell",
        json={"employee_id": "G1001", "day": 9, "code": "AB", "note": "no show"},
    )
    notes = client.get("/api/v1/timesheet/2026/7").json()["rows"][0]["notes"]
    assert notes == {"9": "no show"}
    assert [type(key) for key in notes] == [str]


def test_a_warning_may_name_someone_with_no_row(client, db_session):
    """``warnings`` and ``removed`` are top-level, never nested in a row."""

    designation = db_session.query(TimesheetDesignation).filter_by(name_en="Security Guard").one()
    db_session.add(
        Employee(
            id="G1002",
            name_en="GONE GUARD",
            nationality="الإمارات",
            doj=date(2020, 1, 1),
            end_date=date(2026, 6, 20),
            status="Active",
            designation_id=designation.id,
        )
    )
    db_session.commit()

    body = client.get("/api/v1/timesheet/2026/7").json()
    assert [row["employee_id"] for row in body["rows"]] == []
    warning = next(item for item in body["warnings"] if item["kind"] == "departed_but_active")
    assert warning["employee_id"] == "G1002"
    assert set(warning) == {"employee_id", "kind", "detail"}
    removed = body["removed"][0]
    assert set(removed) == {f.name for f in fields(svc.Removed)}
    assert (removed["employee_id"], removed["last_day"], removed["month"], removed["year"]) == (
        "G1002",
        20,
        6,
        2026,
    )


def test_an_impossible_month_is_refused_not_a_500(client):
    assert client.get("/api/v1/timesheet/2026/13").status_code == 422
    assert client.get("/api/v1/timesheet/2026/0").status_code == 422


def test_the_drivers_sheet_is_its_own_grid(client, db_session):
    _guard(db_session)
    _driver(db_session)
    assert [r["employee_id"] for r in client.get("/api/v1/timesheet/2026/7").json()["rows"]] == [
        "G1001"
    ]
    body = client.get("/api/v1/timesheet/2026/7?sheet=drivers").json()
    assert [r["employee_id"] for r in body["rows"]] == ["G2000"]
    assert body["sheet"] == "drivers"


# --------------------------------------------------------------------------- #
# editing
# --------------------------------------------------------------------------- #


def test_put_cell_marks_absence(client, db_session):
    _guard(db_session)
    response = client.put(
        "/api/v1/timesheet/2026/7/cell",
        json={"employee_id": "G1001", "day": 9, "code": "AB", "note": "no show"},
    )
    assert response.status_code == 200
    assert client.get("/api/v1/timesheet/2026/7").json()["rows"][0]["codes"][8] == "AB"


def test_a_cell_edit_records_who_made_it(client, db_session):
    _guard(db_session)
    client.put(
        "/api/v1/timesheet/2026/7/cell", json={"employee_id": "G1001", "day": 9, "code": "AB"}
    )
    assert db_session.query(Absence).one().created_by == client.user_id


def test_a_bad_cell_code_answers_with_the_service_error(client, db_session):
    _guard(db_session)
    response = client.put(
        "/api/v1/timesheet/2026/7/cell", json={"employee_id": "G1001", "day": 9, "code": "ZZ"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "TIMESHEET_BAD_CODE"


def test_a_cell_edit_for_an_unknown_employee_is_a_404(client, db_session):
    _guard(db_session)
    response = client.put(
        "/api/v1/timesheet/2026/7/cell", json={"employee_id": "G9998", "day": 9, "code": "AB"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "EMPLOYEE_NOT_FOUND"


def test_patch_sets_the_post_count_and_a_filler(client, db_session):
    _guard(db_session)
    response = client.patch(
        "/api/v1/timesheet/2026/7",
        json={"post_count": 0, "fillers": [{"employee_id": "G1001", "code": "SL "}]},
    )
    assert response.status_code == 200
    row = client.get("/api/v1/timesheet/2026/7").json()["rows"][0]
    assert row["stat_block"] == 2
    assert row["stat_codes"][0] == "SL "


def test_a_closed_month_rejects_a_cell_edit(client, db_session):
    _guard(db_session)
    client.get("/api/v1/timesheet/2026/7/export")
    response = client.put(
        "/api/v1/timesheet/2026/7/cell", json={"employee_id": "G1001", "day": 9, "code": "AB"}
    )
    assert response.status_code == 409


def test_reopen_unlocks_it(client, db_session):
    _guard(db_session)
    client.get("/api/v1/timesheet/2026/7/export")
    assert client.post("/api/v1/timesheet/2026/7/reopen").status_code == 200
    assert (
        client.put(
            "/api/v1/timesheet/2026/7/cell", json={"employee_id": "G1001", "day": 9, "code": "AB"}
        ).status_code
        == 200
    )


def test_close_and_reopen_record_the_actor(client, db_session):
    _guard(db_session)
    body = client.post("/api/v1/timesheet/2026/7/close").json()
    assert body["closed_at"] is not None
    assert body["closed_by"] == "mgr@x.ae"
    period = db_session.query(TimesheetPeriod).one()
    assert period.closed_by == client.user_id
    client.post("/api/v1/timesheet/2026/7/reopen")
    db_session.refresh(period)
    assert period.closed_at is None
    assert period.reopened_by == client.user_id


# --------------------------------------------------------------------------- #
# the starting-point acknowledgement
# --------------------------------------------------------------------------- #


def test_start_ack_is_204_idempotent_and_records_the_actor(client, db_session):
    designation = db_session.query(TimesheetDesignation).filter_by(name_en="Security Guard").one()
    db_session.add(
        Employee(
            id="G7176",
            name_en="NEW GUARD",
            nationality="الإمارات",
            doj=date(2026, 7, 14),
            designation_id=designation.id,
        )
    )
    db_session.commit()

    first = client.post("/api/v1/timesheet/2026/7/start-ack", json={"employee_id": "G7176"})
    assert first.status_code == 204
    assert first.content == b""
    assert (
        client.post("/api/v1/timesheet/2026/7/start-ack", json={"employee_id": "G7176"}).status_code
        == 204
    )
    ack = db_session.query(TimesheetStartAck).one()
    assert ack.acked_by == client.user_id
    row = client.get("/api/v1/timesheet/2026/7").json()["rows"][0]
    assert row["start_confirmed"] is True
    assert row["joined_day"] == 14


def test_start_ack_is_allowed_on_a_closed_month(client, db_session):
    """Refusing it after the close would strand the flag forever."""

    _guard(db_session)
    client.get("/api/v1/timesheet/2026/7/export")
    assert client.get("/api/v1/timesheet/2026/7").json()["closed_at"] is not None
    assert (
        client.post("/api/v1/timesheet/2026/7/start-ack", json={"employee_id": "G1001"}).status_code
        == 204
    )
    assert db_session.query(TimesheetStartAck).count() == 1


def test_start_ack_for_someone_off_the_roster_is_a_404(client, db_session):
    _guard(db_session)
    response = client.post("/api/v1/timesheet/2026/7/start-ack", json={"employee_id": "G9999"})
    assert response.status_code == 404
    # The service's code, not Starlette's HTTP_404: a bare status assertion here
    # passes against a route that does not exist at all.
    assert response.json()["error"]["code"] == "EMPLOYEE_NOT_FOUND"
    assert db_session.query(TimesheetStartAck).count() == 0


# --------------------------------------------------------------------------- #
# the workbooks
# --------------------------------------------------------------------------- #


def test_export_returns_an_xlsx_with_an_rfc5987_arabic_filename(client, db_session):
    _guard(db_session)
    response = client.get("/api/v1/timesheet/2026/7/export?variant=attendance")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(XLSX_PREFIX)
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert "filename*=UTF-8''" in disposition  # a bare filename= raises on latin-1
    assert quote("كشف حضور") in disposition
    assert client.get("/api/v1/timesheet/2026/7").json()["closed_at"] is not None


def test_the_statistics_variant_is_a_second_workbook(client, db_session):
    _guard(db_session)
    response = client.get("/api/v1/timesheet/2026/7/export?variant=statistics")
    assert response.status_code == 200
    assert quote("الاحصائية شهر") in response.headers["content-disposition"]


def test_an_unknown_variant_is_refused(client, db_session):
    _guard(db_session)
    assert client.get("/api/v1/timesheet/2026/7/export?variant=nonsense").status_code == 422


def test_export_blocks_when_an_employee_has_no_designation(client, db_session):
    db_session.add(
        Employee(id="G9999", name_en="Nobody", nationality="الإمارات", doj=date(2020, 1, 1))
    )
    db_session.commit()
    response = client.get("/api/v1/timesheet/2026/7/export")
    assert response.status_code == 422
    assert "no_designation" in response.text
    assert db_session.query(TimesheetPeriod).count() == 0  # a refused download freezes nothing


def test_single_employee_export(client, db_session):
    _guard(db_session)
    response = client.get("/api/v1/timesheet/employee/G1001/2026/7/export")
    assert response.status_code == 200
    assert "filename*=UTF-8''" in response.headers["content-disposition"]


def test_the_employee_export_freezes_nothing(client, db_session):
    _guard(db_session)
    client.get("/api/v1/timesheet/employee/G1001/2026/7/export")
    assert client.get("/api/v1/timesheet/2026/7").json()["closed_at"] is None


def test_the_employee_export_finds_a_driver_on_his_own_sheet(client, db_session):
    _driver(db_session)
    response = client.get("/api/v1/timesheet/employee/G2000/2026/7/export")
    assert response.status_code == 200
    assert load_workbook(io.BytesIO(response.content)).worksheets[0]["B6"].value == "G2000"


def test_two_months_are_one_workbook_earlier_sheet_first(client, db_session):
    _guard(db_session)
    response = client.get("/api/v1/timesheet/employee/G1001/2026/7/export?months=2")
    assert response.status_code == 200
    workbook = load_workbook(io.BytesIO(response.content))
    assert workbook.sheetnames == ["JUN", "JUL"]
    assert workbook["JUN"]["B6"].value == "G1001"
    assert workbook["JUL"]["B6"].value == "G1001"
    # The name carries the LATER month, which is the month of departure.
    disposition = response.headers["content-disposition"]
    assert quote(f"كشف حضور TEST GUARD {ARABIC_MONTHS[6]}") in disposition
    assert quote(ARABIC_MONTHS[5]) not in disposition


def test_two_months_step_back_over_the_december_boundary(client, db_session):
    _guard(db_session)
    response = client.get("/api/v1/timesheet/employee/G1001/2027/1/export?months=2")
    assert response.status_code == 200
    workbook = load_workbook(io.BytesIO(response.content))
    assert workbook.sheetnames == ["DEC", "JAN"]
    assert workbook["DEC"]["D4"].value == "For the Month of :DEC-2026"
    assert workbook["JAN"]["D4"].value == "For the Month of :JAN-2027"


@pytest.mark.parametrize("months", [0, 3, 12])
def test_months_outside_one_and_two_is_refused(client, db_session, months):
    _guard(db_session)
    response = client.get(f"/api/v1/timesheet/employee/G1001/2026/7/export?months={months}")
    assert response.status_code == 422


def test_the_employee_export_404s_for_someone_off_the_sheet(client, db_session):
    _guard(db_session)
    unknown = client.get("/api/v1/timesheet/employee/G9999/2026/7/export")
    assert unknown.status_code == 404
    # The service's code, not Starlette's HTTP_404, which a missing route returns.
    assert unknown.json()["error"]["code"] == "EMPLOYEE_NOT_FOUND"

    designation = db_session.query(TimesheetDesignation).filter_by(name_en="Driver").one()
    db_session.add(
        Employee(
            id="G3000",
            name_en="LATER GUARD",
            nationality="الإمارات",
            doj=date(2026, 9, 1),  # employed, but not in July
            designation_id=designation.id,
        )
    )
    db_session.commit()
    off_roster = client.get("/api/v1/timesheet/employee/G3000/2026/7/export")
    assert off_roster.status_code == 404
    assert off_roster.json()["error"]["code"] == "EMPLOYEE_NOT_ON_SHEET"


def test_the_static_query_types_match_the_runtime_constants():
    """``Sheet``/``Variant`` cannot be spelled from a tuple, so pin them here."""

    assert set(get_args(schemas.Sheet)) == set(svc.SHEETS)
    assert set(get_args(schemas.Variant)) == timesheet_xlsx.VARIANTS


# --------------------------------------------------------------------------- #
# the designation catalog
# --------------------------------------------------------------------------- #


def test_designations_list_and_reorder(client):
    body = client.get("/api/v1/timesheet/designations").json()
    assert len(body) == 16
    assert [d["rank_order"] for d in body] == list(range(1, 17))
    assert body[0]["name_en"] == "Prisons Director"
    assert body[-1]["sheet"] == "drivers"
    ids = [d["id"] for d in body]
    assert (
        client.put(
            "/api/v1/timesheet/designations/order", json={"ids": [ids[1], ids[0], *ids[2:]]}
        ).status_code
        == 200
    )
    assert client.get("/api/v1/timesheet/designations").json()[0]["name_en"] == "Ass. Director"
    assert (
        client.put("/api/v1/timesheet/designations/order", json={"ids": ids[:5]}).status_code == 422
    )


def test_the_static_designation_routes_are_not_shadowed_by_the_month_route(client):
    """Declared after ``/{year}/{month}`` they 422 on ``int("designations")``."""

    listed = client.get("/api/v1/timesheet/designations")
    assert listed.status_code == 200
    assert isinstance(listed.json(), list)
    ids = [d["id"] for d in listed.json()]
    assert client.put("/api/v1/timesheet/designations/order", json={"ids": ids}).status_code == 200


# --------------------------------------------------------------------------- #
# the capability gates
# --------------------------------------------------------------------------- #


def test_the_presets_split_reading_from_correcting():
    assert "timesheet.view" in permissions._OPERATOR_CAPS
    assert "timesheet.edit" not in permissions._OPERATOR_CAPS
    assert "timesheet.edit" in permissions._MANAGER_CAPS
    assert "timesheet.view" in permissions._MANAGER_CAPS  # inherited, never listed twice
    assert {"timesheet.view", "timesheet.edit"} <= permissions.ALL_CAPABILITIES
    assert {"timesheet.view", "timesheet.edit"} <= set(permissions.CAPABILITY_IDS)


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("PUT", "/api/v1/timesheet/designations/order", {"ids": [1]}),
        ("PUT", "/api/v1/timesheet/2026/7/cell", {"employee_id": "G1001", "day": 9, "code": "AB"}),
        ("PATCH", "/api/v1/timesheet/2026/7", {"post_count": 100}),
        ("POST", "/api/v1/timesheet/2026/7/close", None),
        ("POST", "/api/v1/timesheet/2026/7/reopen", None),
        ("POST", "/api/v1/timesheet/2026/7/start-ack", {"employee_id": "G1001"}),
        ("GET", "/api/v1/timesheet/2026/7/export", None),
    ],
)
def test_view_only_is_refused_every_edit_route(viewer_client, db_session, method, path, body):
    """The month export included: downloading it freezes the month."""

    _guard(db_session)
    response = viewer_client.request(method, path, json=body)
    assert response.status_code == 403
    assert response.json()["error"]["details"]["capability"] == "timesheet.edit"
    assert db_session.query(TimesheetPeriod).count() == 0


def test_view_only_reads_the_grid_and_takes_one_employee_home(viewer_client, db_session):
    _guard(db_session)
    assert viewer_client.get("/api/v1/timesheet/2026/7").status_code == 200
    assert viewer_client.get("/api/v1/timesheet/designations").status_code == 200
    assert viewer_client.get("/api/v1/timesheet/employee/G1001/2026/7/export").status_code == 200
    assert viewer_client.get("/api/v1/timesheet/2026/7").json()["closed_at"] is None


# --------------------------------------------------------------------------- #
# the absence supersede hook
# --------------------------------------------------------------------------- #


@pytest.fixture()
def generation_env(db_session, tmp_path, monkeypatch):
    """The two-line isolation every generation test uses.

    Unstubbed, ``generate_document`` drives Word COM through
    ``_pdf_executor.convert_docx_to_pdf`` (a 120 s process-pool wait); see
    ``backend/tests/test_document_generation_included_papers.py:33-63``.
    """

    from app.config import Settings
    from app.db.models import BookCategory
    from app.services import document_service

    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    db_session.add(BookCategory(id="HR", prefix="HR"))  # FK on Book.category_id
    db_session.commit()
    return document_service


def _sick_certificate(document_service, db, day=9):
    return document_service.generate_document(
        db,  # the only positional parameter
        employee_id="G1001",
        template_id="Leave Application Form",
        fields={
            "leave_type": "Sick Leave",
            "start_date": f"2026-07-{day:02d}",
            "end_date": f"2026-07-{day:02d}",
            "total_days": 1,
        },
        commit=True,
    )


def test_generating_a_sick_leave_clears_the_absence(client, db_session, generation_env):
    """Drives the real creation path — a hand-inserted Leave would not exercise the hook."""

    _guard(db_session)
    client.put(
        "/api/v1/timesheet/2026/7/cell", json={"employee_id": "G1001", "day": 9, "code": "AB"}
    )
    assert db_session.query(Absence).count() == 1
    result = _sick_certificate(generation_env, db_session)
    assert result.leave_id is not None
    assert db_session.query(Absence).count() == 0
    assert client.get("/api/v1/timesheet/2026/7").json()["rows"][0]["codes"][8] == "SL "


def test_regenerating_the_same_certificate_supersedes_it_again(client, db_session, generation_env):
    """The dedup branch reuses the row and never calls ``db.add`` — it must still fire."""

    _guard(db_session)
    first = _sick_certificate(generation_env, db_session)
    client.put(
        "/api/v1/timesheet/2026/7/cell", json={"employee_id": "G1001", "day": 9, "code": "AB"}
    )
    assert db_session.query(Absence).count() == 1

    again = _sick_certificate(generation_env, db_session)
    assert again.leave_id == first.leave_id  # proves the dedup path ran
    assert db_session.query(Absence).count() == 0


def test_a_leave_that_is_no_day_code_leaves_the_absence_alone(client, db_session, generation_env):
    """The gate is ``leave_code``, so a Passport Release supersedes nothing."""

    _guard(db_session)
    client.put(
        "/api/v1/timesheet/2026/7/cell", json={"employee_id": "G1001", "day": 9, "code": "AB"}
    )
    generation_env.generate_document(
        db_session,
        employee_id="G1001",
        template_id="Passport Release Form",
        fields={"request_date": "2026-07-09", "return_date": "2026-07-09"},
        commit=True,
    )
    assert db_session.query(Absence).count() == 1
