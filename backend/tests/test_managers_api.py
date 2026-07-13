"""Manager management API + schema tests."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.manager import ManagerCreate, ManagerUpdate
from app.services import manager_service


def test_manager_create_requires_a_name():
    with pytest.raises(ValidationError):
        ManagerCreate(name_en="  ", name_ar=None, title="HR Director")


def test_manager_create_accepts_arabic_only_name():
    m = ManagerCreate(name_en=None, name_ar="مدير", title=None)
    assert m.name_ar == "مدير"
    assert m.active is True


def test_create_then_update_and_soft_delete(db_session):
    mgr = manager_service.create_manager(
        db_session, ManagerCreate(name_en="Ada Lovelace", title="Director")
    )
    assert mgr.id is not None
    assert mgr.active is True

    manager_service.update_manager(db_session, mgr.id, ManagerUpdate(title="Chief Director"))
    assert db_session.get(type(mgr), mgr.id).title == "Chief Director"
    # name untouched by partial patch
    assert db_session.get(type(mgr), mgr.id).name_en == "Ada Lovelace"

    manager_service.update_manager(db_session, mgr.id, ManagerUpdate(active=False))
    active = manager_service.list_managers(db_session)
    assert all(m.id != mgr.id for m in active)
    allm = manager_service.list_managers(db_session, include_inactive=True)
    assert any(m.id == mgr.id for m in allm)
