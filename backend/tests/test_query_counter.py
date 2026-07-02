"""Self-test for the count_queries fixture (Batch B foundation)."""

from sqlalchemy import text


def test_query_counter_counts_statements(db_session, count_queries):
    with count_queries() as q:
        db_session.execute(text("SELECT 1"))
        db_session.execute(text("SELECT 2"))
    assert q.count == 2


def test_query_counter_resets_per_context(db_session, count_queries):
    with count_queries() as q1:
        db_session.execute(text("SELECT 1"))
    with count_queries() as q2:
        db_session.execute(text("SELECT 1"))
        db_session.execute(text("SELECT 1"))
    assert q1.count == 1
    assert q2.count == 2
