"""absence boundary becomes twice the grace on every collapsed policy.

Revision ID: 0073_absence_after_twice_grace
Revises: 0072_punch_profiles
Create Date: 2026-08-20

The installed policies put ``absence_after_minutes`` on the grace itself, so the
same instant both ended the grace and condemned a no-show. The site's rule has
two steps: past the grace is late, twice the grace with no punch at all is
absent.

Scope: every approved or draft policy whose two boundaries coincide, the global
default and any shift-scoped row alike - they carry the same defect, and the
table's own CHECK (``absence_after_minutes >= grace_minutes``) means "coincide"
is exactly what the predicate below selects. A policy an operator widened past
the grace is left alone. A zero grace is skipped rather than pretend-updated:
doubling zero changes nothing, and a site that configured no grace at all is
asking for a different conversation, not a silent rewrite.

Approved rows are amended in place, without a superseding version. That is
deliberate: this value was never a decision anyone approved, it was the seed's
placeholder, and the site owner asked for twice the grace. Existing verdicts are
not rewritten - ``absence_after_minutes`` is inside the evaluator's decision
fingerprint, so each case re-derives on its next evaluation and the append-only
history keeps what was decided under the old boundary.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0073_absence_after_twice_grace"
down_revision: str | Sequence[str] | None = "0072_punch_profiles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE work_attendance_policies
           SET absence_after_minutes = grace_minutes * 2
         WHERE absence_after_minutes <= grace_minutes
           AND grace_minutes > 0
        """
    )


def downgrade() -> None:
    """Deliberately empty: the forward pass is not identifiably reversible.

    After this revision a policy at twice the grace is the intended steady state
    - the seeder writes it directly - so no predicate can tell a row this
    migration widened from one the seeder or an operator authored. Narrowing them
    all back would re-collapse the boundary on rows that were never touched here,
    which is the harmful direction: it marks people absent half an hour early.
    """
