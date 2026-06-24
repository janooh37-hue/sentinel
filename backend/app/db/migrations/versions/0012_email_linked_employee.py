"""email_accounts: linked_employee_id FK for identity linking.

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-21

Adds a nullable ``linked_employee_id`` FK on the single EmailAccount row.
Set when the operator links their configured email to an Employee record
during first-time setup. Drives /identity/me and default submitter/author
behaviour across forms.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | Sequence[str] | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

log = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    with op.batch_alter_table("email_accounts") as batch:
        batch.add_column(
            sa.Column(
                "linked_employee_id",
                sa.String(16),
                sa.ForeignKey(
                    "employees.id",
                    name="fk_email_accounts_linked_employee_id",
                    ondelete="SET NULL",
                ),
                nullable=True,
            )
        )

    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, imap_host, smtp_host FROM email_accounts")
    ).fetchall()
    for row in rows:
        if row.imap_host != "imap.ionos.com" or row.smtp_host != "smtp.ionos.com":
            log.warning(
                "email_accounts row id=%s has non-IONOS host(s) "
                "(imap=%s smtp=%s). IONOS-only validator will reject future upserts.",
                row.id,
                row.imap_host,
                row.smtp_host,
            )


def downgrade() -> None:
    with op.batch_alter_table("email_accounts") as batch:
        batch.drop_column("linked_employee_id")
