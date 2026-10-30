"""Generate vehicle letters through the Records document pipeline."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import AppError, ValidationFailedError
from app.core.vehicle_letters import (
    FineLine,
    accident_letter_fields,
    fines_letter_fields,
    maintenance_request_body,
    odometer_form_fields,
)
from app.db.models import Book, Document, Employee, User, VehicleMaintenanceRequest
from app.db.repos.audit_repo import append_audit
from app.schemas.vehicle import (
    LetterResult,
    VehicleMaintenanceRequestCreate,
    VehicleMaintenanceRequestResult,
)
from app.services import document_service, recipient_service, settings_service, vehicle_service


def _letter_result(
    generated: document_service.GenerationResult,
) -> LetterResult:
    if generated.book_id is None:
        raise AppError(
            "BOOK_CATEGORY_MISSING",
            "The vehicle letter book category is not configured.",
        )
    primary = generated.documents[0]
    return LetterResult(
        book_id=generated.book_id,
        document_id=primary.document_id,
        ref_number=generated.ref_number,
        pdf_available=primary.pdf_path is not None,
    )


def _existing_accident_letter(
    db: Session,
    book_id: int,
) -> LetterResult:
    book = db.get(Book, book_id)
    if book is None or book.category_id != "VA":
        raise AppError(
            "ACCIDENT_LETTER_BOOK_INVALID",
            "The accident's linked vehicle accident book does not exist.",
            details={"book_id": book_id},
        )

    primary = db.scalar(
        select(Document)
        .where(
            Document.ref_number == book.ref_number,
            Document.template_id == "Vehicle Accident Report",
            Document.role == "primary",
        )
        .order_by(Document.id)
        .limit(1)
    )
    if primary is None:
        raise AppError(
            "ACCIDENT_LETTER_DOCUMENT_MISSING",
            "The accident's linked book has no primary vehicle accident document.",
            details={"book_id": book.id, "ref_number": book.ref_number},
        )

    return LetterResult(
        book_id=book.id,
        document_id=primary.id,
        ref_number=book.ref_number,
        pdf_available=primary.pdf_path is not None,
    )


def generate_fines_letter(
    db: Session,
    vehicle_id: int,
    *,
    fine_ids: list[int],
    hide_names: bool,
    user: User,
) -> LetterResult:
    """Generate and file a fines letter for fines owned by one vehicle."""
    vehicle = vehicle_service.require_active_vehicle(db, vehicle_id)
    requested_ids = set(fine_ids)
    selected = [fine for fine in vehicle.fines if fine.id in requested_ids]
    found_ids = {fine.id for fine in selected}
    if missing_ids := requested_ids - found_ids:
        raise ValidationFailedError(
            "FINE_NOT_ON_VEHICLE",
            "Every selected fine must belong to the vehicle.",
            vehicle_id=vehicle_id,
            fine_ids=sorted(missing_ids),
        )
    document_service.authorize_interactive_generation(db, user, "Vehicle Fines")

    selected.sort(key=lambda fine: (fine.date, fine.id))
    lines = [
        FineLine(
            seq=seq,
            employee_name_ar=(fine.employee.name_ar if fine.employee is not None else None),
            employee_name_en=(fine.employee.name_en if fine.employee is not None else None),
            g_number=fine.employee.id if fine.employee is not None else None,
            date=fine.date,
            amount_fils=fine.amount_fils,
            black_points=fine.black_points,
        )
        for seq, fine in enumerate(selected, start=1)
    ]
    fields = fines_letter_fields(
        plate_label=vehicle_service.plate_label(vehicle),
        fines=lines,
        hide_names=hide_names,
        today=date.today(),
    )
    generated = document_service.generate_document(
        db,
        employee_id=None,
        template_id="Vehicle Fines",
        fields=fields,
        commit=True,
        current_user=user,
    )
    result = _letter_result(generated)
    vehicle_service._audit(
        db,
        "letter.generated",
        vehicle_id,
        user.email,
        {
            "template_id": "Vehicle Fines",
            "book_id": result.book_id,
            "document_id": result.document_id,
            "ref_number": result.ref_number,
            "fine_ids": [fine.id for fine in selected],
            "hide_names": hide_names,
        },
    )
    return result


def generate_accident_letter(
    db: Session,
    vehicle_id: int,
    accident_id: int,
    *,
    user: User,
) -> LetterResult:
    """Generate, file, and link an official accident letter."""
    vehicle = vehicle_service.require_active_vehicle(db, vehicle_id)
    accident = next(
        (row for row in vehicle.accidents if row.id == accident_id),
        None,
    )
    if accident is None:
        raise ValidationFailedError(
            "ACCIDENT_NOT_ON_VEHICLE",
            "The accident must belong to the vehicle.",
            vehicle_id=vehicle_id,
            accident_id=accident_id,
        )
    document_service.authorize_interactive_generation(db, user, "Vehicle Accident Report")

    if accident.letter_book_id is not None:
        return _existing_accident_letter(db, accident.letter_book_id)

    employee = accident.employee
    employee_label = None
    if employee is not None:
        employee_label = employee.name_ar or employee.name_en
    fields = accident_letter_fields(
        plate_label=vehicle_service.plate_label(vehicle),
        vehicle_type_ar=vehicle.type_ar,
        vin=vehicle.vin,
        site_ar=vehicle.site.name_ar,
        date=accident.date,
        time=accident.time,
        employee_label=employee_label,
        location_ar=accident.location_ar,
        police_ref=accident.police_ref,
        damage_cost=accident.damage_cost,
        status=accident.status,
        description_ar=accident.description_ar,
        today=date.today(),
    )
    generated = document_service.generate_document(
        db,
        employee_id=None,
        template_id="Vehicle Accident Report",
        fields=fields,
        commit=True,
        current_user=user,
    )
    result = _letter_result(generated)
    accident.letter_book_id = result.book_id
    db.commit()
    vehicle_service._audit(
        db,
        "letter.generated",
        vehicle_id,
        user.email,
        {
            "template_id": "Vehicle Accident Report",
            "book_id": result.book_id,
            "document_id": result.document_id,
            "ref_number": result.ref_number,
            "accident_id": accident.id,
        },
    )
    return result


def generate_odometer_form(
    db: Session,
    *,
    month: str,
    vehicle_ids: Sequence[int] | None,
    user: User,
) -> LetterResult:
    """File the monthly fleet mileage and maintenance register as a GS book."""
    document_service.authorize_interactive_generation(
        db, user, "Vehicle Mileage Log", classification_code="11/1"
    )
    report = vehicle_service.odometer_month(db, month, vehicle_ids=vehicle_ids)
    if not report.rows:
        raise ValidationFailedError(
            "ODOMETER_NO_VEHICLES",
            "Select at least one active vehicle to generate the monthly mileage log.",
        )
    fields = odometer_form_fields(month=month, rows=report.rows, today=date.today())
    generated = document_service.generate_document(
        db,
        employee_id=None,
        template_id="Vehicle Mileage Log",
        fields=fields,
        classification_code="11/1",
        commit=True,
        current_user=user,
    )
    result = _letter_result(generated)
    vehicle_service._audit(
        db,
        "letter.generated",
        result.book_id,
        user.email,
        {
            "template_id": "Vehicle Mileage Log",
            "book_id": result.book_id,
            "document_id": result.document_id,
            "ref_number": result.ref_number,
            "month": month,
            "vehicle_ids": [row.vehicle_id for row in report.rows],
        },
        entity_type="book",
    )
    return result


def create_maintenance_request(
    db: Session,
    vehicle_id: int,
    payload: VehicleMaintenanceRequestCreate,
    *,
    user: User,
) -> VehicleMaintenanceRequestResult:
    """Generate and link a contractor book in the request's single transaction."""
    vehicle = vehicle_service.require_active_vehicle(db, vehicle_id)
    document_service.authorize_interactive_generation(
        db, user, "General Book", classification_code="11/1"
    )
    contractor_id = settings_service.get_vehicle_maintenance_contractor_id(db)
    contractor_name = (
        recipient_service.resolve_name(db, contractor_id) if contractor_id is not None else None
    )
    if contractor_name is None:
        raise ValidationFailedError(
            "MAINTENANCE_CONTRACTOR_MISSING",
            "Set the maintenance contractor in vehicle settings before requesting maintenance.",
        )
    vehicle_service._validate_employee(db, payload.employee_id)
    employee = db.get(Employee, payload.employee_id) if payload.employee_id is not None else None
    driver = (
        f"{employee.name_ar or employee.name_en} ({employee.id})" if employee is not None else None
    )
    odometer = (
        payload.odometer_km
        if "odometer_km" in payload.model_fields_set
        else vehicle_service.current_odometer_km(vehicle)
    )
    last = max(vehicle.maintenance, key=lambda item: (item.date, item.id), default=None)
    plate = vehicle_service.plate_label(vehicle).replace("\\", "/")
    body = maintenance_request_body(
        plate=plate,
        vehicle_type=vehicle.type_ar,
        make_model=" ".join(part for part in (vehicle.make, vehicle.model) if part),
        year=vehicle.model_year,
        vin=vehicle.vin,
        site=vehicle.site.name_ar or vehicle.site.name_en,
        driver=driver,
        odometer_km=odometer,
        last_maintenance=vehicle_service.maintenance_read(last) if last is not None else None,
        work_type=payload.type,
        description=payload.description,
    )
    row = VehicleMaintenanceRequest(
        vehicle_id=vehicle_id,
        employee_id=payload.employee_id,
        type=payload.type,
        description=payload.description,
        odometer_km=odometer,
        created_by_user_id=user.id,
    )
    try:
        generated = document_service.generate_document(
            db,
            employee_id=None,
            template_id="General Book",
            fields={
                "subject": f"طلب صيانة مركبة — {plate}",
                "recipient_id": contractor_id,
                "body": body,
            },
            commit=True,
            classification_code="11/1",
            current_user=user,
            defer_commit=True,
        )
        letter = _letter_result(generated)
        row.book_id = letter.book_id
        db.add(row)
        db.flush()
        append_audit(
            db,
            action="letter.generated",
            entity_type="book",
            entity_id=letter.book_id,
            actor=user.email,
            payload={
                "template_id": "General Book",
                "book_id": letter.book_id,
                "document_id": letter.document_id,
                "ref_number": letter.ref_number,
                "vehicle_id": vehicle_id,
                "maintenance_request_id": row.id,
            },
            ensure_ascii=True,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return VehicleMaintenanceRequestResult(
        request=vehicle_service.maintenance_request_read(db, row), letter=letter
    )
