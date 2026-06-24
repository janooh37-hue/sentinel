"""Pure helpers for 0024 backfill — kept DB-free so they can be unit-tested."""

from __future__ import annotations

from typing import Any


def plan_backfill(
    books: list[dict[str, Any]],
    documents: list[dict[str, Any]],
    steps: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (version_rows_to_insert, step_updates).

    Each book gets one v1. document_id/template_id come from the book's primary
    Document (matched on ref_number, role='primary') when present, else NULL.
    Every existing step is repointed to its book's v1 (version_no=1).

    Note: ``version_no`` in each step_updates dict is for readability and test
    assertion only; the migration resolves each book's real v1 id at apply time
    via a SELECT and does not use version_no for the UPDATE.
    """
    primary_by_ref: dict[str, dict[str, Any]] = {}
    for d in documents:
        if d.get("role") == "primary":
            primary_by_ref.setdefault(d["ref_number"], d)

    versions: list[dict[str, Any]] = []
    for b in books:
        doc = primary_by_ref.get(b["ref_number"])
        versions.append({
            "book_id": b["id"],
            "version_no": 1,
            "document_id": doc["id"] if doc else None,
            "template_id": doc["template_id"] if doc else None,
            "fields": None,
            "trigger": "initial",
            "status": b["approval_state"],
            "created_by_user_id": b.get("submitted_by_user_id"),
            "created_at": b["created_at"],
        })

    step_updates = [{"step_id": s["id"], "book_id": s["book_id"], "version_no": 1} for s in steps]
    return versions, step_updates
