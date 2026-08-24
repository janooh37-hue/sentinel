---
name: "new-migration"
description: "Create a reversible SQLite-safe Alembic migration after the user explicitly asks, preserving a single sequential migration head."
---

# /new-migration — scaffold a safe Alembic revision

Migrations run against **SQLite** on the **live** machine, so two rules dominate:
a **single linear head** (a split history forced the emergency `0048` merge
once) and **SQLite's batch-ALTER limits**. Revision IDs are hand-numbered with a
zero-padded `NNNN_` prefix — NOT Alembic's default hashes.

All commands use the project venv from the repo root.

## Steps

### 1. Confirm a single head and get the next number
```
venv\Scripts\alembic.exe heads
venv\Scripts\alembic.exe current
```
There must be exactly **one** head. If there are two, STOP and merge first (see
"Merging heads" below) — do not stack a new revision on a fork. Note the head's
number `NNNN`; the new revision is `NNNN+1`, same zero-padding (e.g. head
`0048_...` → new `0049_...`).

### 2. Create the revision with an explicit id chained onto the tip
```
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "venv\Scripts\alembic.exe revision --rev-id 0049_short_slug --head 0048_merge_sms_scaninbox -m 'short slug'"
```
- `--rev-id 0049_short_slug` sets both the revision id and the filename prefix.
- `--head <current tip>` makes `down_revision` point at the tip (no fork).
- Keep the slug short, lowercase, snake_case — it becomes the id used everywhere.
- Do NOT use `--autogenerate`: SQLite autogen misreads batch constraints. Write
  ops by hand.

### 3. Write SQLite-safe `upgrade()` / `downgrade()`
Read `backend/app/db/models.py` for the target schema and its constraint
comments. Follow the house rules:
- **Batch mode for ALTERs.** Wrap `alter_column` / add-constraint / drop-column
  in `with op.batch_alter_table("t") as b:` — plain `op.alter_column` no-ops or
  errors on SQLite.
- **No named FKs** to existing tables (batch ALTER can't add them); enforce
  integrity app-side, mirroring the existing models.
- **NOT NULL on a populated table needs a `server_default`** (or a backfill
  step), or it fails on existing rows.
- **Reversible `downgrade()`** — a real inverse, not `pass` (merges excepted).
- Match model details: JSON vs Text, indexes, and soft-delete partial indexes
  (`sqlite_where=text("deleted_at IS NULL")`).

### 4. Verify it applies both ways
```
venv\Scripts\alembic.exe upgrade head
venv\Scripts\alembic.exe downgrade -1
venv\Scripts\alembic.exe upgrade head
venv\Scripts\alembic.exe heads
```
`heads` must again show exactly one head. Back up first if pointing at real data
(`scripts\backup-db.ps1`).

### 5. Review and commit
Ask the **alembic-migration-reviewer** agent to review the diff, then commit the
new `versions/NNNN_*.py`. If the migration changes the API surface, also run
`/sync-api-types`. Deploy via `/deploy`.

## Merging heads
If step 1 shows two heads, create a merge revision instead of a new feature one:
```
venv\Scripts\alembic.exe merge --rev-id 00NN_merge_short -m "merge heads" <rev_a> <rev_b>
```
Then continue from step 4.

## Notes
- The `alembic-heads-guard` PostToolUse hook warns automatically if an edit
  leaves the history with more than one head — treat that warning as blocking.
- `alembic.ini` resolves the DB URL at runtime via `app.config`; the placeholder
  URL in the file is intentional, leave it.

