"""Canonical ETag and optimistic-concurrency helpers for workforce records."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping

from app.api.errors import ConflictError


def etag_for(value: object) -> str:
    """A quoted strong tag over canonical non-secret state."""
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return '"' + hashlib.sha256(encoded).hexdigest() + '"'


def row_etag(row: object, *, extra: Mapping[str, object] | None = None) -> str:
    return etag_for(
        {
            "id": getattr(row, "id", None),
            "updated_at": getattr(row, "updated_at", None),
            "created_at": getattr(row, "created_at", None),
            **(dict(extra) if extra else {}),
        }
    )


def require_if_match(
    if_match: str | None,
    current: str,
    *,
    code: str = "WORKFORCE_VERSION_CONFLICT",
) -> None:
    if if_match is None or if_match != current:
        raise ConflictError(code, "The workforce record was modified; refresh and retry.")


__all__ = ["etag_for", "require_if_match", "row_etag"]
