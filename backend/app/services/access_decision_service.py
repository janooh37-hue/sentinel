"""Redacted action explanations, hypothetical patches and conditional saves.

The operator is authenticated by the route. Target evaluation never creates a
session, renders a document, marks a record read, or writes a business object.
"""

from __future__ import annotations

import hashlib
import json
from copy import copy
from dataclasses import asdict
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.core.permissions import SENSITIVE_CAPABILITY_IDS
from app.db.models import Book, BookApprovalStep, BookCategory, EditorTemplate, User, UserPermission
from app.schemas.access import (
    AccessItem,
    AccessSnapshot,
    Action,
    AssignmentSource,
    CheckRequest,
    CheckResponse,
    Context,
    Decision,
    Impact,
    Issue,
    LocalizedAliases,
    LocalizedText,
    Override,
    Patch,
    PreviewResponse,
    Reason,
    ReasonNode,
    ReasonReference,
    Resource,
    Scope,
    Subject,
    SubjectFacts,
)
from app.services import (
    action_guard_service,
    capability_catalog_service,
    perm_service,
    role_route_service,
    template_capability_service,
)

RULE_VERSION = "permission-studio-2026-10-29.4"


def _utc(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is not None:
        return value.astimezone(UTC).replace(tzinfo=None)
    return value


def _eligible(user: User) -> bool:
    return user.status == "active" and not user.password_change_required


def validate_patch(
    db: Session, user: User, actor: User, items: list[Patch]
) -> list[tuple[str, str | None, datetime | None]]:
    """The same validation is used for preview, check and commit."""
    dynamic = perm_service.dynamic_capability_ids(db)
    now = datetime.now(UTC).replace(tzinfo=None)
    result = {}
    for item in items:
        expiry = _utc(item.expires_at)
        perm_service._validate_override_item(db, item.capability, item.effect, dynamic_caps=dynamic)
        perm_service._reject_inmate_reporter_scope_widening(user, item.capability, item.effect)
        if expiry is not None and (item.effect != "grant" or expiry <= now):
            raise AppError(
                "INVALID_EXPIRY", "Expiry must be a future grant expiry.", http_status=422
            )
        existing = db.get(UserPermission, (user.id, item.capability))
        perm_service._validate_temporary_dynamic_grant(
            item.capability, item.effect, expiry, dynamic, existing
        )
        result[item.capability] = (item.effect, expiry)
    if actor.id == user.id:
        raise AppError("FORBIDDEN_OVERRIDE", "You cannot change your own permissions.")
    if user.role == "admin":
        raise AppError("FORBIDDEN_OVERRIDE", "Administrator permissions are locked.")
    if user.status != "active":
        raise AppError("FORBIDDEN_OVERRIDE", "Only active accounts can be edited.")
    return [(cap, effect, expiry) for cap, (effect, expiry) in result.items()]


def _source(
    kind: str, id: str, contribution: str, *, expiry=None, destination=None
) -> AssignmentSource:
    labels = {
        "role": {
            "operator": ("Operator role", "دور المشغّل"),
            "manager": ("Manager role", "دور المدير"),
            "admin": ("Administrator role", "دور المسؤول"),
            "inmate_reporter": ("Inmate reporter role", "دور مسجل مخالفات النزلاء"),
        }.get(id, (id, id)),
        "personal": ("Personal exception", "استثناء فردي"),
        "policy": ("Application policy", "سياسة التطبيق"),
        "resource": ("Record policy", "سياسة السجل"),
    }
    en, ar = labels.get(kind, (id, id))
    if kind == "personal":
        destination = f"/permissions?user={id}"
    return AssignmentSource(
        kind=kind,
        id=id,
        label=LocalizedText(en=en, ar=ar),
        contribution=contribution,
        expires_at=expiry.replace(tzinfo=UTC) if expiry is not None else None,
        edit_destination=destination,
    )


def _reason(
    code: str,
    *,
    kind="policy",
    id=None,
    contribution="eligibility",
    capability=None,
    applied=True,
    decisive=True,
    expiry=None,
    **params,
) -> Reason:
    return Reason(
        code=code,
        source=_source(kind, id or code, contribution, expiry=expiry),
        capability=capability,
        applied=applied,
        decisive=decisive,
        params=params,
    )


def _cap_reasons(user: User, resolution, capability: str) -> list[Reason]:
    granted = capability in resolution.role_defaults
    rows = {cap: (effect, expiry) for cap, effect, expiry in resolution.overrides}
    override = rows.get(capability)
    ignored = user.role == "admin"
    expired_view_grant = (
        override is not None
        and override[0] == "grant"
        and override[1] is not None
        and override[1] <= resolution.evaluated_at
        and capability in template_capability_service.capability_ids()
    )
    reasons = [
        _reason(
            "ADMIN_POLICY"
            if ignored
            else "ROLE_DEFAULT"
            if capability in resolution.role_caps
            else "IMPLICIT_DEFAULT"
            if granted
            else "NOT_GRANTED",
            kind="role",
            id=user.role,
            contribution="grant" if granted else "deny",
            capability=capability,
            applied=override is None or ignored or expired_view_grant,
            decisive=override is None or ignored or expired_view_grant,
        )
    ]
    if override:
        effect, expiry = override
        expired = effect == "grant" and expiry is not None and expiry <= resolution.evaluated_at
        reasons.append(
            _reason(
                "ADMIN_OVERRIDE_IGNORED"
                if ignored
                else "EXPIRED_GRANT"
                if expired
                else "PERSONAL_" + effect.upper(),
                kind="personal",
                id=str(user.id),
                contribution="deny" if expired and not expired_view_grant else effect,
                capability=capability,
                applied=not ignored and not expired_view_grant,
                decisive=not ignored and not expired_view_grant,
                expiry=expiry,
                suppresses_default=expired and granted and not expired_view_grant,
            )
        )
    if user.role == "inmate_reporter" and not template_capability_service.reporter_capability(
        capability
    ):
        reasons.append(_reason("REPORTER_CEILING", contribution="ceiling", capability=capability))
    return reasons


def _decision(
    user: User,
    actor: User,
    resolution,
    action: Action,
    capabilities: list[str],
    rule: str,
    *,
    authorization=None,
    extra=(),
    required=(),
    warnings=(),
    editable=True,
) -> Decision:
    reasons = [
        reason for cap in capabilities for reason in _cap_reasons(user, resolution, cap)
    ] + list(extra)
    authorized = all(cap in resolution.effective for cap in capabilities)
    authorization = authorization or ("allowed" if authorized else "denied")
    if not _eligible(user):
        reasons.append(
            _reason(
                "ACCOUNT_INELIGIBLE",
                status=user.status,
                password_change_required=bool(user.password_change_required),
            )
        )
    configurable = (
        editable
        and bool(capabilities)
        and user.role != "admin"
        and actor.id != user.id
        and user.status == "active"
    )
    effects = [None, "deny"]
    if not any(cap in SENSITIVE_CAPABILITY_IDS for cap in capabilities) and not (
        user.role == "inmate_reporter"
        and any(not template_capability_service.reporter_capability(cap) for cap in capabilities)
    ):
        effects.insert(1, "grant")
    return Decision(
        action=action,
        authorization=authorization,
        executable_now=(authorization == "allowed" and _eligible(user))
        if authorization not in ("needs_context", "unknown")
        else None,
        configurable=configurable,
        setting_capabilities=capabilities if editable else [],
        editable_effects=effects if configurable else [],
        rule_id=rule,
        reasons=reasons,
        reason_tree=ReasonNode(
            op="all",
            children=[
                ReasonReference(reason_index=i)
                for i, reason in enumerate(reasons)
                if reason.applied and reason.decisive
            ],
        ),
        required_context=list(required),
        warnings=list(warnings),
    )


def _action(capability: str) -> Action:
    if capability in template_capability_service.capability_ids():
        return Action.view
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


def _catalog(
    db: Session, user: User, actor: User, resolution, catalog, word_templates
) -> list[AccessItem]:
    from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS
    from app.services import email_draft_template_service, sms_templates

    category_ids = frozenset(db.scalars(select(BookCategory.id)))
    items = []
    for entry in catalog:
        # Explicit template action rows below already bind these catalog IDs.
        if entry.id in template_capability_service.capability_ids():
            continue
        resource = Resource(kind="capability", id=entry.id)
        decision = _evaluate(
            db,
            user,
            actor,
            resource,
            _action(entry.id),
            Context(),
            resolution,
            known_entry=entry,
            category_ids=category_ids,
        )
        if entry.id == "employees.notify":
            decision.warnings.append(
                Issue(
                    code="EMPLOYEE_HISTORY_USES_EMPLOYEES_VIEW",
                    severity="info",
                    capabilities=["employees.view"],
                )
            )
        items.append(
            AccessItem(
                resource=resource,
                group_id=_group(entry.domain),
                label=LocalizedText(en=entry.label_en, ar=entry.label_ar or entry.label_en),
                description=LocalizedText(
                    en=entry.description_en, ar=entry.description_ar or entry.description_en
                ),
                aliases=LocalizedAliases(en=[entry.id], ar=[]),
                actions=[decision],
            )
        )
    by_id = {entry.id: entry for entry in catalog}
    for service_id in (*SERVICE_IDS, OTHER_SERVICE_ID):
        entry = by_id[f"books.service.{service_id}"]
        resource = Resource(kind="service", id=service_id)
        actions = (Action.read,) if service_id == OTHER_SERVICE_ID else (Action.create, Action.read)
        items.append(
            AccessItem(
                resource=resource,
                group_id="services",
                label=LocalizedText(en=entry.label_en, ar=entry.label_ar or entry.label_en),
                description=LocalizedText(
                    en=entry.description_en, ar=entry.description_ar or entry.description_en
                ),
                aliases=LocalizedAliases(
                    en=[service_id, f"books.servicerecords.{service_id}"], ar=[]
                ),
                actions=[
                    _evaluate(
                        db,
                        user,
                        actor,
                        resource,
                        action,
                        Context(),
                        resolution,
                        category_ids=category_ids,
                    )
                    for action in actions
                ],
            )
        )
    families = [
        ("notification_template", sms_templates.EVENTS, (Action.view, Action.edit, Action.reset)),
        (
            "email_template",
            email_draft_template_service.KEY_FAMILIES,
            (Action.view, Action.edit, Action.reset),
        ),
        (
            "word_template",
            ("library", *(item.name for item in word_templates)),
            (Action.view, Action.edit, Action.delete),
        ),
        ("editor_template", ("library",), (Action.view, Action.create, Action.edit, Action.delete)),
    ]
    for kind, identifiers, actions in families:
        for identifier in identifiers:
            resource = Resource(kind=kind, id=str(identifier))
            label = (
                {
                    "word_template": LocalizedText(
                        en="Word template library", ar="مكتبة قوالب وورد"
                    ),
                    "editor_template": LocalizedText(
                        en="Editor template library", ar="مكتبة قوالب المحرّر"
                    ),
                }.get(kind)
                if identifier == "library"
                else None
            )
            if kind in ("notification_template", "email_template"):
                entry = by_id[template_capability_service.view_capability(kind, str(identifier))]
                label = LocalizedText(en=entry.label_en, ar=entry.label_ar or entry.label_en)
            items.append(
                AccessItem(
                    resource=resource,
                    group_id="templates",
                    label=label or LocalizedText(en=str(identifier), ar=str(identifier)),
                    description=LocalizedText(
                        en={
                            "notification_template": "Notification wording",
                            "email_template": "Email wording",
                            "word_template": "Word document library",
                            "editor_template": "Rich-editor library",
                        }[kind],
                        ar={
                            "notification_template": "نص الإشعارات",
                            "email_template": "نص البريد الإلكتروني",
                            "word_template": "مكتبة مستندات وورد",
                            "editor_template": "مكتبة المحرر النصي",
                        }[kind],
                    ),
                    aliases=LocalizedAliases(en=[kind, str(identifier)], ar=[]),
                    actions=[
                        _evaluate(
                            db,
                            user,
                            actor,
                            resource,
                            action,
                            Context(),
                            resolution,
                            word_templates=word_templates,
                            category_ids=category_ids,
                        )
                        for action in actions
                    ],
                )
            )
    for item in items:
        capability = (
            item.resource.id
            if item.resource.kind == "capability"
            else f"books.service.{item.resource.id}"
            if item.resource.kind == "service"
            else None
        )
        entry = by_id.get(capability)
        if entry is None:
            continue
        missing = []
        if not entry.label_ar:
            missing.append("label")
        if not entry.description_ar:
            missing.append("description")
        if missing:
            for decision in item.actions:
                decision.warnings.append(
                    Issue(
                        code="MISSING_ARABIC_TRANSLATION",
                        severity="info",
                        capabilities=[entry.id],
                        params={"locale": "ar", "fields": missing},
                    )
                )
    return items


def snapshot(db: Session, user: User, actor: User, *, proposed=()) -> AccessSnapshot:
    from app.services import book_template_service

    resolution = perm_service.resolve_capabilities(db, user, proposed=proposed)
    catalog = capability_catalog_service.list_catalog(db)
    word_templates = book_template_service.list_templates(read_only=True)
    assignments = list(
        db.execute(
            select(
                BookApprovalStep.id,
                BookApprovalStep.book_id,
                BookApprovalStep.version_id,
                BookApprovalStep.state,
                BookApprovalStep.kind,
            )
            .where(BookApprovalStep.assignee_user_id == user.id)
            .order_by(BookApprovalStep.id)
        )
    )
    canonical = {
        "rules": RULE_VERSION,
        "subject": [
            user.id,
            user.role,
            user.status,
            user.employee_id,
            bool(user.password_change_required),
            user.signature_path,
        ],
        "role": sorted(resolution.role_caps),
        "dynamic": sorted(resolution.dynamic_caps),
        "overrides": [
            (
                cap,
                effect,
                expiry.isoformat() if expiry else None,
                effect == "grant" and expiry is not None and expiry <= resolution.evaluated_at,
            )
            for cap, effect, expiry in resolution.overrides
        ],
        "catalog": [asdict(entry) for entry in catalog],
        "assignments": [list(row) for row in assignments],
        "word_templates": sorted((item.name, item.kind) for item in word_templates),
    }
    revision = hashlib.sha256(
        json.dumps(canonical, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    return AccessSnapshot(
        subject=Subject(
            user_id=user.id,
            role=user.role,
            status=user.status,
            authentication_eligible=_eligible(user),
        ),
        revision=revision,
        evaluated_at=resolution.evaluated_at.replace(tzinfo=UTC),
        valid_until=resolution.valid_until.replace(tzinfo=UTC) if resolution.valid_until else None,
        effective=sorted(resolution.effective),
        role_defaults=sorted(resolution.role_defaults),
        overrides=[
            Override(
                capability=cap,
                effect=effect,
                expires_at=expiry.replace(tzinfo=UTC) if expiry else None,
                state="expired"
                if effect == "grant" and expiry is not None and expiry <= resolution.evaluated_at
                else "active",
            )
            for cap, effect, expiry in resolution.overrides
        ],
        items=_catalog(db, user, actor, resolution, catalog, word_templates),
        subject_facts=SubjectFacts(has_approval_assignments=bool(assignments)),
        scope=Scope(
            mode="current",
            limits_enabled=None,
            kind="resource_specific",
            reason_codes=["RECORD_CONTEXT_REQUIRED", "DIRECT_RECIPIENT_REVIEWER_READ_RETAINED"],
        ),
    )


def require_revision(current: AccessSnapshot, expected: str | None) -> None:
    if not expected:
        raise AppError(
            "PRECONDITION_REQUIRED", "Read current access before saving.", http_status=428
        )
    if expected.strip('"') != current.revision:
        raise AppError("ACCESS_CHANGED", "Access changed. Review again.", http_status=412)


def impacts(current: AccessSnapshot, proposed: AccessSnapshot) -> list[Impact]:
    before = {
        (item.resource.kind, item.resource.id, decision.action): (item.resource, decision)
        for item in current.items
        for decision in item.actions
    }
    return [
        Impact(
            resource=item.resource,
            action=decision.action,
            before=before[(item.resource.kind, item.resource.id, decision.action)][1],
            after=decision,
        )
        for item in proposed.items
        for decision in item.actions
        if before[(item.resource.kind, item.resource.id, decision.action)][1] != decision
    ]


def preview(
    db: Session, user: User, actor: User, expected: str, items: list[Patch]
) -> PreviewResponse:
    current = snapshot(db, user, actor)
    require_revision(current, expected)
    patch = validate_patch(db, user, actor, items)
    proposed = snapshot(db, user, actor, proposed=patch)
    changes = impacts(current, proposed)
    validation = []
    for change in changes:
        for warning in change.after.warnings:
            if warning.code == "PREREQUISITE_BLOCKED" and warning not in validation:
                validation.append(warning)
    return PreviewResponse(
        current=current, proposed=proposed, impacts=changes, validation=validation
    )


def _unsupported() -> None:
    raise AppError(
        "UNSUPPORTED_ACCESS_CHECK",
        "Unsupported resource/action/context combination.",
        http_status=422,
    )


def _guard_decision(
    user,
    actor,
    resolution,
    action,
    bindings,
    guard,
    *,
    required=(),
    extra=(),
    warnings=(),
    prerequisites=(),
):
    reasons = [
        reason
        for cap in prerequisites
        if cap not in bindings
        for reason in _cap_reasons(user, resolution, cap)
    ] + list(extra)
    for blocker in guard.blockers:
        reasons.append(_reason("PREREQUISITE_MISSING", capability=blocker))
    if not guard.allowed and not guard.blockers:
        reasons.append(
            _reason(guard.error.code if guard.error else "RESOURCE_DENIED", kind="resource")
        )
    warnings = list(warnings)
    missing_prerequisites = [cap for cap in guard.blockers if cap not in bindings]
    if missing_prerequisites and all(cap in resolution.effective for cap in bindings):
        warnings.append(
            Issue(
                code="PREREQUISITE_BLOCKED", severity="warning", capabilities=missing_prerequisites
            )
        )
    authorization = "denied" if not guard.allowed else "needs_context" if required else "allowed"
    return _decision(
        user,
        actor,
        resolution,
        action,
        bindings,
        guard.rule_id,
        authorization=authorization,
        extra=reasons,
        required=required,
        warnings=warnings,
    )


def _category_exists(db: Session, category: str, category_ids: frozenset[str] | None) -> bool:
    return (
        category in category_ids
        if category_ids is not None
        else db.get(BookCategory, category) is not None
    )


def _ordinary_read_capabilities(book: Book) -> list[str]:
    from app.core import grades
    from app.core.form_kind import resolve_service

    latest = max(book.versions, key=lambda version: version.version_no, default=None)
    service_id = resolve_service(
        book.subject, latest.template_id if latest else None, versioned=latest is not None
    )
    capabilities = [
        "books.view",
        f"books.category.{book.category_id}",
        f"books.servicerecords.{service_id}",
    ]
    if book.classification_code:
        capabilities.append(f"books.category.{book.classification_code}")
    if book.grade == grades.SECRET:
        capabilities.append("books.secret")
    return capabilities


def _evaluate_action(
    db,
    user,
    actor,
    resource,
    action,
    context,
    resolution,
    *,
    known_entry=None,
    word_templates=None,
    category_ids=None,
    allow_read_loss=False,
) -> Decision:
    from app.core import grades
    from app.core.classifications import get_classification
    from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS
    from app.services import (
        book_template_service,
        document_service,
        email_draft_template_service,
        sms_templates,
    )

    caps = resolution.effective
    values = context.model_dump(exclude_none=True)
    if resource.kind != "book" and resource.revision_id is not None:
        _unsupported()
    if resource.kind not in ("service",) and values:
        _unsupported()
    if resource.kind == "capability":
        entry = known_entry or capability_catalog_service.get_catalog_entry(db, resource.id)
        if entry is None or action != _action(resource.id):
            _unsupported()
        if resource.id == "documents.duty_transfer":
            category_exists = _category_exists(db, "GS", category_ids)
            initial = action_guard_service.duty_transfer_decision(
                caps, initial_placement=True, category_exists=category_exists
            )
            existing = action_guard_service.duty_transfer_decision(
                caps, initial_placement=False, category_exists=category_exists
            )
            decision = _guard_decision(
                user,
                actor,
                resolution,
                action,
                [resource.id],
                initial,
                required=["employee_assignment"],
                prerequisites=["documents.generate"],
            )
            prerequisite_tree = decision.reason_tree
            initial_index = len(decision.reasons)
            decision.reasons.append(
                _reason(
                    "INITIAL_PLACEMENT_BYPASSES_RECORD_TYPE",
                    applied=False,
                    decisive=False,
                    condition="initial_placement",
                    authorization="allowed" if initial.allowed else "denied",
                )
            )
            existing_index = len(decision.reasons)
            decision.reasons.append(
                _reason(
                    "EXISTING_ASSIGNMENT_REQUIRES_RECORD_TYPE",
                    applied=False,
                    decisive=False,
                    condition="existing_assignment",
                    authorization="allowed" if existing.allowed else "denied",
                    error_code=existing.error.code if existing.error else None,
                )
            )
            conditional_indices = []
            conditional_caps = [
                "books.category.GS",
                "books.service.General Book",
                "books.category.12/1",
            ]
            for capability in conditional_caps:
                for reason in _cap_reasons(user, resolution, capability):
                    reason.applied = False
                    reason.decisive = False
                    reason.params["condition"] = "existing_assignment"
                    conditional_indices.append(len(decision.reasons))
                    decision.reasons.append(reason)
            missing = [capability for capability in conditional_caps if capability not in caps]
            if missing or not category_exists:
                decision.reasons.append(
                    _reason(
                        "CONDITIONAL_PREREQUISITE_MISSING",
                        applied=False,
                        decisive=False,
                        condition="existing_assignment",
                        capabilities=missing,
                        category_exists=category_exists,
                    )
                )
                conditional_indices.append(len(decision.reasons) - 1)
                decision.warnings.append(
                    Issue(
                        code="CONDITIONAL_PREREQUISITE_BLOCKED",
                        severity="warning",
                        capabilities=missing,
                        params={
                            "condition": "existing_assignment",
                            "category_exists": category_exists,
                        },
                    )
                )
            decision.reason_tree = ReasonNode(
                op="all",
                children=[
                    prerequisite_tree,
                    ReasonNode(
                        op="any",
                        children=[
                            ReasonReference(reason_index=initial_index),
                            ReasonNode(
                                op="all",
                                children=[
                                    ReasonReference(reason_index=existing_index),
                                    *(
                                        ReasonReference(reason_index=index)
                                        for index in conditional_indices
                                    ),
                                ],
                            ),
                        ],
                    ),
                ],
            )
            return decision
        guard = action_guard_service.capability_decision(caps, resource.id)
        return _guard_decision(user, actor, resolution, action, [resource.id], guard)
    if resource.kind == "service":
        if resource.id not in (*SERVICE_IDS, OTHER_SERVICE_ID) or action not in (
            Action.create,
            Action.read,
        ):
            _unsupported()
        if resource.id == OTHER_SERVICE_ID and action == Action.create:
            _unsupported()
        if action == Action.read:
            if values:
                _unsupported()
            guard = action_guard_service.service_browse_decision(caps, resource.id)
            return _guard_decision(
                user,
                actor,
                resolution,
                action,
                [f"books.servicerecords.{resource.id}"],
                guard,
                prerequisites=["books.view"],
                extra=[
                    _reason(
                        "DIRECT_RECIPIENT_REVIEWER_READ_RETAINED",
                        kind="resource",
                        contribution="scope",
                        decisive=False,
                    )
                ],
                warnings=[Issue(code="EXACT_RECORD_REQUIRES_CONTEXT", severity="info")],
            )
        category = document_service.record_category_for_template(resource.id)
        if context.category_id is not None and str(context.category_id) != category:
            _unsupported()
        classification = (
            str(context.classification_id) if context.classification_id is not None else None
        )
        if context.grade is not None and context.grade not in grades.GRADE_CODES:
            _unsupported()
        if classification is not None and (
            resource.id != "General Book" or get_classification(classification) is None
        ):
            _unsupported()
        if (
            context.category_id is not None
            and f"books.category.{category}" not in perm_service.category_capability_ids(db)
        ):
            _unsupported()
        required = []
        if resource.id == "General Book" and classification is None:
            required.append("classification_id")
        if context.grade is None:
            required.append("grade")
        guard = action_guard_service.service_create_decision(
            caps,
            resource.id,
            category_id=category,
            classification_code=classification,
            grade=context.grade,
            category_exists=_category_exists(db, category, category_ids),
        )
        prerequisites = ["documents.generate", "books.view", f"books.category.{category}"]
        if classification is not None:
            prerequisites.append(f"books.category.{classification}")
        if context.grade == grades.SECRET:
            prerequisites.append("books.secret")
        return _guard_decision(
            user,
            actor,
            resolution,
            action,
            [f"books.service.{resource.id}"],
            guard,
            required=required,
            prerequisites=prerequisites,
        )
    if resource.kind.endswith("_template"):
        if resource.kind == "word_template" and word_templates is None:
            word_templates = book_template_service.list_templates(read_only=True)
        identifiers = {
            "notification_template": sms_templates.EVENTS,
            "email_template": email_draft_template_service.KEY_FAMILIES,
            "word_template": ("library", *(item.name for item in word_templates or ())),
        }
        if resource.kind in identifiers and resource.id not in identifiers[resource.kind]:
            _unsupported()
        if (
            resource.kind == "editor_template"
            and resource.id != "library"
            and (not resource.id.isdecimal() or db.get(EditorTemplate, int(resource.id)) is None)
        ):
            raise AppError("NOT_FOUND", "Resource not found.", http_status=404)
        try:
            guard = action_guard_service.template_decision(
                caps, resource.kind, action.value, resource.id
            )
        except ValueError:
            _unsupported()
        if resource.kind in ("notification_template", "email_template"):
            view = template_capability_service.view_capability(resource.kind, resource.id)
            bindings = (
                [view] if action in (Action.view, Action.read) else ["messages.templates", view]
            )
            warnings, extra = [], []
        elif resource.kind == "word_template":
            bindings = ["books.edit" if action in (Action.view, Action.read) else "books.templates"]
            warnings, extra = [], []
        else:
            bindings, warnings, extra = ["editor_templates.manage"], [], []
        return _guard_decision(
            user, actor, resolution, action, bindings, guard, warnings=warnings, extra=extra
        )
    if resource.kind == "book":
        if (
            action not in (Action.view, Action.read, Action.edit, Action.create)
            or not resource.id.isdecimal()
        ):
            _unsupported()
        book = db.get(Book, int(resource.id))
        if book is None:
            raise AppError("NOT_FOUND", "Resource not found.", http_status=404)
        target = copy(user)
        target._effective_caps_cache = frozenset(caps)
        readable = action_guard_service.book_read_decision(
            db, target, book, version_id=resource.revision_id
        )
        if not readable.allowed:
            if allow_read_loss:
                return _guard_decision(
                    user,
                    actor,
                    resolution,
                    action,
                    ["books.edit"]
                    if action in (Action.edit, Action.create) and user.role != "inmate_reporter"
                    else [],
                    readable,
                    extra=[_reason("PROPOSED_RECORD_ACCESS_LOST", kind="resource")],
                    prerequisites=_ordinary_read_capabilities(book),
                )
            raise AppError("NOT_FOUND", "Resource not found.", http_status=404)
        path = readable.access.read_path
        resource_inputs = [
            book.id,
            book.category_id,
            book.grade,
            book.distribution,
            book.classification_code,
            book.approval_state,
            str(book.deleted_at),
            getattr(book, "created_by_user_id", None),
            [
                (version.id, version.version_no, version.status, bool(version.signed_pdf_path))
                for version in book.versions
            ],
            path,
            sorted(readable.access.allowed_version_ids),
            readable.access.selected_version_id,
        ]
        resource_revision = hashlib.sha256(
            json.dumps(resource_inputs, sort_keys=True).encode()
        ).hexdigest()
        extra = [
            _reason(
                "RECORD_READ_" + path.upper(),
                kind="resource",
                contribution="scope",
                resource_revision=resource_revision,
            )
        ]
        if action == Action.create:
            from app.core.constants import TEMPLATE_FILES

            current_version = max(
                book.versions, key=lambda version: version.version_no, default=None
            )
            if current_version is None or current_version.template_id not in TEMPLATE_FILES:
                _unsupported()
            service_id = document_service.effective_document_service(current_version.template_id)
            category = document_service.record_category_for_template(current_version.template_id)
            guard = action_guard_service.service_create_decision(
                caps,
                service_id,
                category_id=category,
                classification_code=book.classification_code,
                grade=book.grade,
                category_exists=_category_exists(db, category, category_ids),
            )
            if guard.allowed:
                guard = action_guard_service.book_revise_decision(db, target, book)
            return _guard_decision(
                user,
                actor,
                resolution,
                action,
                [] if user.role == "inmate_reporter" else ["books.edit"],
                guard,
                prerequisites=[
                    "documents.generate",
                    "books.view",
                    f"books.service.{service_id}",
                    f"books.category.{category}",
                ],
                extra=[*extra, _reason("CREATE_NEXT_REVISION", decisive=False)],
            )
        if action == Action.edit:
            guard = action_guard_service.book_edit_decision(
                db, target, book, version_id=resource.revision_id
            )
            return _guard_decision(
                user, actor, resolution, action, ["books.edit"], guard, extra=extra
            )
        ordinary_caps = _ordinary_read_capabilities(book)
        ordinary_reasons = [
            reason
            for capability in ordinary_caps
            for reason in _cap_reasons(user, resolution, capability)
        ]
        if path != "ordinary":
            for reason in ordinary_reasons:
                reason.applied = False
                reason.decisive = False
        result = _guard_decision(
            user, actor, resolution, action, [], readable, extra=[*ordinary_reasons, *extra]
        )
        read_references = [
            ReasonReference(reason_index=i)
            for i, reason in enumerate(result.reasons)
            if reason.applied and reason.decisive and reason.code != "ACCOUNT_INELIGIBLE"
        ]
        alternatives = ReasonNode(
            op="any",
            children=[ReasonNode(op="all", children=read_references)]
            if path == "ordinary"
            else read_references,
        )
        eligibility = [
            ReasonReference(reason_index=i)
            for i, reason in enumerate(result.reasons)
            if reason.code == "ACCOUNT_INELIGIBLE"
        ]
        result.reason_tree = (
            ReasonNode(op="all", children=[alternatives, *eligibility])
            if eligibility
            else alternatives
        )
        return result
    _unsupported()


def _resource_action_route(resource: Resource, action: Action) -> tuple[str, str] | None:
    """Bind a diagnostic action to its real registered authenticated route."""
    if resource.kind == "capability":
        # Membership is not a claim about any one protected consumer route.
        return None
    if resource.kind == "service":
        return (
            ("POST", "/api/v1/documents/generate")
            if action == Action.create
            else ("GET", "/api/v1/books")
        )
    if resource.kind == "book":
        if action == Action.create:
            return "POST", "/api/v1/documents/generate"
        return ("PATCH" if action == Action.edit else "GET"), "/api/v1/books/{book_id}"
    if resource.kind == "notification_template":
        if action in (Action.view, Action.read):
            return "GET", "/api/v1/notify/templates"
        return ("DELETE" if action == Action.reset else "PUT"), "/api/v1/notify/templates/{event}"
    if resource.kind == "email_template":
        if action in (Action.view, Action.read):
            return "GET", "/api/v1/email/draft-templates"
        return (
            "DELETE" if action == Action.reset else "PUT"
        ), "/api/v1/email/draft-templates/{key:path}"
    if resource.kind == "word_template":
        return {
            Action.view: ("GET", "/api/v1/books/word-templates"),
            Action.read: ("GET", "/api/v1/books/word-templates/{name}/table"),
            Action.create: ("POST", "/api/v1/books/word-templates/sessions"),
            Action.edit: ("PATCH", "/api/v1/books/word-templates/{name}"),
            Action.delete: ("DELETE", "/api/v1/books/word-templates/{name}"),
        }.get(action)
    if resource.kind == "editor_template":
        return {
            Action.view: ("GET", "/api/v1/editor-templates"),
            Action.read: ("GET", "/api/v1/editor-templates/{template_id}"),
            Action.create: ("POST", "/api/v1/editor-templates"),
            Action.edit: ("PATCH", "/api/v1/editor-templates/{template_id}"),
            Action.delete: ("DELETE", "/api/v1/editor-templates/{template_id}"),
            Action.manage: ("GET", "/api/v1/editor-templates"),
        }.get(action)
    return None


def _evaluate(
    db,
    user,
    actor,
    resource,
    action,
    context,
    resolution,
    *,
    known_entry=None,
    word_templates=None,
    category_ids=None,
    allow_read_loss=False,
) -> Decision:
    decision = _evaluate_action(
        db,
        user,
        actor,
        resource,
        action,
        context,
        resolution,
        known_entry=known_entry,
        word_templates=word_templates,
        category_ids=category_ids,
        allow_read_loss=allow_read_loss,
    )
    route = _resource_action_route(resource, action)
    if route is None:
        if resource.kind != "capability":
            _unsupported()
        return decision
    restriction = role_route_service.role_route_decision(user.role, *route)
    if restriction.allowed:
        return decision
    # The authenticated route gate runs before capability and resource guards.
    # Keep configured sources visible, but do not present them as applied here.
    for reason in decision.reasons:
        reason.applied = False
        reason.decisive = False
    decision.reasons.append(
        _reason(
            restriction.error.code,
            id=user.role,
            contribution="ceiling",
            method=route[0],
            route=route[1],
        )
    )
    decision.authorization = "denied"
    decision.executable_now = False
    decision.required_context = []
    decision.reason_tree = ReasonNode(
        op="all", children=[ReasonReference(reason_index=len(decision.reasons) - 1)]
    )
    return decision


def evaluate(
    db: Session,
    user: User,
    actor: User,
    resource: Resource,
    action: Action,
    context: Context,
    *,
    proposed=(),
    allow_read_loss=False,
) -> Decision:
    return _evaluate(
        db,
        user,
        actor,
        resource,
        action,
        context,
        perm_service.resolve_capabilities(db, user, proposed=proposed),
        allow_read_loss=allow_read_loss,
    )


def check(db: Session, user: User, actor: User, body: CheckRequest) -> CheckResponse:
    current_snapshot = snapshot(db, user, actor)
    if body.expected_revision is not None:
        require_revision(current_snapshot, body.expected_revision)
    current = evaluate(db, user, actor, body.resource, body.action, body.context)
    proposed = None
    changes = []
    if body.proposed:
        patch = validate_patch(db, user, actor, body.proposed)
        proposed = evaluate(
            db,
            user,
            actor,
            body.resource,
            body.action,
            body.context,
            proposed=patch,
            allow_read_loss=True,
        )
        if current != proposed:
            changes = [
                Impact(resource=body.resource, action=body.action, before=current, after=proposed)
            ]
    return CheckResponse(
        snapshot=current_snapshot, current=current, proposed=proposed, impacts=changes
    )


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
        current = snapshot(db, target, actor)
        require_revision(current, expected)
        patch = validate_patch(db, target, actor, items)
        for capability, effect, expiry in patch:
            existing = db.get(UserPermission, (user_id, capability))
            if effect is None:
                if existing is not None:
                    db.delete(existing)
            elif existing is None:
                db.add(
                    UserPermission(
                        user_id=user_id, capability=capability, effect=effect, expires_at=expiry
                    )
                )
            else:
                existing.effect, existing.expires_at = effect, expiry
            auth_service.audit_permission_change(
                db,
                actor=actor.display_name or actor.email,
                user=target,
                capability=capability,
                effect=effect,
                expires_at=expiry,
                commit=False,
            )
        now = datetime.now(UTC)
        if (current.valid_until is not None and current.valid_until <= now) or any(
            expiry is not None and expiry <= now.replace(tzinfo=None) for _, _, expiry in patch
        ):
            raise AppError(
                "ACCESS_CHANGED", "The reviewed access evaluation expired.", http_status=412
            )
        db.commit()
        perm_service._invalidate_caps_cache(db, user_id)
        return target
    except Exception:
        db.rollback()
        raise
