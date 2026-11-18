"""Backfill organization scope for existing, unscoped attendance reviewers.

Revision ID: 0120_backfill_workforce_org_scope
Revises: 0119_employee_former_ids

Capabilities authorize actions, but attendance also requires employee scope.
Give non-admin holders of both workforce.people.view and
workforce.attendance.review an organization row only if they have no scope rows.
The inmate_reporter hard ceiling excludes both capabilities, even if stale role
rows or overrides purport to grant them. Role rows grant directly (there is no
enabled flag); user denies and expired grants remove role-granted capabilities.
Neither required capability belongs to the implicit dynamic capability families
or to the fallback operator/manager presets, so those add no grants here.

Rows are marked with created_by_user_id = user_id and the fixed BACKFILL_AT.
Downgrade deletes only organization rows with both markers. A later admin PUT
replaces the rows with fresh creator/time values, so that explicit grant survives.
A pre-existing row with the exact same markers is indistinguishable and would
also be removed by downgrade.
"""

from __future__ import annotations

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0120_backfill_workforce_org_scope"
down_revision: str | None = "0119_employee_former_ids"
branch_labels: str | None = None
depends_on: str | None = None

BACKFILL_AT = datetime(2026, 11, 18, 0, 0, 0)


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            """
            INSERT INTO user_workforce_scopes
                (user_id, scope_kind, created_by_user_id, created_at)
            SELECT u.id, 'organization', u.id, :backfill_at
            FROM users AS u
            WHERE u.role NOT IN ('admin', 'inmate_reporter')
              AND NOT EXISTS (
                  SELECT 1 FROM user_workforce_scopes AS s WHERE s.user_id = u.id
              )
              AND NOT EXISTS (
                  SELECT 1 FROM (
                      SELECT 'workforce.people.view' AS capability
                      UNION ALL SELECT 'workforce.attendance.review'
                  ) AS required
                  WHERE NOT (
                      EXISTS (
                          SELECT 1 FROM user_permissions AS p
                          WHERE p.user_id = u.id AND p.capability = required.capability
                            AND p.effect = 'grant'
                            AND (p.expires_at IS NULL OR p.expires_at > :now)
                      )
                      OR (
                          EXISTS (
                              SELECT 1 FROM role_permissions AS r
                              WHERE r.role = u.role AND r.capability = required.capability
                          )
                          AND NOT EXISTS (
                              SELECT 1 FROM user_permissions AS p
                              WHERE p.user_id = u.id AND p.capability = required.capability
                          )
                      )
                  )
              )
            """
        ).bindparams(
            sa.bindparam("backfill_at", type_=sa.DateTime()),
            sa.bindparam("now", type_=sa.DateTime()),
        ),
        {"backfill_at": BACKFILL_AT, "now": datetime.now(UTC).replace(tzinfo=None)},
    )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text(
            """
            DELETE FROM user_workforce_scopes
            WHERE scope_kind = 'organization'
              AND created_by_user_id = user_id
              AND created_at = :backfill_at
            """
        ).bindparams(sa.bindparam("backfill_at", type_=sa.DateTime())),
        {"backfill_at": BACKFILL_AT},
    )
