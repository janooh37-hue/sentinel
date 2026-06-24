"""Ledger full-text search — Phase 16 (FTS5).

The FTS5 virtual table ``ledger_entries_fts`` is populated by triggers
on ``ledger_entries`` (see migration 0014). Search returns rows ordered
by ``bm25()`` ascending (best match first) and includes a highlighted
``snippet()`` of the matched ``notes_html`` so the timeline can show
context inline.

User input is wrapped as a phrase (``"...""``) so the caller can type
free-form text without worrying about FTS5 operator syntax (``AND``,
``OR``, ``NEAR``, ``*``, ``-`` prefix). Embedded double quotes are
doubled per the FTS5 string-literal rules.
"""

from __future__ import annotations

from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.db.models import LedgerEntry
from app.schemas.ledger import LedgerEntryRead
from app.schemas.search import SearchHit

_FTS_SQL = (
    """
    CREATE VIRTUAL TABLE IF NOT EXISTS ledger_entries_fts USING fts5(
      subject,
      notes_html,
      counterparty,
      tags,
      content='ledger_entries',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );
    """,
    """
    CREATE TRIGGER IF NOT EXISTS ledger_entries_ai AFTER INSERT ON ledger_entries BEGIN
      INSERT INTO ledger_entries_fts(rowid, subject, notes_html, counterparty, tags)
      VALUES (new.id, new.subject, COALESCE(new.notes_html, ''), new.counterparty, COALESCE(new.tags, ''));
    END;
    """,
    """
    CREATE TRIGGER IF NOT EXISTS ledger_entries_ad AFTER DELETE ON ledger_entries BEGIN
      INSERT INTO ledger_entries_fts(ledger_entries_fts, rowid, subject, notes_html, counterparty, tags)
      VALUES ('delete', old.id, old.subject, COALESCE(old.notes_html, ''), old.counterparty, COALESCE(old.tags, ''));
    END;
    """,
    """
    CREATE TRIGGER IF NOT EXISTS ledger_entries_au AFTER UPDATE ON ledger_entries BEGIN
      INSERT INTO ledger_entries_fts(ledger_entries_fts, rowid, subject, notes_html, counterparty, tags)
      VALUES ('delete', old.id, old.subject, COALESCE(old.notes_html, ''), old.counterparty, COALESCE(old.tags, ''));
      INSERT INTO ledger_entries_fts(rowid, subject, notes_html, counterparty, tags)
      SELECT new.id, new.subject, COALESCE(new.notes_html, ''), new.counterparty, COALESCE(new.tags, '')
      WHERE new.deleted_at IS NULL;
    END;
    """,
)


def create_fts_schema(engine: Engine) -> None:
    """Create the ``ledger_entries_fts`` virtual table + triggers.

    Idempotent (``IF NOT EXISTS``). Used by tests that build their schema
    via ``Base.metadata.create_all`` and don't run alembic migrations.
    Production uses migration ``0014`` instead.
    """
    with engine.begin() as conn:
        for stmt in _FTS_SQL:
            conn.exec_driver_sql(stmt)


def _sanitize_query(raw: str) -> str:
    """Wrap user input as an FTS5 phrase literal.

    FTS5 reserves ``"`` as the phrase delimiter. Doubling embedded quotes
    is the documented escape (same as SQL string literals).
    """
    escaped = raw.replace('"', '""').strip()
    return f'"{escaped}"'


def search(
    db: Session,
    query: str,
    *,
    limit: int = 50,
    owner_user_id: int | None = None,
) -> list[SearchHit]:
    """Run an FTS5 query and return scored hits with highlighted snippets.

    When ``owner_user_id`` is given, email hits are restricted to that owner's
    rows (non-email rows — the shared correspondence log — stay visible to all),
    mirroring ``ledger_service.list_entries``. ``None`` (legacy callers) applies
    no owner filter.
    """
    if not query or not query.strip():
        return []
    limit = max(1, min(limit, 200))
    fts_query = _sanitize_query(query)

    owner_clause = ""
    params: dict[str, object] = {"q": fts_query, "limit": limit}
    if owner_user_id is not None:
        owner_clause = " AND (le.owner_user_id = :owner OR le.channel != 'email')"
        params["owner"] = owner_user_id

    rows = db.execute(
        text(
            f"""
            SELECT le.id AS id,
                   snippet(ledger_entries_fts, 1, '<mark>', '</mark>', '…', 16) AS snippet,
                   bm25(ledger_entries_fts) AS score
            FROM ledger_entries_fts
              JOIN ledger_entries le ON le.id = ledger_entries_fts.rowid
            WHERE ledger_entries_fts MATCH :q
              AND le.deleted_at IS NULL{owner_clause}
            ORDER BY score
            LIMIT :limit
            """
        ),
        params,
    ).all()

    hits: list[SearchHit] = []
    for row in rows:
        entry = db.get(LedgerEntry, row.id)
        if entry is None:
            continue
        hits.append(
            SearchHit(
                entry=LedgerEntryRead.model_validate(entry),
                snippet=row.snippet or "",
                score=float(row.score),
            )
        )
    return hits


__all__ = ["search"]
