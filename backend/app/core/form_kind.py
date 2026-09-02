"""Which service produced a given Records entry.

The Records rail filters by *service* — the form/template a record came from.
`template_id` on the book's version is authoritative. The 365 v3-imported books
carry no version at all, so they fall back to an explicit alias table over the
machine-written subject they were imported with.

Pure module: no session, no I/O. `subject_prefixes()` is shared with the SQL
filter in `book_service` so the Python rule and the SQL rule are generated from
one table.
"""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType
from typing import Final

from app.core.constants import COMPANION_TEMPLATE_IDS, TEMPLATE_FILES

OTHER_SERVICE_ID: Final[str] = "other"

#: Legacy subject heads that are NOT `TEMPLATE_FILES` keys. "Resignation Form"
#: is the dead `FORM_TYPE_SUBFOLDER` key (constants.py:138) — it was never a
#: real template, but 8 imported records carry it. The Arabic head belongs to a
#: hand-written General Book. (The third live head, "تصاريح الامنية", has no
#: home and correctly falls to Other.)
LEGACY_SUBJECT_ALIASES: Final[Mapping[str, str]] = MappingProxyType(
    {
        "Resignation Form": "Resignation Letter",
        "كتاب عام": "General Book",
    }
)

#: Template ids that render their own paper but report as ANOTHER service in
#: Records. "Security Permit" is the 1/5 permit letter: a General Book on a
#: separate .docx so the permit form can be edited in isolation. It is minted
#: only by the permits register, never authored by hand, so it owns no Services
#: tile and no rail entry of its own — its books stay in the General Book
#: bucket, exactly where they were before the paper was split out.
SERVICE_ALIASES: Final[Mapping[str, str]] = MappingProxyType({"Security Permit": "General Book"})

#: Letterhead forms minted only by feature modules. They keep their own Records
#: rail entries and dynamic ``books.service.*`` capabilities, but manual form
#: generators must not offer them. They are deliberately not service aliases.
FEATURE_MINTED_TEMPLATE_IDS: Final[frozenset[str]] = frozenset(
    {"Vehicle Fines", "Vehicle Accident Report"}
)

#: Every service that can own a rail entry: registered templates minus the two
#: companions (which exist only attached to a primary) and the aliased ids
#: (which report as their target). `TEMPLATE_FILES` order is preserved — it is
#: the rail's display order.
SERVICE_IDS: Final[tuple[str, ...]] = tuple(
    t for t in TEMPLATE_FILES if t not in COMPANION_TEMPLATE_IDS and t not in SERVICE_ALIASES
)


def service_template_ids(service_id: str) -> tuple[str, ...]:
    """Every template id whose newest version puts a book in ``service_id``.

    The service's own id plus any alias pointing at it. Shared with the SQL
    filter in ``book_service.service_clause`` so the Python rule and the SQL
    rule are generated from one table.
    """
    return (service_id, *(k for k, v in SERVICE_ALIASES.items() if v == service_id))


def subject_prefixes(service_id: str) -> tuple[str, ...]:
    """Lower-cased subject prefixes that resolve to ``service_id``.

    The template's own name plus any legacy alias pointing at it. Used both by
    ``resolve_service`` and by the SQL ILIKE clause in ``book_service``.
    """
    out: list[str] = []
    if service_id in TEMPLATE_FILES:
        out.append(service_id.lower())
    out.extend(k.lower() for k, v in LEGACY_SUBJECT_ALIASES.items() if v == service_id)
    return tuple(out)


#: (prefix, service_id) sorted longest-first, so a longer name always wins over
#: a shorter one that happens to be its prefix.
_PREFIX_TABLE: Final[tuple[tuple[str, str], ...]] = tuple(
    sorted(
        ((p, s) for s in SERVICE_IDS for p in subject_prefixes(s)),
        key=lambda pair: len(pair[0]),
        reverse=True,
    )
)


def resolve_service(subject: str | None, template_id: str | None, *, versioned: bool) -> str:
    """The service that produced this record, or ``OTHER_SERVICE_ID``.

    ``versioned`` says whether the book has any ``book_versions`` row. When it
    does, ``template_id`` (the newest version's) decides and the subject is
    ignored entirely — an unknown or NULL template resolves to Other rather than
    rejoining the subject-guessing path. Only version-less v3 imports consult
    the subject.
    """
    if versioned:
        resolved = SERVICE_ALIASES.get(template_id or "", template_id)
        return resolved if resolved in SERVICE_IDS else OTHER_SERVICE_ID
    s = (subject or "").strip().lower()
    if not s:
        return OTHER_SERVICE_ID
    for prefix, service_id in _PREFIX_TABLE:
        if s.startswith(prefix):
            return service_id
    return OTHER_SERVICE_ID
