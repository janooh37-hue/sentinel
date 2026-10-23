"""Department sends and department-id audiences for team folders.

Revision ID: 0112_department_sends
Revises: 0111_book_department
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0112_department_sends"
down_revision: str | Sequence[str] | None = "0111_book_department"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "book_department_sends",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "book_id", sa.Integer(), sa.ForeignKey("books.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=False),
        sa.Column(
            "parent_send_id", sa.Integer(), sa.ForeignKey("book_department_sends.id"), nullable=True
        ),
        sa.Column("sent_by_user_id", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.String(16), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_by_user_id", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "purpose IN ('info', 'action', 'reply', 'circulate')",
            name="ck_book_department_sends_purpose",
        ),
    )
    op.create_index("ix_book_department_sends_book", "book_department_sends", ["book_id"])
    op.create_index("ix_book_department_sends_parent", "book_department_sends", ["parent_send_id"])
    op.create_index(
        "uq_book_department_sends_active",
        "book_department_sends",
        ["book_id", "department_id"],
        unique=True,
        sqlite_where=sa.text("revoked_at IS NULL"),
    )
    # Existing SQLite tables use application-side integrity, not new named FKs.
    with op.batch_alter_table("book_recipients") as batch:
        batch.add_column(sa.Column("department_send_id", sa.Integer(), nullable=True))
        batch.create_index("ix_book_recipients_department_send_id", ["department_send_id"])
    with op.batch_alter_table("book_folder_shares") as batch:
        batch.add_column(sa.Column("department_id", sa.Integer(), nullable=True))
        batch.drop_constraint("ck_book_folder_shares_target", type_="check")
        batch.create_check_constraint(
            "ck_book_folder_shares_target",
            "(user_id IS NOT NULL AND department_id IS NULL AND department IS NULL) OR "
            "(user_id IS NULL AND department_id IS NOT NULL AND department IS NULL) OR "
            "(user_id IS NULL AND department_id IS NULL AND department IS NOT NULL)",
        )
        batch.create_unique_constraint(
            "uq_book_folder_shares_department_id", ["folder_id", "department_id"]
        )

    connection = op.get_bind()
    # Keep unmatched and ambiguous text audiences restricted rather than guessing.
    matches = connection.execute(
        sa.text(
            "SELECT shares.id, shares.folder_id, MIN(departments.id) AS department_id "
            "FROM book_folder_shares AS shares JOIN departments ON "
            "lower(trim(shares.department)) IN "
            "(lower(trim(departments.name_en)), lower(trim(departments.name_ar))) "
            "GROUP BY shares.id, shares.folder_id HAVING COUNT(*) = 1 ORDER BY shares.id"
        )
    ).all()
    mapped: set[tuple[int, int]] = set()
    for share_id, folder_id, department_id in matches:
        audience = (folder_id, department_id)
        if audience in mapped:
            # English, Arabic and whitespace aliases grant the same audience once.
            connection.execute(
                sa.text("DELETE FROM book_folder_shares WHERE id = :id"), {"id": share_id}
            )
        else:
            connection.execute(
                sa.text(
                    "UPDATE book_folder_shares SET department_id = :department_id, "
                    "department = NULL WHERE id = :id"
                ),
                {"department_id": department_id, "id": share_id},
            )
            mapped.add(audience)


def downgrade() -> None:
    connection = op.get_bind()
    # Snapshot membership grants as explicit users: names and employee labels
    # cannot represent the current department audience on the older schema.
    connection.execute(
        sa.text(
            "INSERT INTO book_folder_shares (folder_id, user_id) "
            "SELECT DISTINCT shares.folder_id, members.user_id "
            "FROM book_folder_shares AS shares JOIN department_members AS members "
            "ON members.department_id = shares.department_id "
            "WHERE shares.department_id IS NOT NULL AND NOT EXISTS ("
            "SELECT 1 FROM book_folder_shares AS existing "
            "WHERE existing.folder_id = shares.folder_id AND existing.user_id = members.user_id)"
        )
    )
    # With no remaining audience, deleting the last department leg would make
    # the folder public. Keep it restricted to its creator instead.
    connection.execute(
        sa.text(
            "INSERT INTO book_folder_shares (folder_id, user_id) "
            "SELECT folders.id, folders.created_by_user_id FROM book_folders AS folders "
            "WHERE EXISTS (SELECT 1 FROM book_folder_shares AS shares "
            "WHERE shares.folder_id = folders.id AND shares.department_id IS NOT NULL) "
            "AND NOT EXISTS (SELECT 1 FROM book_folder_shares AS retained "
            "WHERE retained.folder_id = folders.id AND retained.department_id IS NULL)"
        )
    )
    connection.execute(sa.text("DELETE FROM book_folder_shares WHERE department_id IS NOT NULL"))
    with op.batch_alter_table("book_folder_shares") as batch:
        batch.drop_constraint("ck_book_folder_shares_target", type_="check")
        batch.drop_constraint("uq_book_folder_shares_department_id", type_="unique")
        batch.drop_column("department_id")
        batch.create_check_constraint(
            "ck_book_folder_shares_target",
            "(user_id IS NOT NULL AND department IS NULL) OR "
            "(user_id IS NULL AND department IS NOT NULL)",
        )
    with op.batch_alter_table("book_recipients") as batch:
        batch.drop_index("ix_book_recipients_department_send_id")
        batch.drop_column("department_send_id")
    op.drop_table("book_department_sends")
