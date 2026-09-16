"""In-app signature placement editor — request/response models
(approval-signature-placement plan §8).

Request models use ``extra="forbid"``. Response models describe the plain
dataclasses ``signature_placement_service`` returns; they never accept an
image upload, role override, manager ID, or signer ID — identity always
comes from the server's own retained artifact, never client input.
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas._base import ORMBase

_SHA256_HEX = r"^[0-9a-f]{64}$"


def _require_finite(value: float) -> float:
    if isinstance(value, bool) or not math.isfinite(value):
        raise ValueError("must be a finite number")
    return value


class SignaturePositionRequest(BaseModel):
    """``PUT /documents/{document_id}/signatures/{signature_id}/position``."""

    model_config = ConfigDict(extra="forbid")

    signature_revision: int = Field(ge=0)
    package_revision: int = Field(ge=0)
    source_sha256: str = Field(pattern=_SHA256_HEX)
    page: int = Field(ge=1)
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)

    @field_validator("x", "y")
    @classmethod
    def _finite(cls, value: float) -> float:
        return _require_finite(value)


class SignatureIdentifyRequest(BaseModel):
    """``POST /documents/{document_id}/signature-identifications``."""

    model_config = ConfigDict(extra="forbid")

    signature_revision: int = Field(ge=0)
    package_revision: int = Field(ge=0)
    source_sha256: str = Field(pattern=_SHA256_HEX)
    candidate_id: str = Field(min_length=1, max_length=128)


class SignaturePageRead(BaseModel):
    page: int
    width_pt: float
    height_pt: float


class SignatureRead(BaseModel):
    id: str
    role: Literal["manager", "employee", "submitter"]
    page: int | None
    x: float | None
    y: float | None
    width_pt: float | None
    height_pt: float | None
    default_page: int | None = None
    default_x: float | None = None
    default_y: float | None = None
    image_url: str


class LegacyCandidateRead(BaseModel):
    candidate_id: str
    width_emu: int
    height_emu: int
    thumbnail_url: str


class SignatureEditorRead(BaseModel):
    document_id: int
    version_id: int
    signature_revision: int
    package_revision: int
    source_sha256: str | None
    can_adjust: bool
    can_identify: bool
    unavailable_code: str | None
    measured: bool
    pdf_url: str | None
    pages: list[SignaturePageRead]
    signatures: list[SignatureRead]
    candidates: list[LegacyCandidateRead] | None


class SignatureHistoryItemRead(ORMBase):
    revision: int
    action: Literal["initial", "identify", "move"]
    signature_id: str | None
    before_geometry: dict[str, float] | None
    after_geometry: dict[str, float] | None
    actor_user_id: int | None
    created_at: datetime
    pdf_download_url: str | None
    docx_download_url: str | None


class SignatureHistoryRead(BaseModel):
    items: list[SignatureHistoryItemRead]
