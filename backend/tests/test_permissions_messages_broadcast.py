from app.core import permissions as perm


def test_messages_broadcast_capability_registered():
    assert "messages.broadcast" in perm.CAPABILITY_IDS
    cap = next(c for c in perm.CAPABILITIES if c.id == "messages.broadcast")
    assert cap.domain == "messages"


def test_messages_broadcast_admin_only_by_default():
    assert "messages.broadcast" in perm.ALL_CAPABILITIES  # admin
    assert "messages.broadcast" not in perm._OPERATOR_CAPS
    assert "messages.broadcast" not in perm._MANAGER_CAPS
