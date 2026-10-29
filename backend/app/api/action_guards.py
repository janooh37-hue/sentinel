"""Route dependencies for shared action policy decisions."""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.permissions import ALL_CAPABILITIES
from app.core.roles import ADMIN_ROLE
from app.db.models import User
from app.db.session import get_db
from app.services import perm_service
from app.services.action_guard_service import template_decision


def require_template_action(kind: str, action: str):
    def dependency(
        user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ) -> User:
        # Admin capability authority is unconditional; do not open a policy
        # transaction merely to project it for a route guard.
        caps = (
            ALL_CAPABILITIES if user.role == ADMIN_ROLE else perm_service.effective_caps(db, user)
        )
        template_decision(caps, kind, action).require()
        return user

    return dependency
