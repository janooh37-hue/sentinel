from __future__ import annotations

from app.core.extraction.passport_mrz import find_mrz_lines
from app.core.extraction.types import DocType

# (DocType, [keyword anchors], weight) — anchors are lowercased substring tests.
_ANCHORS: list[tuple[DocType, list[str]]] = [
    (DocType.EMIRATES_ID, ["resident identity card", "بطاقة هوية", "784-", "federal authority for identity"]),
    (DocType.BANK_IBAN, ["iban", "account number", "swift"]),
    (DocType.SICK_LEAVE, ["sick leave", "medical certificate", "إجازة مرضية", "number of days"]),
]


def classify(text: str) -> tuple[DocType, float, list[DocType]]:
    """Return (best_type, confidence, ranked_alternatives)."""
    lowered = text.lower()
    scores: dict[DocType, int] = {}

    # MRZ presence is a strong, near-unique passport signal.
    if find_mrz_lines(text) is not None:
        scores[DocType.PASSPORT] = 3

    for doc_type, anchors in _ANCHORS:
        hits = sum(1 for a in anchors if a in lowered)
        if hits:
            scores[doc_type] = scores.get(doc_type, 0) + hits

    if not scores:
        return DocType.UNKNOWN, 0.2, []

    ranked = sorted(scores, key=lambda d: scores[d], reverse=True)
    best = ranked[0]
    # crude confidence: best score normalised, capped.
    conf = min(0.95, 0.45 + 0.2 * scores[best])
    return best, conf, ranked[1:]
