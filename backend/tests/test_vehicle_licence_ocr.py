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
    assert f["plate_emirate"] == "Dubai"
    assert f["plate_category"] == "Private"
    assert f["traffic_no"] == "12345678"
    assert f["make_model"] == "Toyota Camry"
    assert f["vehicle_type"] == "Sedan"
    assert f["colour"] == "White"
    assert f["reg_expiry"] == "2027-03-14"


def test_empty_text_returns_empty_dict() -> None:
    assert extract_vehicle_licence("") == {}
