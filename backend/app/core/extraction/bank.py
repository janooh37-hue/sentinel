from __future__ import annotations

import re

from app.core.extraction.iban import find_iban
from app.core.extraction.types import DocType, ExtractedField, Extraction

# Require a colon and stay on the same line, so a header line ending in "...Bank"
# (no colon) can't swallow the following line.
_BANK_NAME_RE = re.compile(r"bank(?:\s*name)?\s*:\s*([^\n]+)", re.IGNORECASE)
_BRANCH_RE = re.compile(r"branch\s*:\s*([^\n]+)", re.IGNORECASE)
_ACCOUNT_RE = re.compile(
    r"(?:account|a/?c)\s*(?:no\.?|number)?\s*:\s*([0-9][0-9\s-]{4,})", re.IGNORECASE
)


def _account_from_iban(iban: str) -> str:
    # UAE IBAN: AE + 2 check digits + 3-digit bank code + 16 account digits.
    return iban[7:23]


def extract_bank(text: str) -> Extraction:
    fields: list[ExtractedField] = []

    iban = find_iban(text)
    if iban:
        fields.append(ExtractedField("iban", iban, 0.99))

    # account_number: prefer the printed value; fall back to IBAN-embedded digits.
    m_acct = _ACCOUNT_RE.search(text)
    scraped = re.sub(r"[\s-]", "", m_acct.group(1)) if m_acct else None
    derived = _account_from_iban(iban) if iban else None
    if scraped:
        conf = 0.99 if (derived and scraped == derived) else 0.85
        fields.append(ExtractedField("account_number", scraped, conf))
    elif derived:
        fields.append(ExtractedField("account_number", derived, 0.90))

    m_bank = _BANK_NAME_RE.search(text)
    if m_bank:
        fields.append(ExtractedField("bank_name", m_bank.group(1).strip(), 0.75))

    m_branch = _BRANCH_RE.search(text)
    if m_branch:
        fields.append(ExtractedField("branch", m_branch.group(1).strip(), 0.6))

    return Extraction(DocType.BANK_IBAN, 0.9 if iban else 0.4, fields, raw_text=text)
