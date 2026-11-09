from app.core import permissions
from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS
from app.core.permissions import ALL_CAPABILITIES, CAPABILITIES, CAPABILITY_IDS, ROLE_DEFAULTS
from app.db.models import BookCategory


def test_static_catalog_has_complete_bilingual_request_policy_metadata():
    assert len(CAPABILITIES) == 65
    assert {cap.id for cap in CAPABILITIES if cap.domain == "uniform"} == {
        "uniform.view",
        "uniform.edit",
    }
    for cap in CAPABILITIES:
        assert cap.label_en.strip(), cap.id
        assert cap.label_ar.strip(), cap.id
        assert cap.description_en.strip(), cap.id
        assert cap.description_ar.strip(), cap.id
        assert not cap.sensitive or not cap.requestable, cap.id

    by_id = {cap.id: cap for cap in CAPABILITIES}
    assert by_id["books.view"].label_en == "View records"
    assert by_id["books.view"].label_ar == "عرض السجلات"
    assert by_id["books.approve"].label_en == "Approve / reject records"
    assert by_id["books.approve"].label_ar == "اعتماد / رفض السجلات"
    assert by_id["ledger.view"].label_en == "View ledger"
    assert by_id["ledger.view"].label_ar == "عرض سجل المراسلات"

    assert frozenset({"users.manage", "system.admin", "inmate_statistics.approve"}) == (
        permissions.SENSITIVE_CAPABILITY_IDS
    )
    assert {cap.id for cap in CAPABILITIES if cap.sensitive} == set(
        permissions.SENSITIVE_CAPABILITY_IDS
    )
    # books.secret is the one non-sensitive cap that can't be self-requested:
    # clearance is granted by an admin or manager, never asked for.
    assert {cap.id for cap in CAPABILITIES if not cap.sensitive and not cap.requestable} == {
        "books.secret"
    }


def test_static_role_default_counts_are_preserved():
    assert {
        role: len(caps) for role, caps in ROLE_DEFAULTS.items() if role != "inmate_reporter"
    } == {
        "operator": 19,
        "manager": 45,
        "admin": 65,
    }
    assert {"uniform.view", "uniform.edit"} <= ROLE_DEFAULTS["admin"]
    assert "uniform.view" in ROLE_DEFAULTS["manager"]
    assert "uniform.edit" not in ROLE_DEFAULTS["manager"]
    assert not {"uniform.view", "uniform.edit"} & ROLE_DEFAULTS["operator"]


def test_inmate_reporter_preset_is_exactly_its_fixed_ceiling():
    """Security contract, not a magic count: inmate_reporter's preset must be
    exactly this scope — no ledger/employees/leaves/etc, no
    books.edit/approve/delete, only the one service+category it's bound to."""
    assert (
        ROLE_DEFAULTS["inmate_reporter"]
        == permissions.INMATE_REPORTER_CAPS
        == {
            "app.access",
            "documents.generate",
            "books.view",
            "books.submit",
            "books.service.Inmate Conduct Violations",
            "books.servicerecords.Inmate Conduct Violations",
            "books.category.13/1",
            "books.service.Report",
            "books.servicerecords.Report",
        }
    )


def test_catalog_composes_bilingual_dynamic_entries_in_stable_order(db_session):
    from app.services import capability_catalog_service

    db_session.add_all(
        [
            BookCategory(id="Z", name_en=None, name_ar=None, prefix="Z"),
            BookCategory(id="9/1", name_en="Cat 9/1", name_ar=None, prefix="9"),
            BookCategory(
                id="A",
                name_en="Operations",
                name_ar=None,
                prefix="A",
            ),
        ]
    )
    db_session.commit()

    catalog = capability_catalog_service.list_catalog(db_session)
    assert len(catalog) == 65 + (2 * (len(SERVICE_IDS) + 1)) + 15
    assert len({entry.id for entry in catalog}) == len(catalog)

    dynamic = catalog[len(CAPABILITIES) :]
    expected_pair_ids = [
        capability_id
        for service_id in (*SERVICE_IDS, OTHER_SERVICE_ID)
        for capability_id in (
            f"books.service.{service_id}",
            f"books.servicerecords.{service_id}",
        )
    ]
    n_service_pairs = len(expected_pair_ids)
    assert [entry.id for entry in dynamic[:n_service_pairs]] == expected_pair_ids
    assert [entry.id for entry in dynamic[n_service_pairs:]] == [
        *[f"books.category.{tab}/1" for tab in range(1, 16)],
    ]

    by_id = {entry.id: entry for entry in catalog}
    passport = by_id["books.service.Passport Release Form"]
    assert (passport.label_en, passport.label_ar) == (
        "Passport Request",
        "طلب جواز السفر",
    )
    assert passport.description_en == "Create Passport Request records."
    assert passport.description_ar == "إنشاء سجلات طلب جواز السفر."
    assert by_id["books.servicerecords.General Book"].label_ar == ("السجلات: كتاب عام")
    assert by_id["books.service.other"].label_ar == "أخرى"

    assert (by_id["books.category.9/1"].label_en, by_id["books.category.9/1"].label_ar) == (
        "Custody, clothing & ID cards",
        "العهدة والملابس والبطاقات التعريفية",
    )
    assert by_id["books.category.5/1"].label_en == "Security permits"
    for tab in range(1, 16):
        entry = by_id[f"books.category.{tab}/1"]
        assert entry.label_ar
        assert entry.description_en
        assert entry.description_ar
        assert capability_catalog_service.get_catalog_entry(db_session, entry.id) == entry

    inmate_dynamic_ids = {
        "books.service.Inmate Conduct Violations",
        "books.servicerecords.Inmate Conduct Violations",
        "books.service.Report",
        "books.servicerecords.Report",
        "books.category.13/1",
    }
    for entry in dynamic:
        assert entry.requestable and not entry.sensitive
        service_id = entry.id.removeprefix(permissions.SERVICE_CAP_PREFIX).removeprefix(
            permissions.SERVICE_RECORDS_CAP_PREFIX
        )
        if service_id in permissions.OPT_IN_SERVICE_IDS:
            expected_roles = ("admin",)
        elif entry.id in inmate_dynamic_ids:
            expected_roles = ("operator", "manager", "admin", "inmate_reporter")
        else:
            expected_roles = ("operator", "manager", "admin")
        assert entry.default_roles == expected_roles, entry.id
    assert capability_catalog_service.get_catalog_entry(db_session, passport.id) == passport
    assert capability_catalog_service.get_catalog_entry(db_session, "missing.cap") is None


