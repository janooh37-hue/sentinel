"""editor_templates table — reusable HTML snippets for the HugeRTE editor.

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-21

Stores saved HTML snippets that the user can load into the rich-text editor
on the Ledger page (e.g. boilerplate letter bodies).

Soft-delete via ``deleted_at``.  The unique index is partial
(``WHERE deleted_at IS NULL``) so a freshly-deleted name can be re-used by a
new row; SQLite has supported partial indexes since 3.8.0 which is well below
the project's min version.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "editor_templates",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("html", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )

    op.create_index(
        "ix_editor_templates_name",
        "editor_templates",
        ["name"],
        unique=True,
        sqlite_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_editor_templates_name", table_name="editor_templates")
    op.drop_table("editor_templates")
