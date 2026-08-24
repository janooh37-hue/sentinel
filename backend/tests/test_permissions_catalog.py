from app.core.permissions import ALL_CAPABILITIES, CAPABILITIES, CAPABILITY_IDS, ROLE_DEFAULTS


def test_every_capability_has_a_nonempty_description():
    for cap in CAPABILITIES:
        assert cap.description and len(cap.description) > 10, cap.id


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
