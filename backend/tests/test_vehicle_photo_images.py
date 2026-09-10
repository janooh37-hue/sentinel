from __future__ import annotations

import io

import pytest
from PIL import Image

from app.api.errors import ValidationFailedError
from app.core import vehicle_photos
from app.core.vehicle_photos import (
    MAX_DIMENSION,
    PREVIEW_LONGEST_EDGE,
    THUMBNAIL_LONGEST_EDGE,
    process_photo,
)


def _encode(image: Image.Image, image_format: str, **options: object) -> bytes:
    output = io.BytesIO()
    image.save(output, format=image_format, **options)
    return output.getvalue()


def _open(data: bytes) -> Image.Image:
    with Image.open(io.BytesIO(data)) as opened:
        opened.load()
        return opened.copy()


def test_process_photo_normalizes_exif_orientation_and_strips_metadata() -> None:
    source = Image.new("RGB", (3, 2))
    source.putdata(
        [
            (255, 0, 0),
            (0, 255, 0),
            (0, 0, 255),
            (255, 255, 0),
            (255, 0, 255),
            (0, 255, 255),
        ]
    )
    exif = Image.Exif()
    exif[274] = 6

    processed = process_photo(_encode(source, "PNG", exif=exif))

    assert (processed.width, processed.height) == (2, 3)
    with _open(processed.full) as full:
        assert full.mode == "RGB"
        assert full.size == (2, 3)
        assert list(full.getdata()) == [
            (255, 255, 0),
            (255, 0, 0),
            (255, 0, 255),
            (0, 255, 0),
            (0, 255, 255),
            (0, 0, 255),
        ]
        assert not full.getexif()
        assert "icc_profile" not in full.info
        assert "xmp" not in full.info


def test_process_photo_preserves_alpha_and_exact_transparent_pixels() -> None:
    source = Image.new("RGBA", (2, 2))
    pixels = [
        (255, 0, 0, 0),
        (0, 255, 0, 64),
        (0, 0, 255, 128),
        (12, 34, 56, 255),
    ]
    source.putdata(pixels)

    processed = process_photo(_encode(source, "PNG"))

    with _open(processed.full) as full:
        assert full.mode == "RGBA"
        assert list(full.getdata()) == pixels


def test_content_hash_is_exact_normalized_pixel_identity() -> None:
    source = Image.new("RGB", (5, 4), (12, 34, 56))
    png = _encode(source, "PNG")
    lossless_webp = _encode(source, "WEBP", lossless=True, exact=True)

    from_png = process_photo(png)
    from_webp = process_photo(lossless_webp)
    repeated = process_photo(png)

    assert from_png.content_hash == from_webp.content_hash
    assert from_png == repeated

    changed = source.copy()
    changed.putpixel((4, 3), (12, 34, 57))
    assert process_photo(_encode(changed, "PNG")).content_hash != from_png.content_hash

    opaque_alpha = source.convert("RGBA")
    assert process_photo(_encode(opaque_alpha, "PNG")).content_hash != from_png.content_hash


def test_variants_preserve_complete_frame_dimensions_without_upscaling() -> None:
    source = Image.new("RGB", (800, 200), (0, 0, 0))
    source.paste((255, 0, 0), (0, 0, 400, 100))
    source.paste((0, 255, 0), (400, 0, 800, 100))
    source.paste((0, 0, 255), (0, 100, 400, 200))
    source.paste((255, 255, 0), (400, 100, 800, 200))

    processed = process_photo(_encode(source, "PNG"))

    assert (processed.width, processed.height) == (800, 200)
    expected_sizes = {
        processed.thumbnail: (THUMBNAIL_LONGEST_EDGE, 40),
        processed.preview: (PREVIEW_LONGEST_EDGE, 160),
        processed.full: (800, 200),
    }
    for encoded, expected_size in expected_sizes.items():
        with _open(encoded) as variant:
            assert variant.size == expected_size
            corners = (
                variant.getpixel((1, 1)),
                variant.getpixel((variant.width - 2, 1)),
                variant.getpixel((1, variant.height - 2)),
                variant.getpixel((variant.width - 2, variant.height - 2)),
            )
            assert corners[0][0] > 200 and max(corners[0][1:]) < 50
            assert corners[1][1] > 200 and corners[1][0] < 50 and corners[1][2] < 50
            assert corners[2][2] > 200 and max(corners[2][:2]) < 50
            assert min(corners[3][:2]) > 200 and corners[3][2] < 50

    small = process_photo(_encode(Image.new("RGB", (100, 50), "white"), "PNG"))
    for encoded in (small.thumbnail, small.preview, small.full):
        with _open(encoded) as variant:
            assert variant.size == (100, 50)


def test_smaller_metadata_free_webp_is_kept_as_the_full_variant() -> None:
    source = Image.new("RGB", (128, 128))
    source.putdata(
        [
            ((x * 17 + y * 29) % 256, (x * 37 + y * 11) % 256, (x * 7 + y * 43) % 256)
            for y in range(source.height)
            for x in range(source.width)
        ]
    )
    efficient_webp = _encode(source, "WEBP", quality=72, method=6)

    processed = process_photo(efficient_webp)

    assert processed.full == efficient_webp


@pytest.mark.parametrize(
    ("data", "expected_code"),
    [
        (b"", "VEHICLE_PHOTO_EMPTY"),
        (b"not an image", "VEHICLE_PHOTO_INVALID"),
    ],
)
def test_process_photo_rejects_invalid_input(data: bytes, expected_code: str) -> None:
    with pytest.raises(ValidationFailedError) as caught:
        process_photo(data)

    assert caught.value.code == expected_code


def test_process_photo_rejects_upload_over_byte_limit() -> None:
    oversized = b"x" * (vehicle_photos.MAX_UPLOAD_BYTES + 1)

    with pytest.raises(ValidationFailedError) as caught:
        process_photo(oversized)

    assert caught.value.code == "VEHICLE_PHOTO_TOO_LARGE"
    assert caught.value.details["max_bytes"] == vehicle_photos.MAX_UPLOAD_BYTES


def test_process_photo_rejects_unsupported_and_animated_images() -> None:
    gif = _encode(Image.new("RGB", (4, 4), "red"), "GIF")
    with pytest.raises(ValidationFailedError) as unsupported:
        process_photo(gif)
    assert unsupported.value.code == "VEHICLE_PHOTO_UNSUPPORTED_FORMAT"

    first = Image.new("RGB", (4, 4), "red")
    second = Image.new("RGB", (4, 4), "blue")
    animated = _encode(
        first,
        "WEBP",
        save_all=True,
        append_images=[second],
        duration=100,
        loop=0,
        lossless=True,
    )
    with pytest.raises(ValidationFailedError) as animated_error:
        process_photo(animated)
    assert animated_error.value.code == "VEHICLE_PHOTO_ANIMATED"


def test_process_photo_rejects_unsafe_dimensions_and_decompression_bombs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    too_wide = _encode(Image.new("RGB", (MAX_DIMENSION + 1, 1), "white"), "PNG")
    with pytest.raises(ValidationFailedError) as oversized:
        process_photo(too_wide)
    assert oversized.value.code == "VEHICLE_PHOTO_DIMENSIONS_TOO_LARGE"

    tiny = _encode(Image.new("RGB", (2, 2), "white"), "PNG")
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1)
    with pytest.raises(ValidationFailedError) as bomb:
        process_photo(tiny)
    assert bomb.value.code == "VEHICLE_PHOTO_INVALID"
