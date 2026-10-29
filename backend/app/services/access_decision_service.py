"""Redacted action explanations, hypothetical patches and conditional saves.

The operator is authenticated by the route. Target evaluation never creates a
session, renders a document, marks a record read, or writes a business object.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.core.permissions import INMATE_REPORTER_CAPS, SENSITIVE_CAPABILITY_IDS
from app.db.models import BookApprovalStep, User, UserPermission
from app.schemas.access import (
    AccessItem, AccessSnapshot, Action, AssignmentSource, CheckRequest, CheckResponse,
    Context, Decision, Impact, Issue, LocalizedAliases, LocalizedText, Override, Patch,
    PreviewResponse, Reason, ReasonNode, ReasonReference, Resource, Scope, Subject, SubjectFacts,
)
from app.services import capability_catalog_service, perm_service

RULE_VERSION = "permission-studio-2026-10-29.1"


def _utc(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is not None:
        return value.astimezone(UTC).replace(tzinfo=None)
    return value


def _eligible(user: User) -> bool:
    return user.status == "active" and not user.password_change_required


def validate_patch(db: Session, user: User, actor: User, items: list[Patch]) -> list[tuple[str, str | None, datetime | None]]:
    """The same validation is used for preview, check and commit."""
    dynamic = perm_service.dynamic_capability_ids(db)
    now = datetime.now(UTC).replace(tzinfo=None)
    result = {}
    for item in items:
        expiry = _utc(item.expires_at)
        perm_service._validate_override_item(db, item.capability, item.effect, dynamic_caps=dynamic)
        perm_service._reject_inmate_reporter_scope_widening(user, item.capability, item.effect)
        if expiry is not None and (item.effect != "grant" or expiry <= now):
            raise AppError("INVALID_EXPIRY", "Expiry must be a future grant expiry.", http_status=422)
        existing = db.get(UserPermission, (user.id, item.capability))
        perm_service._validate_temporary_dynamic_grant(item.capability, item.effect, expiry, dynamic, existing)
        result[item.capability] = (item.effect, expiry)
    if actor.id == user.id:
        raise AppError("FORBIDDEN_OVERRIDE", "You cannot change your own permissions.")
    if user.role == "admin":
        raise AppError("FORBIDDEN_OVERRIDE", "Administrator permissions are locked.")
    if user.status != "active":
        raise AppError("FORBIDDEN_OVERRIDE", "Only active accounts can be edited.")
    return [(cap, effect, expiry) for cap, (effect, expiry) in result.items()]


def _source(kind: str, id: str, contribution: str, *, expiry=None, destination=None) -> AssignmentSource:
    return AssignmentSource(kind=kind, id=id, label=LocalizedText(en=id, ar=id), contribution=contribution, expires_at=expiry, edit_destination=destination)


def _reason(code: str, *, kind="policy", id=None, contribution="eligibility", capability=None, applied=True, decisive=True, expiry=None, **params) -> Reason:
    return Reason(code=code, source=_source(kind, id or code, contribution, expiry=expiry), capability=capability, applied=applied, decisive=decisive, params=params)


def _cap_reasons(user: User, resolution, capability: str) -> list[Reason]:
    granted = capability in resolution.role_defaults
    rows = {cap: (effect, expiry) for cap, effect, expiry in resolution.overrides}
    override = rows.get(capability)
    ignored = user.role == "admin"
    reasons = [_reason("ADMIN_POLICY" if ignored else "ROLE_DEFAULT" if capability in resolution.role_caps else "IMPLICIT_DEFAULT" if granted else "NOT_GRANTED", kind="role", id=user.role, contribution="grant" if granted else "deny", capability=capability, decisive=override is None or ignored)]
    if override:
        effect, expiry = override
        expired = effect == "grant" and expiry is not None and expiry <= resolution.evaluated_at
        reasons.append(_reason("ADMIN_OVERRIDE_IGNORED" if ignored else "EXPIRED_GRANT" if expired else "PERSONAL_" + effect.upper(), kind="personal", id=str(user.id), contribution="deny" if expired else effect, capability=capability, applied=not ignored, decisive=not ignored, expiry=expiry, suppresses_default=expired and granted))
    if user.role == "inmate_reporter" and capability not in INMATE_REPORTER_CAPS:
        reasons.append(_reason("REPORTER_CEILING", contribution="ceiling", capability=capability))
    return reasons


def _decision(user: User, actor: User, resolution, action: Action, capabilities: list[str], rule: str, *, authorization=None, extra=(), required=(), warnings=(), editable=True) -> Decision:
    reasons = [reason for cap in capabilities for reason in _cap_reasons(user, resolution, cap)] + list(extra)
    authorized = all(cap in resolution.effective for cap in capabilities)
    authorization = authorization or ("allowed" if authorized else "denied")
    if not _eligible(user):
        reasons.append(_reason("ACCOUNT_INELIGIBLE", status=user.status, password_change_required=bool(user.password_change_required)))
    configurable = editable and bool(capabilities) and user.role != "admin" and actor.id != user.id and user.status == "active"
    effects = [None, "deny"]
    if not any(cap in SENSITIVE_CAPABILITY_IDS for cap in capabilities) and not (user.role == "inmate_reporter" and any(cap not in INMATE_REPORTER_CAPS for cap in capabilities)):
        effects.insert(1, "grant")
    return Decision(action=action, authorization=authorization, executable_now=(authorization == "allowed" and _eligible(user)) if authorization not in ("needs_context", "unknown") else None, configurable=configurable, setting_capabilities=capabilities if editable else [], editable_effects=effects if configurable else [], rule_id=rule, reasons=reasons, reason_tree=ReasonNode(op="all", children=[ReasonReference(reason_index=i) for i in range(len(reasons))]), required_context=list(required), warnings=list(warnings))


def _action(capability: str) -> Action:
    suffix = capability.rsplit(".", 1)[-1]
    return Action(suffix) if suffix in Action._value2member_map_ else Action.manage


def _group(domain: str) -> str:
    if domain in ("employees", "leaves", "attendance", "absences"):
        return "people"
    if domain in ("books", "documents", "services", "categories"):
        return "services"
    if domain in ("ledger", "correspondence"):
        return "correspondence"
    if domain in ("messages", "templates", "editor_templates"):
        return "templates"
    return "administration"


def _catalog(db: Session, user: User, actor: User, resolution) -> list[AccessItem]:
    items = []
    for entry in capability_catalog_service.list_catalog(db):
        decision = _decision(user, actor, resolution, _action(entry.id), [entry.id], "capability")
        if entry.id == "employees.notify":
            decision.warnings.append(Issue(code="EMPLOYEE_HISTORY_USES_EMPLOYEES_VIEW", severity="info", capabilities=["employees.view"]))
        items.append(AccessItem(resource=Resource(kind="capability", id=entry.id), group_id=_group(entry.domain), label=LocalizedText(en=entry.label_en, ar=entry.label_ar or entry.label_en), description=LocalizedText(en=entry.description_en, ar=entry.description_ar or entry.description_en), aliases=LocalizedAliases(en=[entry.id], ar=[]), actions=[decision]))
    return items


def snapshot(db: Session, user: User, actor: User, *, proposed=()) -> AccessSnapshot:
    resolution = perm_service.resolve_capabilities(db, user, proposed=proposed)
    catalog = capability_catalog_service.list_catalog(db)
    assignments = list(db.execute(select(BookApprovalStep.id, BookApprovalStep.book_id, BookApprovalStep.version_id, BookApprovalStep.state, BookApprovalStep.kind).where(BookApprovalStep.assignee_user_id == user.id).order_by(BookApprovalStep.id)))
    canonical = {
        "rules": RULE_VERSION, "subject": [user.id, user.role, user.status, user.employee_id, bool(user.password_change_required), user.signature_path],
        "role": sorted(resolution.role_caps), "dynamic": sorted(resolution.dynamic_caps),
        "overrides": [(cap, effect, expiry.isoformat() if expiry else None, effect == "grant" and expiry is not None and expiry <= resolution.evaluated_at) for cap, effect, expiry in resolution.overrides],
        "catalog": [asdict(entry) for entry in catalog], "assignments": [list(row) for row in assignments],
    }
    revision = hashlib.sha256(json.dumps(canonical, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return AccessSnapshot(subject=Subject(user_id=user.id, role=user.role, status=user.status, authentication_eligible=_eligible(user)), revision=revision, evaluated_at=resolution.evaluated_at.replace(tzinfo=UTC), valid_until=resolution.valid_until.replace(tzinfo=UTC) if resolution.valid_until else None, effective=sorted(resolution.effective), role_defaults=sorted(resolution.role_defaults), overrides=[Override(capability=cap, effect=effect, expires_at=expiry.replace(tzinfo=UTC) if expiry else None, state="expired" if effect == "grant" and expiry is not None and expiry <= resolution.evaluated_at else "active") for cap, effect, expiry in resolution.overrides], items=_catalog(db, user, actor, resolution), subject_facts=SubjectFacts(has_approval_assignments=bool(assignments)), scope=Scope(mode="current", limits_enabled=None, kind="resource_specific", reason_codes=["RECORD_CONTEXT_REQUIRED", "DIRECT_RECIPIENT_REVIEWER_READ_RETAINED"]))


def require_revision(current: AccessSnapshot, expected: str | None) -> None:
    if not expected:
        raise AppError("PRECONDITION_REQUIRED", "Read current access before saving.", http_status=428)
    if expected.strip('"') != current.revision:
        raise AppError("ACCESS_CHANGED", "Access changed. Review again.", http_status=412)


def impacts(current: AccessSnapshot, proposed: AccessSnapshot) -> list[Impact]:
    before = {(item.resource.kind, item.resource.id, decision.action): (item.resource, decision) for item in current.items for decision in item.actions}
    return [Impact(resource=item.resource, action=decision.action, before=before[(item.resource.kind, item.resource.id, decision.action)][1], after=decision) for item in proposed.items for decision in item.actions if before[(item.resource.kind, item.resource.id, decision.action)][1] != decision]


def preview(db: Session, user: User, actor: User, expected: str, items: list[Patch]) -> PreviewResponse:
    current = snapshot(db, user, actor)
    require_revision(current, expected)
    patch = validate_patch(db, user, actor, items)
    proposed = snapshot(db, user, actor, proposed=patch)
    changes = impacts(current, proposed)
    return PreviewResponse(current=current, proposed=proposed, impacts=changes, validation=[Issue(code="PREREQUISITE_BLOCKED", severity="warning", capabilities=change.after.setting_capabilities) for change in changes if change.after.authorization == "denied"])


def evaluate(db: Session, user: User, actor: User, resource: Resource, action: Action, context: Context, *, proposed=()) -> Decision:
    if resource.kind != "capability" or resource.revision_id is not None or context.model_dump(exclude_none=True):
        raise AppError("UNSUPPORTED_ACCESS_CHECK", "Unsupported resource/action/context combination.", http_status=422)
    entry = capability_catalog_service.get_catalog_entry(db, resource.id)
    if entry is None or action != _action(resource.id):
        raise AppError("UNSUPPORTED_ACCESS_CHECK", "Unsupported resource/action combination.", http_status=422)
    resolution = perm_service.resolve_capabilities(db, user, proposed=proposed)
    return _decision(user, actor, resolution, action, [resource.id], "capability")


def check(db: Session, user: User, actor: User, body: CheckRequest) -> CheckResponse:
    current_snapshot = snapshot(db, user, actor)
    if body.expected_revision is not None:
        require_revision(current_snapshot, body.expected_revision)
    current = evaluate(db, user, actor, body.resource, body.action, body.context)
    proposed = None
    changes = []
    if body.proposed:
        patch = validate_patch(db, user, actor, body.proposed)
        proposed = evaluate(db, user, actor, body.resource, body.action, body.context, proposed=patch)
        if current != proposed:
            changes = [Impact(resource=body.resource, action=body.action, before=current, after=proposed)]
    return CheckResponse(snapshot=current_snapshot, current=current, proposed=proposed, impacts=changes)


def save(db: Session, user_id: int, actor: User, expected: str | None, items: list[Patch]) -> User:
    """Acquire SQLite's writer reservation BEFORE reading the precondition.

    Auth has already performed reads in this request. End that read transaction
    without flushing; then reserve the writer and expire the identity map, so no
    cached target, role or override can survive into this transaction.
    """
    from app.services import auth_service

    actor_id = actor.id
    db.rollback()
    try:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        db.expire_all()
        actor = auth_service.require_user(db, actor_id)
        if actor.role != "admin" or not _eligible(actor):
            raise AppError("FORBIDDEN", "Administrator access required.", http_status=403)
        target = auth_service.require_user(db, user_id)
        require_revision(snapshot(db, target, actor), expected)
        patch = validate_patch(db, target, actor, items)
        for capability, effect, expiry in patch:
            existing = db.get(UserPermission, (user_id, capability))
            if effect is None:
                if existing is not None:
                    db.delete(existing)
            elif existing is None:
                db.add(UserPermission(user_id=user_id, capability=capability, effect=effect, expires_at=expiry))
            else:
                existing.effect, existing.expires_at = effect, expiry
            auth_service.audit_permission_change(db, actor=actor.display_name or actor.email, user=target, capability=capability, effect=effect, commit=False)
        db.commit()
        perm_service._invalidate_caps_cache(db, user_id)
        return target
    except Exception:
        db.rollback()
        raise
