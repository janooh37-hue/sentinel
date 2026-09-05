from app.core import permissions
from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS
from app.core.permissions import ALL_CAPABILITIES, CAPABILITIES, CAPABILITY_IDS, ROLE_DEFAULTS
from app.db.models import BookCategory


def test_static_catalog_has_complete_bilingual_request_policy_metadata():
    assert len(CAPABILITIES) == 56
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

    assert frozenset({"users.manage", "system.admin"}) == (permissions.SENSITIVE_CAPABILITY_IDS)
    assert {cap.id for cap in CAPABILITIES if cap.sensitive} == set(
        permissions.SENSITIVE_CAPABILITY_IDS
    )
    assert all(cap.requestable for cap in CAPABILITIES if not cap.sensitive)


def test_static_role_default_counts_are_preserved():
    assert {role: len(caps) for role, caps in ROLE_DEFAULTS.items()} == {
        "operator": 18,
        "manager": 40,
        "admin": 56,
    }


def test_catalog_composes_bilingual_dynamic_entries_in_stable_order(db_session):
    from app.services import capability_catalog_service

    db_session.add_all(
        [
            BookCategory(id="Z", name_en=None, name_ar=None, prefix="Z"),
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
    assert len(catalog) == 56 + (2 * (len(SERVICE_IDS) + 1)) + 2
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
    assert [entry.id for entry in dynamic[:42]] == expected_pair_ids
    assert [entry.id for entry in dynamic[42:]] == [
        "books.category.A",
        "books.category.Z",
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

    category = by_id["books.category.A"]
    assert category.label_en == "Operations"
    assert category.label_ar is None
    assert category.description_en == "View records in Operations."
    assert category.description_ar is None
    unnamed = by_id["books.category.Z"]
    assert unnamed.label_en == unnamed.id
    assert unnamed.label_ar is None
    assert unnamed.description_en == "View records in books.category.Z."
    assert unnamed.description_ar is None

    assert all(
        entry.default_roles == ("operator", "manager", "admin")
        and entry.requestable
        and not entry.sensitive
        for entry in dynamic
    )
    assert capability_catalog_service.get_catalog_entry(db_session, passport.id) == passport
    assert capability_catalog_service.get_catalog_entry(db_session, category.id) == category
    assert capability_catalog_service.get_catalog_entry(db_session, "missing.cap") is None


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
