"""Drop the record-driven denies 0117 added that hid whole services and categories.

Revision ID: 0118_drop_record_category_overreach
Revises: 0117_merge_legacy_record_categories

0117 kept each record filed in a denied legacy category hidden. Where the
record's service did not file into that category (a form revised into a
General Book, a hand-filed or imported record), it added a deny on the
record's whole classification or service: one HR-filed ``5/1`` General Book
hid every ``5/1`` record, entry-permit letters included, from every user with
HR denied.

The record gates now cover such stray records exactly: a stray record answers
to the Other service and to its stored category as well as its own
(``record_categories.record_services`` / ``record_gate_categories``), so the
filing-service and Other denies 0117 copied, or the mapped category deny for
an old-only category, still hide it. For every target 0117 inserted or
changed, this revision sets what 0117 would have written without those extra
denies: the row's prior value with only the legacy overrides that copied to
it. That removes an extra deny, brings back a legacy grant it replaced, and
takes back an expiry an extra deny stretched.

A target is repaired only while it still holds what 0117 wrote. Which legacy
denies reached a target as extras comes from 0117's own record scan, rerun:
the replay of the prior value and those overrides with 0117's rules must match
the row, so a row an admin has since changed is left alone. When the scan no
longer finds any extra for the target (its stray record was deleted, revised
or refiled since 0117), the journal cannot say which of the user's other
legacy denies reached it, so the row is repaired if it matches the replay with
any combination of them. In both cases an admin's deny set to a value 0117
could have written cannot be told apart and is repaired too. A journal table
lets the downgrade put the removed denies back.
"""

from __future__ import annotations

import importlib.util
import json
from collections.abc import Sequence
from itertools import combinations
from pathlib import Path
from types import ModuleType
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "0118_drop_record_category_overreach"
down_revision: str | Sequence[str] | None = "0117_merge_legacy_record_categories"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BACKUP = "_record_category_overreach_backup"

Row = dict[str, Any]


