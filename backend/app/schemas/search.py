"""Pydantic schemas for the ledger full-text search endpoint — Phase 16."""

from __future__ import annotations

from pydantic import BaseModel

from app.schemas.ledger import LedgerEntryRead


class SearchHit(BaseModel):
    entry: LedgerEntryRead
    snippet: str
    score: float


class SearchResponse(BaseModel):
    hits: list[SearchHit]
    total: int


__all__ = ["SearchHit", "SearchResponse"]
