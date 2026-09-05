from __future__ import annotations

from contextlib import closing
from dataclasses import dataclass, field
from typing import Literal, Protocol

from app.core.extraction import ocr

TextSource = Literal["pdf_text", "ocr", "unavailable"]


@dataclass(frozen=True, slots=True)
class OcrPageEvidence:
    page_index: int
    text: str
    confidence: float
    language: str = "ara+eng"


@dataclass(frozen=True, slots=True)
class DocumentRead:
    text: str
    text_source: TextSource
    qr_refs: tuple[str, ...] = field(default_factory=tuple)
    ocr_pages: tuple[OcrPageEvidence, ...] = field(default_factory=tuple)
    unavailable_reason: str | None = None


class DocumentReader(Protocol):
    def __call__(self, raw: bytes) -> DocumentRead: ...


def read_document(raw: bytes) -> DocumentRead:
    with ocr.OCR_GATE:
        qr_refs = tuple(ocr.qr_refs_from_bytes(raw))
        if raw.startswith(b"%PDF"):
            layer = ocr.pdf_text_layer(raw)
            if sum(char.isalnum() for char in layer) >= 16:
                return DocumentRead(
                    text=layer,
                    text_source="pdf_text",
                    qr_refs=qr_refs,
                )
        pages: list[OcrPageEvidence] = []
        try:
            if raw.startswith(b"%PDF"):
                with closing(ocr.pdf_to_images(raw)) as images:
                    for index, image in enumerate(images):
                        with closing(image):
                            result = ocr.extract_text(image)
                        pages.append(
                            OcrPageEvidence(index, result.text, result.confidence, result.language)
                        )
            else:
                with closing(ocr.load_image(raw)) as image:
                    result = ocr.extract_text(image)
                pages.append(OcrPageEvidence(0, result.text, result.confidence, result.language))
        except ocr.OcrUnavailableError as exc:
            return DocumentRead(
                text="",
                text_source="unavailable",
                qr_refs=qr_refs,
                unavailable_reason=str(exc),
            )
        return DocumentRead(
            text="\n".join(page.text for page in pages),
            text_source="ocr",
            qr_refs=qr_refs,
            ocr_pages=tuple(pages),
        )


__all__ = [
    "DocumentRead",
    "DocumentReader",
    "OcrPageEvidence",
    "TextSource",
    "read_document",
]
