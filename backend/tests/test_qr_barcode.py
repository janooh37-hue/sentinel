from __future__ import annotations

import io
from datetime import date

import pytest
from PIL import Image

from app.core.qr import (
    Decoded,
    barcode_payload,
    decode_codes,
    make_aztec_png,
    parse_barcode,
    qr_decode_available,
)

pytestmark = pytest.mark.skipif(not qr_decode_available(), reason="zxing-cpp is unavailable")


def test_barcode_payload_round_trip_and_shape_validation() -> None:
    payload = barcode_payload("gs-1/Ab", date(2026, 9, 21))

    assert payload == "GS-1/AB+20260921"
    assert parse_barcode(payload) == ("GS-1/AB", date(2026, 9, 21))
    assert parse_barcode("GSSG:GS-1/AB+20260921") is None
    assert parse_barcode("GS-1/AB+2026921") is None
    assert parse_barcode("GS-1/AB+20260230") is None


def test_decode_codes_reads_real_code39() -> None:
    import zxingcpp

    payload = "1/5/141+20260921"
    image = zxingcpp.create_barcode(payload, zxingcpp.BarcodeFormat.Code39).to_image()

    assert decode_codes(image) == [Decoded("1/5/141", date(2026, 9, 21), "code39")]


def test_decode_codes_keeps_existing_aztec_contract() -> None:
    image = Image.open(io.BytesIO(make_aztec_png("GS-0333")))

    assert decode_codes(image) == [Decoded("GS-0333", None, "aztec")]
