"""Permission Studio's redacted, non-mutating access contract."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class AccessModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Action(StrEnum):
    view = "view"
    create = "create"
    read = "read"
    edit = "edit"
    reset = "reset"
    delete = "delete"
    send = "send"
    manage = "manage"


class Resource(AccessModel):
    kind: Literal["capability", "service", "book", "notification_template", "email_template", "word_template", "editor_template"]
    id: str = Field(min_length=1, max_length=128)
    revision_id: int | None = Field(default=None, ge=1)


class Context(AccessModel):
    # Persisted categories use string identifiers (for example GS).
    category_id: str | int | None = None
    classification_id: int | None = None
    grade: str | None = None


class Patch(AccessModel):
    capability: str = Field(min_length=1, max_length=64)
    effect: Literal["grant", "deny"] | None = None
    expires_at: datetime | None = None


class LocalizedText(AccessModel):
    en: str
    ar: str


class LocalizedAliases(AccessModel):
    en: list[str]
    ar: list[str]


class AssignmentSource(AccessModel):
    kind: Literal["role", "personal", "policy", "resource", "department"]
    id: str
    label: LocalizedText
    contribution: Literal["grant", "deny", "ceiling", "eligibility", "scope"]
    expires_at: datetime | None = None
    edit_destination: str | None = None


class Reason(AccessModel):
    code: str
    source: AssignmentSource
    capability: str | None = None
    applied: bool
    decisive: bool
    params: dict[str, Any] = Field(default_factory=dict)


class ReasonReference(AccessModel):
    reason_index: int


class ReasonNode(AccessModel):
    op: Literal["all", "any"]
    children: list[ReasonNode | ReasonReference]


class Issue(AccessModel):
    code: str
    severity: Literal["info", "warning", "error"]
    capabilities: list[str] = Field(default_factory=list)
    params: dict[str, Any] = Field(default_factory=dict)


class Decision(AccessModel):
    action: Action
    authorization: Literal["allowed", "denied", "unknown", "needs_context", "not_applicable"]
    executable_now: bool | None
    configurable: bool
    setting_capabilities: list[str]
    editable_effects: list[Literal["grant", "deny"] | None]
    rule_id: str
    reasons: list[Reason]
    reason_tree: ReasonNode
    required_context: list[str] = Field(default_factory=list)
    warnings: list[Issue] = Field(default_factory=list)


class AccessItem(AccessModel):
    resource: Resource
    group_id: str
    label: LocalizedText
    description: LocalizedText
    aliases: LocalizedAliases
    actions: list[Decision]


class Override(AccessModel):
    capability: str
    effect: Literal["grant", "deny"]
    expires_at: datetime | None
    state: Literal["active", "expired"]


class Scope(AccessModel):
    mode: Literal["current", "configured_limits_on"]
    limits_enabled: bool | None
    kind: str
    reason_codes: list[str]


class Subject(AccessModel):
    user_id: int
    role: str
    status: str
    authentication_eligible: bool


class SubjectFacts(AccessModel):
    has_approval_assignments: bool


class AccessSnapshot(AccessModel):
    subject: Subject
    revision: str
    evaluated_at: datetime
    valid_until: datetime | None
    effective: list[str]
    role_defaults: list[str]
    overrides: list[Override]
    items: list[AccessItem]
    subject_facts: SubjectFacts
    scope: Scope


class Impact(AccessModel):
    resource: Resource
    action: Action
    before: Decision
    after: Decision


class PreviewRequest(AccessModel):
    expected_revision: str
    items: list[Patch] = Field(min_length=1, max_length=200)


class PreviewResponse(AccessModel):
    current: AccessSnapshot
    proposed: AccessSnapshot
    impacts: list[Impact]
    validation: list[Issue]


class CheckRequest(AccessModel):
    resource: Resource
    action: Action
    context: Context = Field(default_factory=Context)
    proposed: list[Patch] = Field(default_factory=list, max_length=200)
    expected_revision: str | None = None


class CheckResponse(AccessModel):
    snapshot: AccessSnapshot
    current: Decision
    proposed: Decision | None
    impacts: list[Impact]
