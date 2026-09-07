"""Vehicle-domain licence OCR: assist-only, reviewed-before-applied.

Independent of the unrelated `permits.edit` capability — see
`api/v1/vehicles.py::scan_vehicle_licence`. Reuses the shared OCR pipeline and
the (additively extended) `extract_vehicle_licence` parser; never invents
values, and an unavailable engine or unreadable upload returns an explicit,
non-fabricated result instead of a masquerading error.
"""

from __future__ import annotations

from app.api.errors import ValidationFailedError
from app.core.extraction.ocr import (
    OCR_GATE,
    InvalidImageError,
    OcrUnavailableError,
    ocr_bytes_to_text,
)
from app.core.extraction.vehicle_licence import extract_vehicle_licence
from app.core.vehicle_plate import parse_plate
from app.schemas.vehicle import VehicleProfileScan


def scan_vehicle_profile(data: bytes) -> VehicleProfileScan:
    """OCR a licence image/PDF and return reviewable suggested vehicle fields."""
    try:
        with OCR_GATE:
            text = ocr_bytes_to_text(data)
    except OcrUnavailableError:
        return VehicleProfileScan(warnings=["OCR_UNAVAILABLE"])
    except InvalidImageError as exc:
        raise ValidationFailedError("VEHICLE_SCAN_INVALID_IMAGE", str(exc)) from exc

    fields = extract_vehicle_licence(text)
    if not fields:
        return VehicleProfileScan(warnings=["OCR_NO_FIELDS"])

    plate_code: str | None = None
    plate_number: str | None = None
    unmapped: dict[str, str] = {}
    if "plate_code" in fields and "plate_number" in fields:
        plate_code, plate_number = fields["plate_code"], fields["plate_number"]
    elif raw_plate := fields.get("plate_no"):
        parsed = parse_plate(raw_plate)
        if parsed is not None:
            plate_code, plate_number = parsed
        else:
            unmapped["plate_no"] = raw_plate

    # A combined "Model: Toyota Camry" label (no separate Make:) is kept only
    # as unmapped free text unless a distinct `model` field was also derived —
    # splitting a make from a model without an explicit label would guess.
    if "make_model" in fields and "make" not in fields:
        unmapped["make_model"] = fields["make_model"]

    model_year: int | None = None
    if raw_year := fields.get("model_year"):
        try:
            model_year = int(raw_year)
        except ValueError:
            unmapped["model_year"] = raw_year

    type_en = fields.get("vehicle_type")
    class_en = fields.get("plate_category")

    scan = VehicleProfileScan(
        plate_code=plate_code,
        plate_number=plate_number,
        traffic_code=fields.get("traffic_no"),
        vin=fields.get("vin"),
        make=fields.get("make"),
        model=fields.get("model"),
        model_year=model_year,
        colour=fields.get("colour"),
        type_ar=fields.get("type_ar"),
        type_en=type_en,
        class_ar=fields.get("class_ar"),
        class_en=class_en,
        license_start=fields.get("license_start"),
        license_expiry=fields.get("license_expiry") or fields.get("reg_expiry"),
        insurance_expiry=fields.get("insurance_expiry"),
        unmapped=unmapped,
        warnings=["OCR_REVIEW_REQUIRED"],
    )
    return scan