def _merge_revision() -> ModuleType:
    """0117 itself: the replay must use the exact rules and record scan it ran."""
    path = Path(__file__).with_name("0117_merge_legacy_record_categories.py")
    spec = importlib.util.spec_from_file_location("_record_category_merge_0117", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _copied_targets(merge: ModuleType, category: str) -> tuple[str, ...]:
    """The targets 0117 copied a legacy override to, before its record-driven extras."""
    services = merge._SERVICES_FILING_INTO_LEGACY_CATEGORY.get(category)
    if not services:
        return (
            merge._CATEGORY_PREFIX + merge._LEGACY_CATEGORY_RECORD_CATEGORY.get(category, "15/1"),
        )
    return tuple(
        f"{prefix}{service}"
        for service in (*services, merge._OTHER_SERVICE)
        for prefix in ("books.service.", "books.servicerecords.")
    )


def _copy(merge: ModuleType, row: Row | None, source: Row, target: str) -> Row | None:
    """0117's ``_copy_override`` applied to an in-memory row."""
    effect, expiry = source["effect"], source["expires_at"]
    if row is None:
        service = target.removeprefix("books.servicerecords.").removeprefix("books.service.")
        if effect == "grant" and service in merge._OPT_IN_SERVICE_IDS:
            return None
        return {"effect": effect, "expires_at": expiry}
    if effect == "deny":
        if row["effect"] == "grant" or None in (expiry, row["expires_at"]):
            return {"effect": "deny", "expires_at": None}
        return {"effect": "deny", "expires_at": max(str(expiry), str(row["expires_at"]))}
    if (
        row["effect"] == "grant"
        and expiry is not None
        and (row["expires_at"] is None or str(expiry) < row["expires_at"])
    ):
        return {"effect": "grant", "expires_at": str(expiry)}
    return row


def _replay(
    merge: ModuleType, prior: Row | None, sources: Sequence[Row], target: str
) -> Row | None:
    """Apply legacy ``sources`` to ``prior`` in 0117's order (by capability)."""
    row = prior
    for source in sorted(sources, key=lambda source: str(source["capability"])):
        row = _copy(merge, row, source, target)
    return row


def upgrade() -> None:
    op.create_table(
        _BACKUP,
        sa.Column("user_id", sa.Integer(), primary_key=True),
        sa.Column("capability", sa.String(length=128), primary_key=True),
        sa.Column("row_data", sa.Text(), nullable=False),
    )
    merge = _merge_revision()
    connection = op.get_bind()
    journal = (
        connection.execute(
            sa.text(f"SELECT row_key, row_data FROM {merge._BACKUP} WHERE kind = 'user'")
        )
        .mappings()
        .all()
    )
    # Legacy sources per user, and the targets 0117 touched.
    sources: dict[int, list[tuple[str, Row]]] = {}
    touched: list[tuple[int, str, Row | None]] = []
    for entry in journal:
        user_id, capability = json.loads(entry["row_key"])
        prior = json.loads(entry["row_data"]) if entry["row_data"] is not None else None
        category = merge._legacy_category(capability)
        if category is None:
            row = None if prior is None else {k: prior[k] for k in ("effect", "expires_at")}
            touched.append((user_id, capability, row))
        elif prior is not None:
            sources.setdefault(user_id, []).append((category, prior))
    extras: dict[str, tuple[str, ...]] = {}

    def targets_of(category: str, source: Row) -> tuple[str, ...]:
        copied = _copied_targets(merge, category)
        if source["effect"] != "deny":
            return copied
        if category not in extras:
            extras[category] = merge._uncovered_record_targets(connection, category, copied)
        return (*copied, *extras[category])

    for user_id, capability, prior in touched:
        user_sources = sources.get(user_id, [])
        copying: list[Row] = []
        extra: list[Row] = []
        uncopied_denies: list[Row] = []
        for category, source in user_sources:
            if capability in _copied_targets(merge, category):
                copying.append(source)
            elif source["effect"] == "deny":
                uncopied_denies.append(source)
                if capability in targets_of(category, source):
                    extra.append(source)
        intended = _replay(merge, prior, copying, capability)
        if extra:
            written = [_replay(merge, prior, [*copying, *extra], capability)]
        else:
            written = [
                _replay(merge, prior, [*copying, *chosen], capability)
                for size in range(1, len(uncopied_denies) + 1)
                for chosen in combinations(uncopied_denies, size)
            ]
        key = {"user_id": user_id, "capability": capability}
        current = (
            connection.execute(
                sa.text(
                    "SELECT effect, expires_at FROM user_permissions "
                    "WHERE user_id = :user_id AND capability = :capability"
                ),
                key,
            )
            .mappings()
            .first()
        )
        if current is None or dict(current) == intended or dict(current) not in written:
            continue
        connection.execute(
            sa.text(
                f"INSERT INTO {_BACKUP} (user_id, capability, row_data) "
                "VALUES (:user_id, :capability, :row_data)"
            ),
            {**key, "row_data": json.dumps(dict(current))},
        )
        if intended is None:
            connection.execute(
                sa.text(
                    "DELETE FROM user_permissions "
                    "WHERE user_id = :user_id AND capability = :capability"
                ),
                key,
            )
        else:
            connection.execute(
                sa.text(
                    "UPDATE user_permissions SET effect = :effect, expires_at = :expires_at "
                    "WHERE user_id = :user_id AND capability = :capability"
                ),
                {**key, "effect": intended["effect"], "expires_at": intended["expires_at"]},
            )


def downgrade() -> None:
    connection = op.get_bind()
    entries = (
        connection.execute(sa.text(f"SELECT user_id, capability, row_data FROM {_BACKUP}"))
        .mappings()
        .all()
    )
    for entry in entries:
        row = json.loads(entry["row_data"])
        connection.execute(
            sa.text(
                "INSERT INTO user_permissions (user_id, capability, effect, expires_at) "
                "SELECT :user_id, :capability, :effect, :expires_at "
                "WHERE EXISTS (SELECT 1 FROM users WHERE id = :user_id) "
                "ON CONFLICT (user_id, capability) DO UPDATE "
                "SET effect = excluded.effect, expires_at = excluded.expires_at"
            ),
            {
                "user_id": entry["user_id"],
                "capability": entry["capability"],
                "effect": row["effect"],
                "expires_at": row["expires_at"],
            },
        )
    op.drop_table(_BACKUP)
