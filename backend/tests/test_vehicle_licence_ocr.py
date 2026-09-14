from app.core.extraction.vehicle_licence import extract_vehicle_licence

SAMPLE = """
United Arab Emirates  Ministry of Interior
Vehicle Registration Card
Owner: MOHAMMED AL FARSI
Nationality: Egypt
Place of Issue: Dubai
Traffic Plate No: A 45213
Plate Category: Private
T.C. No: 12345678
Model: Toyota Camry
Type: Sedan
Colour: White
Expiry Date: 14/03/2027
"""


def test_extracts_core_fields() -> None:
    f = extract_vehicle_licence(SAMPLE)
    assert f["plate_no"] == "A 45213"
    # Emirate is normalised to its canonical Arabic name (what the dropdown
    # stores and the Arabic 1/5 letter renders), not the raw OCR text.
    assert f["plate_emirate"] == "دبي"
    assert f["plate_category"] == "Private"
    assert f["traffic_no"] == "12345678"
    assert f["make_model"] == "Toyota Camry"
    assert f["vehicle_type"] == "Sedan"
    assert f["colour"] == "White"
    assert f["owner_name"] == "MOHAMMED AL FARSI"
    assert f["reg_expiry"] == "2027-03-14"


def test_empty_text_returns_empty_dict() -> None:
    assert extract_vehicle_licence("") == {}


def test_emirate_normalises_english_variants() -> None:
    for place, canonical in [
        ("Abu Dhabi", "أبوظبي"),
        ("SHARJAH", "الشارقة"),
        ("Ras Al Khaimah", "رأس الخيمة"),
        ("Umm Al Quwain", "أم القيوين"),
    ]:
        f = extract_vehicle_licence(f"Place of Issue: {place}\n")
        assert f["plate_emirate"] == canonical


def test_unrecognised_emirate_is_dropped() -> None:
    # An unknown place-of-issue must not leak raw text into the register — the
    # operator picks from the dropdown instead.
    f = extract_vehicle_licence("Place of Issue: Doha\n")
    assert "plate_emirate" not in f


def test_registration_and_insurance_expiry_disambiguated_in_either_order() -> None:
    order_a = "Registration Expiry: 01/01/2027\nInsurance Expiry: 01/12/2026\n"
    order_b = "Insurance Expiry: 01/12/2026\nRegistration Expiry: 01/01/2027\n"
    for text in (order_a, order_b):
        fields = extract_vehicle_licence(text)
        assert fields["license_expiry"] == "2027-01-01"
        assert fields["insurance_expiry"] == "2026-12-01"


def test_explicit_make_model_year_and_vin_extracted_separately() -> None:
    text = (
        "Make: Toyota\n"
        "Model: Land Cruiser\n"
        "Model Year: 2024\n"
        "VIN: JTMHV05J904123456\n"
        "Registration Date: 01/01/2020\n"
    )
    fields = extract_vehicle_licence(text)
    assert fields["make"] == "Toyota"
    assert fields["model"] == "Land Cruiser"
    assert fields["model_year"] == "2024"
    assert fields["vin"] == "JTMHV05J904123456"
    assert fields["license_start"] == "2020-01-01"


def test_arabic_labels_and_arabic_indic_digits_are_recognized() -> None:
    text = (
        "الصنع: تويوتا\n"
        "الموديل: لاند كروزر\n"
        "سنة الصنع: 2024\n"
        "تأمين ينتهي: ٠١/١٢/٢٠٢٦\n"  # noqa: RUF001 — literal Arabic-Indic digits
        "انتهاء الترخيص: ٠١/٠١/٢٠٢٧\n"  # noqa: RUF001 — literal Arabic-Indic digits
    )
    fields = extract_vehicle_licence(text)
    assert fields["make"] == "تويوتا"
    assert fields["model"] == "لاند كروزر"
    assert fields["model_year"] == "2024"
    assert fields["insurance_expiry"] == "2026-12-01"
    assert fields["license_expiry"] == "2027-01-01"


def test_unlabelled_combined_make_model_stays_on_legacy_key_only() -> None:
    fields = extract_vehicle_licence("Some unrelated text with no vehicle facts.")
    assert fields == {}


def test_bare_expiry_label_without_registration_or_insurance_qualifier_is_unambiguous() -> None:
    # Preserves the original permit-scanning behavior: a bare "Expiry Date"
    # label (no "insurance"/"registration" qualifier) is not claimed by either
    # new disambiguated key.
    fields = extract_vehicle_licence("Expiry Date: 14/03/2027")
    assert fields["reg_expiry"] == "2027-03-14"
    assert "license_expiry" not in fields
    assert "insurance_expiry" not in fields


def test_insurance_only_expiry_is_not_claimed_as_license_expiry() -> None:
    fields = extract_vehicle_licence("Insurance Expiry: 12/03/2027")
    assert fields["insurance_expiry"] == "2027-03-12"
    assert "license_expiry" not in fields


def test_licence_only_expiry_is_read_from_its_explicit_label() -> None:
    fields = extract_vehicle_licence("Licence Expiry Date: 14/03/2027")
    assert fields["license_expiry"] == "2027-03-14"
    assert "insurance_expiry" not in fields
