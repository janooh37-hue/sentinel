"""Record employee creators and exclude historical bulk additions from activity.

Five or more employees created in one minute denotes a bulk operation. In
production that marks 278 employees in one minute on 2026-06-24 (v3 go-live
import) and 22 in one minute on 2026-07-01 (scripted batch). The 55 individual
additions stay visible, with no inferred creator.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0125_employee_added_source"
down_revision: str | Sequence[str] | None = "0124_id_release_denies"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        # A foreign key would force a full SQLite table rewrite.
        batch.add_column(sa.Column("created_by_user_id", sa.Integer(), nullable=True))
        batch.add_column(
            sa.Column("imported", sa.Boolean(), nullable=False, server_default=sa.false())
        )

    op.execute(
        """
        UPDATE employees
        SET imported = 1
        WHERE strftime('%Y-%m-%d %H:%M', created_at) IN (
            SELECT strftime('%Y-%m-%d %H:%M', created_at)
            FROM employees
            GROUP BY 1
            HAVING count(*) >= 5
        )
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.drop_column("imported")
        batch.drop_column("created_by_user_id")
