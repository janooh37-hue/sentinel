"""Forms signing paths: default-manager + merge-sources columns; state remap.

Revision ID: 0034_forms_signing_paths
Revises: 0033_recipient_lists
Create Date: 2026-06-11

users:
  + is_default_manager BOOLEAN NOT NULL default '0' — the single manager
    preselected as assignee when an in_app form is submitted.

books:
  + merged_attachment_paths JSON NOT NULL default '[]' — the attachment
    sources merged into the combined PDF, as [{path, slot_key}] dicts
    (distinct from attachment_paths, the film-strip scan papers).

Data remap (spec §8) — only books whose CURRENT version (max version_no)
has a template_id (v4-generated; legacy v3 imports stay untouched) and whose
approval_state is still 'none':
  - auto-path templates           → approved (book + current version)
  - Violation/Acknowledgment with attachments
                                  → approved; signed_pdf_path = last attachment
  - Violation/Acknowledgment without
                                  → awaiting_scan
  - Material Request Form / General Book → untouched (MR has no assignee yet —
    the default-manager column is born empty; General Book keeps its chain).

The four exception template_ids are hardcoded here on purpose (frozen-in-time
semantics): the live policy in app.core.form_policy may evolve, but this
migration must always replay the 2026-06-11 mapping.

The data remap is ONE-WAY: downgrade drops the two columns only and does not
restore pre-remap approval states.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0034_forms_signing_paths"
down_revision: str | Sequence[str] | None = "0033_recipient_lists"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCAN = ("Violation Form", "Acknowledgment Form")


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column(
                "is_default_manager", sa.Boolean(), nullable=False, server_default="0"
            )
        )

    with op.batch_alter_table("books") as batch:
        batch.add_column(
            sa.Column(
                "merged_attachment_paths", sa.JSON(), nullable=False, server_default="[]"
            )
        )

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            """
            SELECT b.id AS book_id, b.attachment_paths AS att, v.id AS version_id, v.template_id AS tid
            FROM books b
            JOIN book_versions v ON v.book_id = b.id
            JOIN (SELECT book_id, MAX(version_no) AS mv FROM book_versions GROUP BY book_id) m
              ON m.book_id = v.book_id AND m.mv = v.version_no
            WHERE b.approval_state = 'none' AND v.template_id IS NOT NULL
            """
        )
    ).fetchall()
    for r in rows:
        tid = r.tid
        if tid in ("Material Request Form", "General Book"):
            continue
        if tid in _SCAN:
            atts = json.loads(r.att or "[]")
            if atts:
                bind.execute(
                    sa.text("UPDATE books SET approval_state='approved' WHERE id=:b"),
                    {"b": r.book_id},
                )
                bind.execute(
                    sa.text(
                        "UPDATE book_versions SET status='approved', signed_pdf_path=:p WHERE id=:v"
                    ),
                    {"p": atts[-1], "v": r.version_id},
                )
            else:
                bind.execute(
                    sa.text("UPDATE books SET approval_state='awaiting_scan' WHERE id=:b"),
                    {"b": r.book_id},
                )
                bind.execute(
                    sa.text("UPDATE book_versions SET status='awaiting_scan' WHERE id=:v"),
                    {"v": r.version_id},
                )
        else:  # auto path
            bind.execute(
                sa.text("UPDATE books SET approval_state='approved' WHERE id=:b"),
                {"b": r.book_id},
            )
            bind.execute(
                sa.text("UPDATE book_versions SET status='approved' WHERE id=:v"),
                {"v": r.version_id},
            )


def downgrade() -> None:
    # Schema only — the state remap is one-way (see module docstring).
    with op.batch_alter_table("books") as batch:
        batch.drop_column("merged_attachment_paths")

    with op.batch_alter_table("users") as batch:
        batch.drop_column("is_default_manager")
