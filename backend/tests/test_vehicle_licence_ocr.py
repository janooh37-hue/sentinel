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
