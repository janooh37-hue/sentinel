"""Route dependencies for shared action policy decisions."""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.services import perm_service
from app.services.action_guard_service import template_decision


def require_template_action(kind: str, action: str):
    def dependency(
        user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ) -> User:
        template_decision(perm_service.effective_caps(db, user), kind, action).require()
        return user

    return dependency
