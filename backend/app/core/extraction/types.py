from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class DocType(StrEnum):
    EMIRATES_ID = "emirates_id"
    PASSPORT = "passport"
    BANK_IBAN = "bank_iban"
    SICK_LEAVE = "sick_leave"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class ExtractedField:
    key: str
    value: str
    confidence: float  # 0..1
    source_snippet: str = ""


@dataclass(frozen=True)
class Extraction:
    doc_type: DocType
    doc_type_confidence: float
    fields: list[ExtractedField]
    alternatives: list[DocType] = field(default_factory=list)
    raw_text: str = ""
    language: str = "en"

    def field(self, key: str) -> ExtractedField | None:
        return next((f for f in self.fields if f.key == key), None)
