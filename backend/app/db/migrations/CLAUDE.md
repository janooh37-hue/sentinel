# Migrations (Alembic on SQLite)

Revision IDs are hand-numbered `NNNN_<slug>` (not Alembic hashes). Keep a
**single linear head** — a split history once forced an emergency merge revision.
SQLite can't `ALTER` most constraints in place: wrap alters in
`op.batch_alter_table`, omit named FKs to existing tables (enforce integrity
app-side), and give NOT-NULL-on-populated-table columns a `server_default`. Use
the `/new-migration` skill to scaffold safely and the `alembic-migration-reviewer`
agent to review; CI's `scripts/check_numbering.py` fails a split head.
