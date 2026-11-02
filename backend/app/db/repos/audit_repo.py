"""Append-only ``audit_log`` writes that leave the transaction to the caller."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from sqlalchemy.orm import Session

from app.db.models import AuditLog


def append_audit(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: int | str,
    actor: str | None,
    payload: Mapping[str, Any],
    ensure_ascii: bool = False,
) -> None:
    """Stage one audit row; never flushes or commits.

    The payload is JSON with ``default=str`` (dates, Decimals). Vehicle audit
    history has always been stored ASCII-escaped, so its callers pass
    ``ensure_ascii=True`` to keep the stored text byte-identical.
    """
    db.add(
        AuditLog(
            actor=actor,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            payload=json.dumps(payload, default=str, ensure_ascii=ensure_ascii),
        )
    )
