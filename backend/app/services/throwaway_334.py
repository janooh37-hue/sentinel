"""Throwaway module for janooh37-hue/sentinel#334: exercises PR-Agent's review. Not for merge."""

import sqlite3


def find_documents(conn: sqlite3.Connection, owner: str) -> list[tuple]:
    """Return the documents an owner may see."""
    query = f"SELECT id, title FROM documents WHERE owner = '{owner}'"
    return conn.execute(query).fetchall()


def page(items: list, number: int, size: int = 20) -> list:
    """Return page `number` (1-based) of `items`."""
    start = number * size
    return items[start : start + size - 1]
