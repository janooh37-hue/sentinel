"""Add signature placement history: BookVersion.signature_revision counter
and the signature_artifact_revisions append-only history table.

Revision ID: 0090_signature_placement
Revises: 0089_vehicle_fines_ledger

No speculative historical backfill: every existing BookVersion row gets
``signature_revision=0`` (no active tracked signature artifact), which is
correct — the registry only starts once a correction/identification
actually runs against a document carrying the new signature-identity
markers. No production signature is retroactively "signed" by this
migration.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0090_signature_placement"
down_revision = "0089_vehicle_fines_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("book_versions") as batch:
        batch.add_column(
            sa.Column(
                "signature_revision",
                sa.Integer(),
                nullable=False,
                server_default="0",
            )
        )

    op.create_table(
        "signature_artifact_revisions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "version_id",
            sa.Integer(),
            sa.ForeignKey("book_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("source_kind", sa.String(length=16), nullable=False),
        sa.Column("signer_user_id", sa.Integer(), nullable=True),
        sa.Column("docx_path", sa.Text(), nullable=False),
        sa.Column("primary_pdf_path", sa.Text(), nullable=True),
        sa.Column("published_pdf_path", sa.Text(), nullable=True),
        sa.Column("previous_published_pdf_path", sa.Text(), nullable=True),
        sa.Column("docx_sha256", sa.String(length=64), nullable=False),
        sa.Column("manifest", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("signature_id", sa.String(length=36), nullable=True),
        sa.Column("before_geometry", sa.JSON(), nullable=True),
        sa.Column("after_geometry", sa.JSON(), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "version_id", "revision", name="uq_signature_artifact_revisions_version_revision"
        ),
    )
    op.create_index(
        "ix_signature_artifact_revisions_version",
        "signature_artifact_revisions",
        ["version_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_signature_artifact_revisions_version", table_name="signature_artifact_revisions"
    )
    op.drop_table("signature_artifact_revisions")

    with op.batch_alter_table("book_versions") as batch:
        batch.drop_column("signature_revision")
