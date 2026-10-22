from app.core import permissions as perm


def test_messages_templates_registered_with_bilingual_labels():
    assert "messages.templates" in perm.CAPABILITY_IDS
    cap = next(cap for cap in perm.CAPABILITIES if cap.id == "messages.templates")
    assert (cap.domain, cap.label_en, cap.label_ar) == (
        "messages",
        "Manage message templates",
        "إدارة قوالب الرسائل",
    )


def test_messages_templates_only_in_admin_preset():
    assert "messages.templates" in perm.ALL_CAPABILITIES
    assert "messages.templates" not in perm._OPERATOR_CAPS
    assert "messages.templates" not in perm._MANAGER_CAPS
    for role, capabilities in perm.ROLE_DEFAULTS.items():
        assert ("messages.templates" in capabilities) == (role == "admin")
