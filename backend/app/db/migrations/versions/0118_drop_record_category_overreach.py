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
to the Other service, and one in a retired category to that category's mapped
record category (``record_categories.record_services`` /
``record_gate_categories``), so the filing-service and Other denies 0117
copied, or the mapped category deny for an old-only category, still hide it.

This revision repairs only what 0117's own journal proves was such an extra.
0117 journals a target only when it writes it, so a journaled target that no
legacy override copies to was written by an extra deny alone. Replaying the
user's legacy denies over the journaled prior value with 0117's rules gives
what it wrote; when every combination of those denies gives the same value
(always so for one deny, or for permanent ones), that value is certain, and a
row still holding it gets its prior value back. The live records are never
consulted: they may have changed since 0117.

Left as they are (fail-closed): a target some legacy override also copied to,
where the journal cannot show whether an extra reached it; a target whose
value depends on which of several differently-dated denies reached it; and a
row an admin has since changed. An admin's deny set to the very value 0117
wrote cannot be told apart and is repaired too. A journal table lets the
downgrade put the removed denies back.
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
    """0117 itself: the frozen maps it copied legacy overrides with."""
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


def _replay_denies(prior: Row | None, denies: Sequence[Row]) -> Row | None:
    """0117's ``_copy_override`` for legacy denies, applied in its order (by capability)."""
    row = prior
    for deny in sorted(denies, key=lambda source: str(source["capability"])):
        expiry = deny["expires_at"]
        if row is None:
            row = {"effect": "deny", "expires_at": expiry}
        elif row["effect"] == "grant" or None in (expiry, row["expires_at"]):
            row = {"effect": "deny", "expires_at": None}
        else:
            row = {"effect": "deny", "expires_at": max(str(expiry), str(row["expires_at"]))}
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
    for user_id, capability, prior in touched:
        user_sources = sources.get(user_id, [])
        if any(capability in _copied_targets(merge, category) for category, _ in user_sources):
            continue
        denies = [source for _, source in user_sources if source["effect"] == "deny"]
        possible = {
            json.dumps(_replay_denies(prior, chosen), sort_keys=True)
            for size in range(1, len(denies) + 1)
            for chosen in combinations(denies, size)
        }
        if len(possible) != 1:
            continue
        written = json.loads(possible.pop())
        intended = prior
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
        if current is None or dict(current) == intended or dict(current) != written:
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