def test_categories_describe_their_mapped_services_and_ignore_legacy_rows(db_session):
    from app.core.classifications import CLASSIFICATIONS
    from app.core.record_categories import SERVICE_RECORD_CATEGORY
    from app.services import capability_catalog_service

    legacy_ids = ("GS", "HR", "NAT", "INV", "SC", "VA", "VF", "1", "2", "12", "imported")
    db_session.add_all(
        [
            BookCategory(id=category_id, name_en=None, name_ar=None, prefix=category_id)
            for category_id in legacy_ids
        ]
    )
    db_session.commit()
    categories = {
        entry.id: entry
        for entry in capability_catalog_service.list_catalog(db_session)
        if entry.domain == "categories"
    }
    assert set(categories) == {
        f"books.category.{classification.code}" for classification in CLASSIFICATIONS
    }
    assert len(categories) == 15
    for category_id in legacy_ids:
        assert (
            capability_catalog_service.get_catalog_entry(
                db_session, f"books.category.{category_id}"
            )
            is None
        )

    for classification in CLASSIFICATIONS:
        entry = categories[f"books.category.{classification.code}"]
        names = [
            capability_catalog_service._service_names(service_id)
            for service_id, code in SERVICE_RECORD_CATEGORY.items()
            if code == classification.code
        ]
        assert entry.description_ar
        if names:
            assert entry.description_en == (
                f"Covers records from: {', '.join(name_en for name_en, _ in names)}."
            )
            assert all(name_ar for _, name_ar in names)
            assert entry.description_ar == (
                f"يشمل سجلات: {'، '.join(name_ar for _, name_ar in names)}."
            )
        else:
            assert entry.description_en == f"View records in {classification.name_en}."
            assert entry.description_ar == f"عرض السجلات ضمن {classification.name_ar}."

    assert categories["books.category.9/1"].description_ar == ("يشمل سجلات: استلام المواد.")


def test_every_capability_has_a_nonempty_description():
    for cap in CAPABILITIES:
        assert cap.description_en and len(cap.description_en) > 10, cap.id


def test_old_bundled_ids_are_gone():
    # Only the fully-retired ids. employees.edit / leaves.edit / ledger.edit
    # survive as narrower atomic caps (expansion map reuses those names), so
    # their absence is asserted by test_atomic_children_exist instead.
    for old in (
        "violations.manage",
        "books.manage",
        "permits.manage",
    ):
        assert old not in CAPABILITY_IDS, old


def test_atomic_children_exist():
    children = {
        "employees.create",
        "employees.edit",
        "employees.vault.manage",
        "leaves.create",
        "leaves.delete",
        "violations.create",
        "violations.edit",
        "violations.delete",
        "books.create",
        "books.edit",
        "books.submit",
        "books.templates",
        "books.delete",
        "permits.create",
        "permits.edit",
        "permits.revoke",
        "permits.delete",
        "ledger.create",
        "ledger.delete",
    }
    assert children <= CAPABILITY_IDS


def test_capability_ids_are_unique_and_dot_namespaced():
    assert len(CAPABILITY_IDS) == len(CAPABILITIES)
    assert all("." in c.id for c in CAPABILITIES)


def test_manager_preset_resolves_atomic_equivalents():
    """Manager keeps exactly what the old bundle granted, now atomically."""
    m = ROLE_DEFAULTS["manager"]
    for cap in (
        "employees.create",
        "employees.edit",
        "employees.vault.manage",
        "leaves.create",
        "leaves.edit",
        "leaves.delete",
        "violations.create",
        "violations.edit",
        "violations.delete",
        "books.create",
        "books.edit",
        "books.submit",
        "books.templates",
        "books.delete",
        "books.approve",
        "permits.create",
        "permits.edit",
        "permits.revoke",
        "permits.delete",
        "ledger.create",
        "ledger.edit",
        "ledger.delete",
    ):
        assert cap in m, cap
    # never bundled into manager: admin-grade / scoped / broadcast / self-workforce
    for cap in (
        "users.manage",
        "system.admin",
        "books.override_state",
        "messages.broadcast",
        "workforce.schedule.manage",
    ):
        assert cap not in m, cap


def test_operator_preset_keeps_ledger_writes_atomically():
    o = ROLE_DEFAULTS["operator"]
    assert {"ledger.create", "ledger.edit"} <= o
    # operators deleted entries/drafts before the split — full preservation.
    assert "ledger.delete" in o


def test_admin_preset_is_all():
    assert ROLE_DEFAULTS["admin"] == ALL_CAPABILITIES == CAPABILITY_IDS
