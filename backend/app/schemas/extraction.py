from __future__ import annotations

from pydantic import BaseModel


class ExtractedFieldOut(BaseModel):
    key: str
    value: str
    confidence: float
    source_snippet: str = ""


class ExtractionResponse(BaseModel):
    id: int
    document_type: str
    document_type_confidence: float
    alternatives: list[str] = []
    fields: list[ExtractedFieldOut] = []
    matched_employee_id: str | None = None
    match_score: float = 0.0
    matched_employee_name_en: str | None = None
    matched_employee_name_ar: str | None = None
