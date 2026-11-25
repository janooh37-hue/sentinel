"""Copy Passport Release List denies onto the Work ID and UAE ID release lists.

Revision ID: 0124_id_release_denies
Revises: 0123_backfill_workforce_org_scope

The Work ID and UAE ID release lists are default-granted service capabilities, like
the Passport Release List they were cloned from. Without this copy, a user an admin
had denied Passport Release would gain both new services on deploy: their tiles,
their records, and the nationality / Emirates ID prefill of the employee lookup.

For every user_permissions deny on books.service.Passport Release List or
books.servicerecords.Passport Release List, insert the same (user_id, 'deny',
expires_at) for the matching capability of both new services, unless that user
already has a row for the target capability (grant or deny).

A temporary grant (expires_at set) on these dynamic capabilities can only replace
an existing deny (perm_service TEMPORARY_GRANT_REQUIRES_DENY), and once it expires
the sweep rewrites it to a standing deny. It is a suspended deny, so it is copied
as 'deny' with expires_at NULL: the time-boxed exception covers Passport Release
only. Permanent grants (expires_at NULL) are not copied.

Service capabilities are OR-ed into every role at resolution time, and
role_permissions has no effect column, so there are no role-level denies to copy.

Downgrade deletes a new-service deny only when the same user still holds a matching
Passport Release source: a deny with the same expires_at, or a temporary grant when
the target's expires_at is NULL. Tradeoff: an identical deny, whenever it was
created, is indistinguishable from a copy and is removed too (re-upgrading
recreates it); a copy whose Passport source was later changed or removed is kept,
which leaves the user denied.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0124_id_release_denies"
down_revision: str | Sequence[str] | None = "0123_backfill_workforce_org_scope"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SOURCE = "Passport Release List"
TARGETS = ("Work ID Release List", "UAE ID Release List")
FAMILIES = ("books.service.", "books.servicerecords.")


def _pairs() -> list[dict[str, str]]:
    return [
        {"source": family + SOURCE, "target": family + target}
        for family in FAMILIES
        for target in TARGETS
    ]


def upgrade() -> None:
    conn = op.get_bind()
    insert = sa.text(
        "INSERT INTO user_permissions (user_id, capability, effect, expires_at) "
        "SELECT up.user_id, :target, 'deny', "
        "CASE WHEN up.effect = 'deny' THEN up.expires_at END "
        "FROM user_permissions AS up "
        "WHERE up.capability = :source "
        "AND (up.effect = 'deny' OR up.expires_at IS NOT NULL) "
        "AND NOT EXISTS ("
        "SELECT 1 FROM user_permissions AS existing "
        "WHERE existing.user_id = up.user_id AND existing.capability = :target"
        ")"
    )
    for pair in _pairs():
        conn.execute(insert, pair)


def downgrade() -> None:
    conn = op.get_bind()
    delete = sa.text(
        "DELETE FROM user_permissions "
        "WHERE capability = :target AND effect = 'deny' "
        "AND EXISTS ("
        "SELECT 1 FROM user_permissions AS source "
        "WHERE source.user_id = user_permissions.user_id "
        "AND source.capability = :source "
        "AND ("
        "(source.effect = 'deny' AND source.expires_at IS user_permissions.expires_at) "
        "OR (source.effect = 'grant' AND source.expires_at IS NOT NULL "
        "AND user_permissions.expires_at IS NULL)"
        ")"
        ")"
    )
    for pair in _pairs():
        conn.execute(delete, pair)
