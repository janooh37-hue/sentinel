from app.core.permissions import CAPABILITIES


def test_every_capability_has_a_nonempty_description():
    for cap in CAPABILITIES:
        assert cap.description and len(cap.description) > 10, cap.id
