"""form_kind — the single definition of "which service produced this record"."""

from __future__ import annotations

import pytest

from app.core.constants import COMPANION_TEMPLATE_IDS, TEMPLATE_FILES
from app.core.form_kind import (
    LEGACY_SUBJECT_ALIASES,
    OTHER_SERVICE_ID,
    SERVICE_ALIASES,
    SERVICE_IDS,
    resolve_service,
    service_template_ids,
    subject_prefixes,
)


def test_service_ids_are_templates_minus_companions_and_aliases() -> None:
    hidden = set(COMPANION_TEMPLATE_IDS) | set(SERVICE_ALIASES)
    assert set(SERVICE_IDS) == set(TEMPLATE_FILES) - hidden
    assert len(SERVICE_IDS) == 18
    # TEMPLATE_FILES order is preserved (drives rail order).
    assert list(SERVICE_IDS) == [t for t in TEMPLATE_FILES if t not in hidden]


def test_aliased_template_reports_as_its_target_service() -> None:
    """The permit letter is a General Book on its own paper: it must never own
    a rail entry, and its books must stay in the General Book bucket."""
    assert SERVICE_ALIASES["Security Permit"] == "General Book"
    assert "Security Permit" not in SERVICE_IDS
    assert resolve_service(None, "Security Permit", versioned=True) == "General Book"


def test_service_template_ids_covers_the_alias() -> None:
    """The SQL filter and the Python rule must claim the same rows."""
    assert set(service_template_ids("General Book")) == {"General Book", "Security Permit"}
    # A service with no alias is just itself.
    assert service_template_ids("Warning Form") == ("Warning Form",)


@pytest.mark.parametrize("service_id", list(SERVICE_IDS))
def test_template_id_resolves_to_itself(service_id: str) -> None:
    assert resolve_service(None, service_id, versioned=True) == service_id
    # Subject text is irrelevant when a template id is present.
    assert resolve_service("Leave Application Form - X", service_id, versioned=True) == service_id


@pytest.mark.parametrize("companion", sorted(COMPANION_TEMPLATE_IDS))
def test_companions_resolve_to_other(companion: str) -> None:
    assert resolve_service(None, companion, versioned=True) == OTHER_SERVICE_ID


def test_versioned_record_with_unknown_template_is_other_not_subject_guessed() -> None:
    # A version exists but its template is unknown/NULL: never fall back to the
    # subject, or modern records rejoin the guessing path.
    assert resolve_service("Leave Application Form - X", "Ghost Form", versioned=True) == (
        OTHER_SERVICE_ID
    )
    assert resolve_service("Leave Application Form - X", None, versioned=True) == OTHER_SERVICE_ID


@pytest.mark.parametrize(
    ("subject", "expected"),
    [
        ("Leave Application Form - Saif Rashed", "Leave Application Form"),
        ("Duty Resumption Form - X", "Duty Resumption Form"),
        ("Violation Form - X", "Violation Form"),
        ("HR Request Form - X", "HR Request Form"),
        ("Employee Clearance Form - X", "Employee Clearance Form"),
        ("Passport Release Form - X", "Passport Release Form"),
        ("General Book", "General Book"),
        ("Salary Transfer Request - X", "Salary Transfer Request"),
        ("Material Request Form - X", "Material Request Form"),
        ("Acknowledgment Form - X", "Acknowledgment Form"),
        # The three that a generic prefix scan gets wrong:
        ("Resignation Form - X", "Resignation Letter"),
        ("كتاب عام", "General Book"),
        ("تصاريح الامنية", OTHER_SERVICE_ID),
    ],
)
def test_versionless_subject_heads_resolve(subject: str, expected: str) -> None:
    """The 13 distinct subject heads present in the 365 v3-imported records."""
    assert resolve_service(subject, None, versioned=False) == expected


def test_versionless_matching_is_case_insensitive() -> None:
    assert resolve_service("leave application form - x", None, versioned=False) == (
        "Leave Application Form"
    )


def test_empty_and_null_subject_are_other() -> None:
    assert resolve_service(None, None, versioned=False) == OTHER_SERVICE_ID
    assert resolve_service("   ", None, versioned=False) == OTHER_SERVICE_ID


def test_unknown_subject_is_other() -> None:
    assert resolve_service("Some random subject", None, versioned=False) == OTHER_SERVICE_ID


def test_longest_prefix_wins() -> None:
    """Passport Release List must not be swallowed by Passport Release Form."""
    assert resolve_service("Passport Release List - X", None, versioned=False) == (
        "Passport Release List"
    )
    assert resolve_service("Passport Release Form - X", None, versioned=False) == (
        "Passport Release Form"
    )


def test_subject_prefixes_include_aliases_and_are_lowercase() -> None:
    assert "resignation letter" in subject_prefixes("Resignation Letter")
    assert "resignation form" in subject_prefixes("Resignation Letter")
    assert "كتاب عام" in subject_prefixes("General Book")
    for service_id in SERVICE_IDS:
        for prefix in subject_prefixes(service_id):
            assert prefix == prefix.lower()


def test_every_alias_target_is_a_real_service() -> None:
    for target in LEGACY_SUBJECT_ALIASES.values():
        assert target in SERVICE_IDS


def test_no_prefix_contains_a_sql_like_wildcard() -> None:
    """subject_prefixes() feeds straight into ILIKE in Task 3 — % and _ would
    silently widen the match."""
    for service_id in SERVICE_IDS:
        for prefix in subject_prefixes(service_id):
            assert "%" not in prefix
            assert "_" not in prefix
