"""Generate vehicle letters through the Records document pipeline."""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import AppError, ValidationFailedError
from app.core.vehicle_letters import (
    FineLine,
    accident_letter_fields,
    fines_letter_fields,
)
from app.db.models import Book, Document, User
from app.schemas.vehicle import LetterResult
from app.services import document_service, vehicle_service


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
    vehicle = vehicle_service.get_vehicle(db, vehicle_id)
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

    selected.sort(key=lambda fine: (fine.date, fine.id))
    lines = [
        FineLine(
            seq=seq,
            employee_name_ar=(fine.employee.name_ar if fine.employee is not None else None),
            employee_name_en=(fine.employee.name_en if fine.employee is not None else None),
            g_number=fine.employee.id if fine.employee is not None else None,
            date=fine.date,
            amount=fine.amount,
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
    vehicle = vehicle_service.get_vehicle(db, vehicle_id)
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
