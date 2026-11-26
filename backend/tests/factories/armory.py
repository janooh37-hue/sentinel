"""Synthetic Armory test data: catalogue/kits, people, accounts, safes and a pinned clock.

Tests build their database with ``Base.metadata.create_all``, so the migration's
catalogue seed is absent; :func:`seed_catalogue` installs the same approved
definitions the migration seeds (catalogue identities only, never stock).
All people, serials and references here are invented.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import (
    ArmoryItem,
    ArmoryKit,
    ArmoryKitItem,
    ArmorySafe,
    Employee,
    User,
    UserPermission,
)
from app.db.session import get_db
from app.main import create_app
from app.services import armory_service

DUBAI = ZoneInfo("Asia/Dubai")
#: Thursday mid-morning in the organization zone: inside the default day shift.
NOW = dt.datetime(2026, 11, 26, 10, 0, tzinfo=DUBAI)
EDIT_CAPS = ("armory.view", "armory.edit")

# (preset_key, name_en, name_ar, kind, category, drawing)
CATALOGUE = (
    ("rifle", "Sultan rifle", "بندقية سلطان", "firearm", "firearms", "rifle"),
    ("pistol", "Caracal pistol", "مسدس كراكال", "firearm", "firearms", "pistol"),
    (
        "rifle-mag",
        "Sultan rifle magazine",
        "مخزن بندقية سلطان",
        "quantity",
        "accessories",
        "magazine",
    ),
    ("sling", "Sultan rifle sling", "حمالة بندقية سلطان", "quantity", "accessories", "sling"),
    (
        "pistol-mag",
        "Caracal pistol magazine",
        "مخزن مسدس كراكال",
        "quantity",
        "accessories",
        "magazine",
    ),
    ("right-holster", "Right holster", "غمد مسدس يمين", "quantity", "accessories", "holster"),
    ("left-holster", "Left holster", "غمد مسدس شمال", "quantity", "accessories", "holster"),
    ("rifle-rounds", "Sultan rifle rounds", "عتاد بندقية سلطان", "ammunition", "ammo", "rounds"),
    ("pistol-rounds", "Caracal pistol rounds", "عتاد مسدس كراكال", "ammunition", "ammo", "rounds"),
    ("taser", "Taser", "مسدس كهربائي", "serial", "nonlethal", "taser"),
    ("spray", "Tear-gas spray", "بخاخ مسيل للدموع", "expiry", "nonlethal", "spray"),
    ("cartridge", "Taser cartridge", "خرطوشة مسدس كهربائي", "expiry", "nonlethal", "cartridge"),
    ("cuffs", "Steel handcuffs", "قيد يدوي حديد", "quantity", "restraints", "cuffs"),
    ("baton", "Riot baton", "عصا شغب", "quantity", "riot", "baton"),
    ("radio", "TETRA radio", "جهاز تترا", "serial", "comms", "radio"),
    ("bodycam", "Body camera", "كاميرا صدرية محمولة", "serial", "comms", "bodycam"),
)
_KITS = (
    ("rifle", "Sultan rifle kit", "طقم بندقية سلطان", "rifle"),
    ("pistol", "Caracal pistol kit", "طقم مسدس كراكال", "pistol"),
    ("equipment", "Equipment only", "معدات فقط", None),
)
# kit code -> (item key, role, default qty, substitutes key)
_KIT_LINES: dict[str, tuple[tuple[str, str, int, str | None], ...]] = {
    "rifle": (
        ("rifle-mag", "default", 2, None),
        ("sling", "default", 1, None),
        ("rifle-rounds", "default", 30, None),
    ),
    "pistol": (
        ("pistol-mag", "default", 2, None),
        ("right-holster", "default", 1, None),
        ("left-holster", "alternative", 0, "right-holster"),
        ("pistol-rounds", "default", 12, None),
    ),
    "equipment": (),
}
_OPTIONAL = ("radio", "bodycam", "taser", "cuffs")


@dataclass(frozen=True)
class Catalogue:
    items: dict[str, ArmoryItem]
    kits: dict[str, ArmoryKit]

    def item(self, key: str) -> int:
        return self.items[key].id

    def kit(self, code: str) -> int:
        return self.kits[code].id


def seed_catalogue(db: Session) -> Catalogue:
    items = {
        key: ArmoryItem(
            preset_key=key, name_en=en, name_ar=ar, kind=kind, category=category, drawing=drawing
        )
        for key, en, ar, kind, category, drawing in CATALOGUE
    }
    db.add_all(items.values())
    db.flush()
    kits = {
        code: ArmoryKit(
            code=code,
            name_en=en,
            name_ar=ar,
            firearm_item_id=None if firearm is None else items[firearm].id,
        )
        for code, en, ar, firearm in _KITS
    }
    db.add_all(kits.values())
    db.flush()
    for code, lines in _KIT_LINES.items():
        for key, role, qty, substitutes in lines:
            db.add(
                ArmoryKitItem(
                    kit_id=kits[code].id,
                    item_id=items[key].id,
                    role=role,
                    default_qty=qty,
                    substitutes_item_id=None if substitutes is None else items[substitutes].id,
                )
            )
        for key in _OPTIONAL:
            db.add(
                ArmoryKitItem(
                    kit_id=kits[code].id, item_id=items[key].id, role="optional", default_qty=0
                )
            )
    db.commit()
    return Catalogue(items=items, kits=kits)


def employee(
    db: Session, employee_id: str, *, status: str = "Active", name: str | None = None
) -> Employee:
    row = Employee(
        id=employee_id,
        name_en=name or f"Test Guard {employee_id}",
        name_ar=f"حارس تجريبي {employee_id}",
        status=status,
        end_date=None if status in ("Active", "Loaned") else dt.date(2026, 1, 1),
    )
    db.add(row)
    db.commit()
    return row


def account(
    db: Session,
    *,
    employee_id: str | None = None,
    grants: Iterable[str] = EDIT_CAPS,
    role: str = "operator",
    email: str | None = None,
) -> User:
    count = db.query(User).count()
    user = User(
        email=email or f"armory-{count}@test.ae",
        password_hash="x",
        role=role,
        status="active",
        employee_id=employee_id,
    )
    db.add(user)
    db.commit()
    db.add_all(UserPermission(user_id=user.id, capability=cap, effect="grant") for cap in grants)
    db.commit()
    return user


def safe(db: Session, user: User, name: str = "Test Safe A", **values: object) -> ArmorySafe:
    row = ArmorySafe(
        name_en=name,
        name_ar=f"خزنة {name}",
        created_by_id=user.id,
        created_at=dt.datetime(2026, 1, 1),
        **values,
    )
    db.add(row)
    db.commit()
    return row


def pin_clock(monkeypatch: pytest.MonkeyPatch, now: dt.datetime = NOW) -> None:
    """Fix ``armory_service.current_time`` (aware) for every Armory module."""
    monkeypatch.setattr(armory_service, "current_time", lambda: now.astimezone(dt.UTC))


def client_for(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)
