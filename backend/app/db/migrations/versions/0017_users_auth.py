"""users + auth_sessions: multi-user authentication.

Revision ID: 0017
Revises: 0016
Create Date: 2026-05-24

Adds the two tables behind multi-user login (see
``docs/superpowers/plans/2026-05-24-multi-user-login.md``):

* ``users`` — one account per person. ``email`` (lowercased) is the login id,
  ``password_hash`` is a bcrypt digest, ``role`` / ``status`` are
  admin-managed. The first registered account auto-promotes to ``admin`` and
  fills ``settings.admin_employee_id`` (handled in ``auth_service``, not here).
* ``auth_sessions`` — server-side sessions backing the httpOnly ``gssg_session``
  cookie. Only the sha256 of the opaque cookie token is stored.

Additive only — no existing rows are touched. An upgraded DB has zero users, so
the first visit lands on the login screen and the first ``register`` bootstraps
the admin.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | Sequence[str] | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("email", sa.String(length=256), nullable=False),
        sa.Column("password_hash", sa.String(length=128), nullable=False),
        sa.Column(
            "employee_id",
            sa.String(length=16),
            sa.ForeignKey("employees.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("display_name", sa.String(length=256), nullable=True),
        sa.Column(
            "role",
            sa.String(length=16),
            nullable=False,
            server_default="operator",
        ),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "failed_attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("locked_at", sa.DateTime(), nullable=True),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )

    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.Column("user_agent", sa.String(length=256), nullable=True),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.create_index(
        "ix_auth_sessions_token_hash", "auth_sessions", ["token_hash"], unique=True
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_token_hash", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_table("users")
