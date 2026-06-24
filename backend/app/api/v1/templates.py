"""Template metadata endpoints.

GET /templates           → list of 16 templates with summary metadata.
GET /templates/{id}/fields → meta + field schema for one template.

Template IDs contain spaces (e.g. "Leave Application Form"), so the path
parameter must be URL-decoded.  FastAPI handles this automatically.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.services.template_service import (
    TemplateDetailResponse,
    TemplateListResponse,
    get_template_fields,
    list_templates,
)

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("", response_model=TemplateListResponse)
def get_templates() -> TemplateListResponse:
    return list_templates()


@router.get("/{template_id}/fields", response_model=TemplateDetailResponse)
def get_template_detail(template_id: str) -> TemplateDetailResponse:
    # FastAPI URL-decodes path params automatically; spaces arrive as spaces.
    return get_template_fields(template_id)
