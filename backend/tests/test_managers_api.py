"""Manager management API + schema tests."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.manager import ManagerCreate


def test_manager_create_requires_a_name():
    with pytest.raises(ValidationError):
        ManagerCreate(name_en="  ", name_ar=None, title="HR Director")


def test_manager_create_accepts_arabic_only_name():
    m = ManagerCreate(name_en=None, name_ar="مدير", title=None)
    assert m.name_ar == "مدير"
    assert m.active is True
