"""Shared harness for fleet-reporter tests (scoped role, authoring, chain).

Real DOCX rendering and filing; PDF conversion and Word are stubbed. Requests
go through the real ``get_current_user`` so the scoped-role route policy runs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import Session

from app.api.deps import get_optional_user
from app.config import Settings
from app.core.roles import ADMIN_ROLE, FLEET_REPORTER_ROLE, MANAGER_ROLE, OPERATOR_ROLE
from app.db.models import (
    Book,
    BookCategory,
    Employee,
    Manager,
    User,
    Vehicle,
    VehicleAccident,
    VehicleFine,
    VehicleSite,
)
from app.db.session import get_db
from app.main import create_app
from app.services import (
    artifact_service,
    book_service,
    document_service,
    included_papers_service,
    vehicle_letter_service,
)


@dataclass
class FleetEnv:
    db: Session
    settings: Settings
    reporter: User  # fleet reporter with line manager ``line``
    other_reporter: User  # second fleet reporter, same line manager
    line: User  # line manager (manager role, Manager row)
    branch: User  # branch manager (manager role, Manager row)
    operator: User
    admin: User
    vehicle: Vehicle
    fines: tuple[VehicleFine, VehicleFine]
    accident: VehicleAccident

    def client(self, user: User | None) -> TestClient:
        """A client acting as ``user`` through the real route policy."""
        app = create_app()
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_optional_user] = lambda: user
        return TestClient(app, raise_server_exceptions=True)

    def book(self, book_id: int) -> Book:
        row = self.db.get(Book, book_id)
        assert row is not None
        self.db.refresh(row)
        return row


def _user(
    db: Session,
    *,
    email: str,
    role: str,
    employee_id: str | None = None,
    line_manager_user_id: int | None = None,
) -> User:
    row = User(
        email=email,
        password_hash="x",
        role=role,
        status="active",
        employee_id=employee_id,
        display_name=email.split("@")[0],
        line_manager_user_id=line_manager_user_id,
    )
    db.add(row)
    db.flush()
    return row


@pytest.fixture()
def fleet_env(api_db: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> FleetEnv:
    db = api_db
    settings = Settings(data_dir=tmp_path / "data", templates_dir=document_service._TEMPLATES_DIR)
    for module in (document_service, artifact_service, book_service, included_papers_service):
        monkeypatch.setattr(module, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda _path: None)
    render_signed = document_service.render_signed_artifact
    monkeypatch.setattr(
        document_service,
        "render_signed_artifact",
        lambda *args, **kwargs: render_signed(*args, **kwargs, converter=lambda _: None),
    )
    signature = tmp_path / "signature.png"
    Image.new("RGBA", (100, 40), (0, 0, 0, 255)).save(signature)
    monkeypatch.setattr(
        book_service.user_signature_service, "resolve_signature", lambda _user: signature
    )

    for category_id in ("GS", "VF", "VA"):
        if db.get(BookCategory, category_id) is None:
            db.add(BookCategory(id=category_id, prefix=category_id, name_en=category_id))
    employees = [
        Employee(id=emp_id, name_en=name, name_ar=name)
        for emp_id, name in (
            ("G7001", "Fleet Reporter"),
            ("G7002", "Other Reporter"),
            ("G7101", "Line Manager"),
            ("G7201", "Branch Manager"),
            ("G7301", "Operator"),
            ("G7401", "Fined Driver"),
        )
    ]
    db.add_all(employees)
    db.flush()
    line = _user(db, email="line@fleet.test", role=MANAGER_ROLE, employee_id="G7101")
    branch = _user(db, email="branch@fleet.test", role=MANAGER_ROLE, employee_id="G7201")
    db.add_all(
        [
            Manager(name_en="Line Manager", name_ar="المدير المباشر", user_id=line.id, active=True),
            Manager(name_en="Branch Manager", name_ar="مدير الفرع", user_id=branch.id, active=True),
        ]
    )
    reporter = _user(
        db,
        email="reporter@fleet.test",
        role=FLEET_REPORTER_ROLE,
        employee_id="G7001",
        line_manager_user_id=line.id,
    )
    other_reporter = _user(
        db,
        email="other@fleet.test",
        role=FLEET_REPORTER_ROLE,
        employee_id="G7002",
        line_manager_user_id=line.id,
    )
    operator = _user(db, email="operator@fleet.test", role=OPERATOR_ROLE, employee_id="G7301")
    admin = _user(db, email="admin@fleet.test", role=ADMIN_ROLE)

    site = VehicleSite(name_ar="موقع", name_en="Site")
    db.add(site)
    db.flush()
    vehicle = Vehicle(
        plate_code="14",
        plate_number="58216",
        traffic_code="1180021637",
        type_ar="تويوتا",
        type_en="Toyota",
        class_ar="خفيفة",
        class_en="Light",
        vin="JT111111111111111",
        site_id=site.id,
        license_start=date(2026, 1, 1),
        license_expiry=date(2099, 12, 31),
    )
    db.add(vehicle)
    db.flush()
    fines = tuple(
        VehicleFine(
            vehicle_id=vehicle.id,
            employee_id="G7401",
            date=date(2026, 7, day),
            time="08:15",
            amount_fils=34900,
            black_points=4,
            source="manual",
            location="أبوظبي",
            created_by_user_id=admin.id,
        )
        for day in (12, 15)
    )
    accident = VehicleAccident(
        vehicle_id=vehicle.id,
        employee_id="G7401",
        date=date(2026, 8, 17),
        time="14:35",
        location_ar="البوابة",
        location_en="Gate",
        description_ar="اصطدام",
        description_en="Collision",
        police_ref="AUH-1",
        damage_cost=2600,
        status="open",
        photo_file_ids=[],
    )
    db.add_all([*fines, accident])
    db.commit()
    return FleetEnv(
        db=db,
        settings=settings,
        reporter=reporter,
        other_reporter=other_reporter,
        line=line,
        branch=branch,
        operator=operator,
        admin=admin,
        vehicle=vehicle,
        fines=(fines[0], fines[1]),
        accident=accident,
    )


def general_book(
    env: FleetEnv, user: User, classification_code: str = "11/1", **kwargs: Any
) -> Book:
    """Publish a rich-editor General Book as ``user`` (service layer)."""
    document_service.authorize_interactive_generation(
        env.db, user, "General Book", classification_code=classification_code
    )
    result = document_service.generate_document(
        env.db,
        employee_id=None,
        template_id="General Book",
        fields={"subject": "Fleet request", "body": "<p>Request</p>", **kwargs.pop("fields", {})},
        commit=True,
        classification_code=classification_code,
        current_user=user,
        record_access_user=user,
        converter=lambda _: None,
        **kwargs,
    )
    assert result.book_id is not None
    return env.book(result.book_id)


def fines_letter(env: FleetEnv, user: User) -> Book:
    result = vehicle_letter_service.generate_fines_letter(
        env.db,
        env.vehicle.id,
        fine_ids=[fine.id for fine in env.fines],
        hide_names=False,
        user=user,
    )
    return env.book(result.book_id)


def accident_letter(env: FleetEnv, user: User) -> Book:
    result = vehicle_letter_service.generate_accident_letter(
        env.db, env.vehicle.id, env.accident.id, user=user
    )
    return env.book(result.book_id)


def submit(env: FleetEnv, book: Book, user: User) -> Book:
    book_service.submit_for_approval(
        env.db,
        book.id,
        priority="Normal",
        approver_user_id=None,
        reviewer_user_ids=[],
        submitted_by_user_id=user.id,
    )
    return env.book(book.id)


def current_version_id(book: Book) -> int:
    return book.versions[-1].id
