from __future__ import annotations

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
    raise NotImplementedError("OCR document reading is not implemented")


__all__ = [
    "DocumentRead",
    "DocumentReader",
    "OcrPageEvidence",
    "TextSource",
    "read_document",
]
