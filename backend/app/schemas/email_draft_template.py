"""Plain-text email draft overrides; defaults and rendering remain client-side."""

from pydantic import BaseModel, ConfigDict, Field


class EmailDraftTemplateParts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str | None = None
    intro: str | None = None
    closing: str | None = None


class EmailDraftTemplatesRead(BaseModel):
    overrides: dict[str, EmailDraftTemplateParts] = Field(default_factory=dict)
    tokens: dict[str, list[str]]
