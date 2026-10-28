"""Every book folder belongs to one desk box.

``book_folders.box`` is one of ``incoming``, ``outgoing``, ``done`` or
``archived`` (the desk scopes). Existing personal and team folders all move to
``incoming`` through the server default. Batch mode rebuilds ``book_folders``;
shares and filed items keep their ``folder_id`` rows.

Downgrade LOSES INFORMATION: every folder's box is dropped, so a later upgrade
puts every folder back in ``incoming``.

Revision ID: 0113_book_folder_box
Revises: 0112_ledger_book_importance
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0113_book_folder_box"
down_revision: str | Sequence[str] | None = "0112_ledger_book_importance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen copy: later edits to the model must not change this revision.
BOX_CHECK = "box IN ('incoming', 'outgoing', 'done', 'archived')"


def upgrade() -> None:
    with op.batch_alter_table("book_folders") as batch:
        batch.add_column(
            sa.Column("box", sa.String(length=10), nullable=False, server_default="incoming")
        )
        batch.create_check_constraint("ck_book_folders_box", BOX_CHECK)


def downgrade() -> None:
    with op.batch_alter_table("book_folders") as batch:
        batch.drop_constraint("ck_book_folders_box", type_="check")
        batch.drop_column("box")
