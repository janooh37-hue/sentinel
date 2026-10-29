"""Route dependencies for shared action policy decisions."""

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.permissions import ALL_CAPABILITIES
from app.core.roles import ADMIN_ROLE
from app.db.models import User
from app.db.session import get_db
from app.services import perm_service, template_capability_service
from app.services.action_guard_service import template_decision


def require_template_action(kind: str, action: str):
    def dependency(
        request: Request,
        user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ) -> User:
        # Admin capability authority is unconditional; do not open a policy
        # transaction merely to project it for a route guard.
        caps = (
            ALL_CAPABILITIES | template_capability_service.capability_ids()
            if user.role == ADMIN_ROLE
            else perm_service.effective_caps(db, user)
        )
        identifier = None
        if kind == "notification_template":
            from app.services.message_template_service import require_event

            identifier = request.path_params["event"]
            require_event(identifier)
        elif kind == "email_template":
            from app.api.errors import ValidationFailedError
            from app.services.email_draft_template_service import KEY_FAMILIES

            identifier = request.path_params["key"]
            if identifier not in KEY_FAMILIES:
                raise ValidationFailedError(
                    "UNKNOWN_KEY", "Unknown email draft template key", key=identifier
                )
        template_decision(caps, kind, action, identifier).require()
        return user

    return dependency
