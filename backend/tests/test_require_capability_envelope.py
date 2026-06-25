# backend/tests/test_require_capability_envelope.py
"""Task 5: verify that the 403 from require_capability carries details["capability"]."""
import pytest
from app.api.errors import AppError
from app.api.deps import require_capability
from tests.conftest import make_user


def test_missing_cap_error_includes_capability(db_session):
    """An operator lacking books.approve triggers a 403 whose details include the capability."""
    dep = require_capability("books.approve")
    user = make_user(db_session, role="operator")
    # _dep is the raw closure; call it with keyword args matching its signature.
    with pytest.raises(AppError) as ei:
        dep(user=user, db=db_session)
    err = ei.value
    assert err.http_status == 403
    assert err.code == "FORBIDDEN"
    assert err.details.get("capability") == "books.approve"
