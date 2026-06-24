"""Pydantic v2 schemas for the API layer.

Each entity has a ``Create`` / ``Update`` / ``Read`` triplet:

* **Create** — payload accepted from clients on POST. Required fields only.
* **Update** — partial payload accepted on PATCH. All fields optional.
* **Read** — full server-side projection, used in responses
  (``from_attributes=True`` so it can absorb an ORM row directly).
"""

from __future__ import annotations

from app.schemas.book import (
    BookCategoryRead,
    BookCreate,
    BookListResponse,
    BookRead,
    BookUpdate,
)
from app.schemas.employee import (
    EmployeeCreate,
    EmployeeListItem,
    EmployeeListResponse,
    EmployeeRead,
    EmployeeUpdate,
)
from app.schemas.leave import LeaveCreate, LeaveRead, LeaveUpdate
from app.schemas.manager import ManagerCreate, ManagerRead, ManagerUpdate
from app.schemas.setting import AppSettingRead, AppSettingUpsert
from app.schemas.submitter import SubmitterCreate, SubmitterRead, SubmitterUpdate
from app.schemas.vault_file import (
    VaultEntry,
    VaultFileCreate,
    VaultFileRead,
    VaultKind,
    VaultTree,
)
from app.schemas.violation import ViolationCreate, ViolationRead, ViolationUpdate

__all__ = [
    "AppSettingRead",
    "AppSettingUpsert",
    "BookCategoryRead",
    "BookCreate",
    "BookListResponse",
    "BookRead",
    "BookUpdate",
    "EmployeeCreate",
    "EmployeeListItem",
    "EmployeeListResponse",
    "EmployeeRead",
    "EmployeeUpdate",
    "LeaveCreate",
    "LeaveRead",
    "LeaveUpdate",
    "ManagerCreate",
    "ManagerRead",
    "ManagerUpdate",
    "SubmitterCreate",
    "SubmitterRead",
    "SubmitterUpdate",
    "VaultEntry",
    "VaultFileCreate",
    "VaultFileRead",
    "VaultKind",
    "VaultTree",
    "ViolationCreate",
    "ViolationRead",
    "ViolationUpdate",
]
