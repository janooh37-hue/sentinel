"""Create the Armory ledger and seed its catalogue and kits.

Revision ID: 0126_armory
Revises: 0125_employee_added_source
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0126_armory"
down_revision: str | Sequence[str] | None = "0125_employee_added_source"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MAX_QTY = 2_147_483_647
KINDS = ("firearm", "ammunition", "serial", "quantity", "expiry")
CATEGORIES = ("firearms", "ammo", "accessories", "nonlethal", "restraints", "riot", "comms")
DRAWINGS = (
    "rifle",
    "pistol",
    "magazine",
    "rounds",
    "sling",
    "holster",
    "tool",
    "rod",
    "scabbard",
    "grip",
    "adapter",
    "case",
    "taser",
    "spray",
    "cartridge",
    "cuffs",
    "leg-irons",
    "plastic",
    "key",
    "baton",
    "helmet",
    "shield",
    "riot-suit",
    "radio",
    "bodycam",
    "wand",
)
SERIAL_STATES = (
    "in_safe",
    "signed_out",
    "in_custody",
    "in_repair",
    "missing",
    "lost",
    "written_off",
)
SERIAL_ACTIONS = ("send_repair", "return_repair", "mark_lost", "write_off", "transfer")
POSTING_KINDS = (
    "opening",
    "receipt",
    "serial_registration",
    "shift_issue",
    "custody",
    "return",
    "shift_check",
    "monthly_count",
    "serial_state",
    "decision",
)
INTAKE_SOURCES = ("supplier", "head_office", "other")
KIT_CODES = ("rifle", "pistol", "equipment")
KIT_ROLES = ("default", "alternative", "optional")
LICENCE_STATUSES = ("missing", "expired", "expiring", "valid")
OFF_DUTY_REASONS = ("cover", "escort", "training", "other")
SHORTFALL_REASONS = ("training", "incident", "lost", "other")
DISCREPANCY_KINDS = ("rounds_shortfall", "missing_serial", "unexpected_serial", "monthly_quantity")
DECISION_OUTCOMES = ("found", "used_in_training", "lost", "recording_error")

# (preset key, EN name, AR name, kind, category, drawing)
ITEMS = (
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
    ("rifle-rod", "Rifle cleaning rod", "حربة تنظيف بندقية", "quantity", "accessories", "rod"),
    ("rifle-tool", "Sultan rifle tool", "مفتاح بندقية سلطان", "quantity", "accessories", "tool"),
    ("sling", "Sultan rifle sling", "حمالة بندقية سلطان", "quantity", "accessories", "sling"),
    (
        "scabbard",
        "Sultan rifle scabbard",
        "غمد بندقية سلطان",
        "quantity",
        "accessories",
        "scabbard",
    ),
    ("foregrip", "Fore grip", "مقبض أمامي", "quantity", "accessories", "grip"),
    ("adapter", "Firing adapter", "محول إطلاق", "quantity", "accessories", "adapter"),
    (
        "pistol-mag",
        "Caracal pistol magazine",
        "مخزن مسدس كراكال",
        "quantity",
        "accessories",
        "magazine",
    ),
    ("pistol-case", "Caracal pistol case", "شنطة مسدس كراكال", "quantity", "accessories", "case"),
    ("pistol-rod", "Pistol cleaning rod", "حربة تنظيف مسدس", "quantity", "accessories", "rod"),
    ("pistol-tool", "Caracal pistol tool", "مفتاح مسدس كراكال", "quantity", "accessories", "tool"),
    ("right-holster", "Right holster", "غمد مسدس يمين", "quantity", "accessories", "holster"),
    ("left-holster", "Left holster", "غمد مسدس شمال", "quantity", "accessories", "holster"),
    ("rifle-rounds", "Sultan rifle rounds", "عتاد بندقية سلطان", "ammunition", "ammo", "rounds"),
    ("pistol-rounds", "Caracal pistol rounds", "عتاد مسدس كراكال", "ammunition", "ammo", "rounds"),
    ("taser", "Taser", "مسدس كهربائي", "serial", "nonlethal", "taser"),
    ("spray", "Tear-gas spray", "بخاخ مسيل للدموع", "expiry", "nonlethal", "spray"),
    ("cartridge", "Taser cartridge", "خرطوشة مسدس كهربائي", "expiry", "nonlethal", "cartridge"),
    ("cuffs", "Steel handcuffs", "قيد يدوي حديد", "quantity", "restraints", "cuffs"),
    ("leg-irons", "Steel leg irons", "قيد رجل حديد", "quantity", "restraints", "leg-irons"),
    ("plastic", "Plastic restraints", "قيود بلاستيكية", "quantity", "restraints", "plastic"),
    ("leg-key", "Leg-iron key", "مفتاح قيد رجل", "quantity", "restraints", "key"),
    ("cuff-key", "Handcuff key", "مفتاح قيد يدوي", "quantity", "restraints", "key"),
    ("baton", "Riot baton", "عصا شغب", "quantity", "riot", "baton"),
    ("helmet", "Riot helmet", "خوذة شغب", "quantity", "riot", "helmet"),
    ("shield", "Riot shield", "ترس شغب", "quantity", "riot", "shield"),
    ("riot-suit", "Riot gear suit", "بدلة مكافحة الشغب", "serial", "riot", "riot-suit"),
    ("radio", "TETRA radio", "جهاز تترا", "serial", "comms", "radio"),
    ("wand", "Hand wand", "عصا تفتيش كهربائية", "serial", "comms", "wand"),
    ("bodycam", "Body camera", "كاميرا صدرية محمولة", "serial", "comms", "bodycam"),
)

# (code, EN name, AR name, firearm preset key)
KITS = (
    ("rifle", "Sultan rifle kit", "طقم بندقية سلطان", "rifle"),
    ("pistol", "Caracal pistol kit", "طقم مسدس كراكال", "pistol"),
    ("equipment", "Equipment only", "معدات فقط", None),
)

# (kit code, item preset key, role, default quantity, substituted preset key)
KIT_ITEMS = (
    ("rifle", "rifle-mag", "default", 2, None),
    ("rifle", "sling", "default", 1, None),
    ("rifle", "rifle-rounds", "default", 30, None),
    ("pistol", "pistol-mag", "default", 2, None),
    ("pistol", "right-holster", "default", 1, None),
    ("pistol", "left-holster", "alternative", 0, "right-holster"),
    ("pistol", "pistol-rounds", "default", 12, None),
    *(
        (kit, item, "optional", 0, None)
        for kit in KIT_CODES
        for item in ("radio", "bodycam", "taser", "cuffs")
    ),
)


def _in(column: str, values: tuple[str, ...], *, nullable: bool = False) -> str:
    listed = ", ".join(f"'{value}'" for value in values)
    check = f"{column} IN ({listed})"
    return f"{column} IS NULL OR {check}" if nullable else check


def _qty(column: str, *, nullable: bool = False, positive: bool = False) -> str:
    low = ">= 1" if positive else ">= 0"
    check = f"{column} {low} AND {column} <= {MAX_QTY}"
    return f"{column} IS NULL OR ({check})" if nullable else check


def _nonblank(column: str) -> str:
    return f"length(trim({column})) > 0"


def upgrade() -> None:
    op.create_table(
        "armory_safes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name_en", sa.String(120), nullable=False),
        sa.Column("name_ar", sa.String(120), nullable=False),
        sa.Column(
            "vehicle_site_id", sa.Integer(), sa.ForeignKey("vehicle_sites.id"), nullable=True
        ),
        sa.Column("duty_unit", sa.String(128), nullable=True),
        sa.Column("duty_post", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("stock_revision", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint(_nonblank("name_en"), name="ck_armory_safes_name_en"),
        sa.CheckConstraint(_nonblank("name_ar"), name="ck_armory_safes_name_ar"),
        sa.CheckConstraint(
            "(duty_unit IS NULL) = (duty_post IS NULL)", name="ck_armory_safes_duty_pair"
        ),
        sa.CheckConstraint("stock_revision >= 0", name="ck_armory_safes_stock_revision"),
        sqlite_autoincrement=True,
    )
    op.create_index(
        "uq_armory_safes_name_en", "armory_safes", [sa.text("lower(name_en)")], unique=True
    )
    op.create_index("uq_armory_safes_name_ar", "armory_safes", ["name_ar"], unique=True)
    op.create_index(
        "uq_armory_safes_vehicle_site",
        "armory_safes",
        ["vehicle_site_id"],
        unique=True,
        sqlite_where=sa.text("vehicle_site_id IS NOT NULL"),
    )
    op.create_index(
        "uq_armory_safes_duty_path",
        "armory_safes",
        ["duty_unit", "duty_post"],
        unique=True,
        sqlite_where=sa.text("duty_unit IS NOT NULL"),
    )
    op.create_table(
        "armory_shift_policies",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("effective_on", sa.Date(), nullable=False),
        sa.Column("day_start", sa.Time(), nullable=False),
        sa.Column("night_start", sa.Time(), nullable=False),
        sa.Column("grace_minutes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.CheckConstraint("day_start < night_start", name="ck_armory_shift_policies_order"),
        sa.CheckConstraint(
            "grace_minutes >= 0 AND grace_minutes <= 1440", name="ck_armory_shift_policies_grace"
        ),
        sqlite_autoincrement=True,
    )
    op.create_index(
        "ix_armory_shift_policies_effective", "armory_shift_policies", ["effective_on", "id"]
    )
    op.create_table(
        "armory_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("preset_key", sa.String(40), nullable=True, unique=True),
        sa.Column("name_en", sa.String(120), nullable=False),
        sa.Column("name_ar", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column("drawing", sa.String(16), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.CheckConstraint(_nonblank("name_en"), name="ck_armory_items_name_en"),
        sa.CheckConstraint(_nonblank("name_ar"), name="ck_armory_items_name_ar"),
        sa.CheckConstraint(_in("kind", KINDS), name="ck_armory_items_kind"),
        sa.CheckConstraint(_in("category", CATEGORIES), name="ck_armory_items_category"),
        sa.CheckConstraint(_in("drawing", DRAWINGS), name="ck_armory_items_drawing"),
        sa.CheckConstraint(
            "(kind = 'firearm') = (category = 'firearms')", name="ck_armory_items_firearms"
        ),
        sa.CheckConstraint(
            "(kind = 'ammunition') = (category = 'ammo')", name="ck_armory_items_ammo"
        ),
        sqlite_autoincrement=True,
    )
    op.create_index(
        "uq_armory_items_name_en", "armory_items", [sa.text("lower(name_en)")], unique=True
    )
    op.create_index("uq_armory_items_name_ar", "armory_items", ["name_ar"], unique=True)
    op.create_table(
        "armory_kits",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(16), nullable=False, unique=True),
        sa.Column("name_en", sa.String(120), nullable=False),
        sa.Column("name_ar", sa.String(120), nullable=False),
        sa.Column("firearm_item_id", sa.Integer(), sa.ForeignKey("armory_items.id"), nullable=True),
        sa.CheckConstraint(_in("code", KIT_CODES), name="ck_armory_kits_code"),
        sa.CheckConstraint(
            "(code = 'equipment') = (firearm_item_id IS NULL)", name="ck_armory_kits_firearm"
        ),
        sqlite_autoincrement=True,
    )
    op.create_index(
        "uq_armory_kits_firearm",
        "armory_kits",
        ["firearm_item_id"],
        unique=True,
        sqlite_where=sa.text("firearm_item_id IS NOT NULL"),
    )
    op.create_table(
        "armory_kit_items",
        sa.Column("kit_id", sa.Integer(), sa.ForeignKey("armory_kits.id"), primary_key=True),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("armory_items.id"), primary_key=True),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("default_qty", sa.Integer(), nullable=False),
        sa.Column(
            "substitutes_item_id", sa.Integer(), sa.ForeignKey("armory_items.id"), nullable=True
        ),
        sa.CheckConstraint(_in("role", KIT_ROLES), name="ck_armory_kit_items_role"),
        sa.CheckConstraint(
            "(role = 'default' AND default_qty > 0) OR (role <> 'default' AND default_qty = 0)",
            name="ck_armory_kit_items_default_qty",
        ),
        sa.CheckConstraint(
            "(role = 'alternative') = (substitutes_item_id IS NOT NULL)",
            name="ck_armory_kit_items_substitute",
        ),
    )
    op.create_table(
        "armory_batches",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("armory_items.id"), nullable=False),
        sa.Column("batch_ref", sa.String(80), nullable=False),
        sa.Column("expires_on", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(_nonblank("batch_ref"), name="ck_armory_batches_ref"),
        sa.UniqueConstraint("item_id", "batch_ref", name="uq_armory_batches_item_ref"),
        sqlite_autoincrement=True,
    )
    op.create_table(
        "armory_stock",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("safe_id", sa.Integer(), sa.ForeignKey("armory_safes.id"), nullable=False),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("armory_items.id"), nullable=False),
        sa.Column("batch_id", sa.Integer(), sa.ForeignKey("armory_batches.id"), nullable=True),
        sa.Column("on_hand", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("opening_qty", sa.Integer(), nullable=True),
        sa.CheckConstraint(_qty("on_hand"), name="ck_armory_stock_on_hand"),
        sa.CheckConstraint(_qty("opening_qty", nullable=True), name="ck_armory_stock_opening"),
        sa.CheckConstraint(
            "batch_id IS NULL OR opening_qty IS NULL", name="ck_armory_stock_opening_unbatched"
        ),
        sqlite_autoincrement=True,
    )
    op.create_index(
        "uq_armory_stock_unbatched",
        "armory_stock",
        ["safe_id", "item_id"],
        unique=True,
        sqlite_where=sa.text("batch_id IS NULL"),
    )
    op.create_index(
        "uq_armory_stock_batch",
        "armory_stock",
        ["safe_id", "item_id", "batch_id"],
        unique=True,
        sqlite_where=sa.text("batch_id IS NOT NULL"),
    )
    op.create_table(
        "armory_guard_qualifications",
        sa.Column("employee_id", sa.String(16), sa.ForeignKey("employees.id"), primary_key=True),
        sa.Column("course_round", sa.Integer(), nullable=True),
        sa.Column("licence_number", sa.String(80), nullable=True),
        sa.Column("licence_expires_on", sa.Date(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.CheckConstraint(
            "course_round IS NULL OR course_round > 0", name="ck_armory_guard_quals_course"
        ),
        sa.CheckConstraint(
            "(licence_number IS NULL) = (licence_expires_on IS NULL)",
            name="ck_armory_guard_quals_licence_pair",
        ),
        sa.CheckConstraint(
            "licence_number IS NULL OR length(trim(licence_number)) > 0",
            name="ck_armory_guard_quals_licence_number",
        ),
        sa.CheckConstraint("version > 0", name="ck_armory_guard_quals_version"),
    )
    op.create_table(
        "armory_postings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("safe_id", sa.Integer(), sa.ForeignKey("armory_safes.id"), nullable=False),
        sa.Column(
            "related_posting_id", sa.Integer(), sa.ForeignKey("armory_postings.id"), nullable=True
        ),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("actor_employee_id", sa.String(16), sa.ForeignKey("employees.id"), nullable=True),
        sa.Column(
            "witness_employee_id", sa.String(16), sa.ForeignKey("employees.id"), nullable=True
        ),
        sa.Column("reference", sa.String(80), nullable=True),
        sa.Column("source", sa.String(16), nullable=True),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("serial_action", sa.String(16), nullable=True),
        sa.Column("period_key", sa.String(16), nullable=True),
        sa.Column("count_context", sa.JSON(), nullable=True),
        sa.Column("voided_at", sa.DateTime(), nullable=True),
        sa.Column("voided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("void_reason", sa.String(500), nullable=True),
        sa.Column(
            "void_witness_employee_id", sa.String(16), sa.ForeignKey("employees.id"), nullable=True
        ),
        sa.CheckConstraint(_in("kind", POSTING_KINDS), name="ck_armory_postings_kind"),
        sa.CheckConstraint(
            _in("source", INTAKE_SOURCES, nullable=True), name="ck_armory_postings_source"
        ),
        sa.CheckConstraint(
            _in("serial_action", SERIAL_ACTIONS, nullable=True),
            name="ck_armory_postings_serial_action",
        ),
        sa.CheckConstraint(
            "(voided_at IS NULL AND voided_by_id IS NULL AND void_reason IS NULL)"
            " OR (voided_at IS NOT NULL AND voided_by_id IS NOT NULL"
            " AND void_reason IS NOT NULL AND length(trim(void_reason)) > 0)",
            name="ck_armory_postings_void",
        ),
        sa.CheckConstraint(
            "void_witness_employee_id IS NULL OR voided_at IS NOT NULL",
            name="ck_armory_postings_void_witness",
        ),
        sa.CheckConstraint(
            "(period_key IS NULL) = (kind NOT IN ('shift_check', 'monthly_count'))",
            name="ck_armory_postings_period",
        ),
        sqlite_autoincrement=True,
    )
    op.create_index(
        "uq_armory_postings_live_period",
        "armory_postings",
        ["safe_id", "kind", "period_key"],
        unique=True,
        sqlite_where=sa.text("period_key IS NOT NULL AND voided_at IS NULL"),
    )
    op.create_index(
        "ix_armory_postings_safe_date", "armory_postings", ["safe_id", "occurred_on", "id"]
    )
    op.create_index("ix_armory_postings_related", "armory_postings", ["related_posting_id", "kind"])
    op.create_table(
        "armory_serials",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("armory_items.id"), nullable=False),
        sa.Column("serial_code", sa.String(80), nullable=False),
        sa.Column("safe_id", sa.Integer(), sa.ForeignKey("armory_safes.id"), nullable=True),
        sa.Column("state", sa.String(16), nullable=True),
        sa.Column("state_at", sa.DateTime(), nullable=True),
        sa.Column(
            "last_posting_id", sa.Integer(), sa.ForeignKey("armory_postings.id"), nullable=False
        ),
        sa.CheckConstraint(
            _in("state", SERIAL_STATES, nullable=True), name="ck_armory_serials_state"
        ),
        sa.CheckConstraint(
            "(state IS NULL) = (safe_id IS NULL) AND (state IS NULL) = (state_at IS NULL)",
            name="ck_armory_serials_live",
        ),
        sa.CheckConstraint(_nonblank("serial_code"), name="ck_armory_serials_code"),
        sqlite_autoincrement=True,
    )
    op.create_index(
        "uq_armory_serials_live_code",
        "armory_serials",
        ["serial_code"],
        unique=True,
        sqlite_where=sa.text("state IS NOT NULL"),
    )
    op.create_index(
        "ix_armory_serials_safe_item_state", "armory_serials", ["safe_id", "item_id", "state"]
    )
    op.create_table(
        "armory_assignments",
        sa.Column(
            "posting_id", sa.Integer(), sa.ForeignKey("armory_postings.id"), primary_key=True
        ),
        sa.Column("holder_kind", sa.String(8), nullable=False),
        sa.Column(
            "holder_employee_id", sa.String(16), sa.ForeignKey("employees.id"), nullable=True
        ),
        sa.Column("holder_safe_id", sa.Integer(), sa.ForeignKey("armory_safes.id"), nullable=True),
        sa.Column(
            "supervisor_employee_id", sa.String(16), sa.ForeignKey("employees.id"), nullable=True
        ),
        sa.Column("kit_id", sa.Integer(), sa.ForeignKey("armory_kits.id"), nullable=False),
        sa.Column("firearm_open", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("course_round_snapshot", sa.Integer(), nullable=True),
        sa.Column("licence_status_at_issue", sa.String(8), nullable=True),
        sa.Column("licence_warning_acknowledged", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("off_duty_reason", sa.String(8), nullable=True),
        sa.Column("off_duty_note", sa.String(500), nullable=True),
        sa.Column("excess_rounds_reason", sa.String(500), nullable=True),
        sa.Column("due_at", sa.DateTime(), nullable=True),
        sa.Column("grace_minutes", sa.Integer(), nullable=True),
        sa.Column("shift_window", sa.JSON(), nullable=True),
        sa.Column("receipt_snapshot", sa.JSON(), nullable=True),
        sa.CheckConstraint(
            "(holder_kind = 'person' AND holder_employee_id IS NOT NULL"
            " AND holder_safe_id IS NULL AND supervisor_employee_id IS NULL)"
            " OR (holder_kind = 'site' AND holder_employee_id IS NULL"
            " AND holder_safe_id IS NOT NULL)",
            name="ck_armory_assignments_holder",
        ),
        sa.CheckConstraint(
            _in("licence_status_at_issue", LICENCE_STATUSES, nullable=True),
            name="ck_armory_assignments_licence_status",
        ),
        sa.CheckConstraint(
            _in("off_duty_reason", OFF_DUTY_REASONS, nullable=True),
            name="ck_armory_assignments_off_duty",
        ),
        sa.CheckConstraint(
            "firearm_open IN (0, 1) AND licence_warning_acknowledged IN (0, 1)",
            name="ck_armory_assignments_booleans",
        ),
        sa.CheckConstraint(
            "(due_at IS NULL) = (grace_minutes IS NULL)"
            " AND (due_at IS NULL) = (shift_window IS NULL)"
            " AND (due_at IS NULL OR receipt_snapshot IS NULL)",
            name="ck_armory_assignments_shift_fields",
        ),
        sa.CheckConstraint(
            "grace_minutes IS NULL OR (grace_minutes >= 0 AND grace_minutes <= 1440)",
            name="ck_armory_assignments_grace",
        ),
        sa.CheckConstraint(
            "course_round_snapshot IS NULL OR course_round_snapshot > 0",
            name="ck_armory_assignments_course",
        ),
    )
    op.create_index(
        "uq_armory_assignments_open_firearm",
        "armory_assignments",
        [sa.text("coalesce(holder_employee_id, supervisor_employee_id)")],
        unique=True,
        sqlite_where=sa.text("firearm_open = 1"),
    )
    op.create_index("ix_armory_assignments_holder", "armory_assignments", ["holder_employee_id"])
    op.create_index(
        "ix_armory_assignments_supervisor", "armory_assignments", ["supervisor_employee_id"]
    )
    op.create_table(
        "armory_assignment_lines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "assignment_id",
            sa.Integer(),
            sa.ForeignKey("armory_assignments.posting_id"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("armory_items.id"), nullable=False),
        sa.Column("serial_id", sa.Integer(), sa.ForeignKey("armory_serials.id"), nullable=True),
        sa.Column("batch_id", sa.Integer(), sa.ForeignKey("armory_batches.id"), nullable=True),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("remaining_qty", sa.Integer(), nullable=False),
        sa.CheckConstraint(_qty("qty", positive=True), name="ck_armory_assignment_lines_qty"),
        sa.CheckConstraint(
            "remaining_qty >= 0 AND remaining_qty <= qty",
            name="ck_armory_assignment_lines_remaining",
        ),
        sa.CheckConstraint(
            "serial_id IS NULL OR (qty = 1 AND batch_id IS NULL)",
            name="ck_armory_assignment_lines_serial",
        ),
        sa.UniqueConstraint(
            "assignment_id", "position", name="uq_armory_assignment_lines_position"
        ),
        sqlite_autoincrement=True,
    )
    op.create_index(
        "uq_armory_assignment_lines_open_serial",
        "armory_assignment_lines",
        ["serial_id"],
        unique=True,
        sqlite_where=sa.text("serial_id IS NOT NULL AND remaining_qty > 0"),
    )
    op.create_table(
        "armory_posting_lines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("posting_id", sa.Integer(), sa.ForeignKey("armory_postings.id"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("armory_items.id"), nullable=False),
        sa.Column("serial_id", sa.Integer(), sa.ForeignKey("armory_serials.id"), nullable=True),
        sa.Column("batch_id", sa.Integer(), sa.ForeignKey("armory_batches.id"), nullable=True),
        sa.Column(
            "assignment_line_id",
            sa.Integer(),
            sa.ForeignKey("armory_assignment_lines.id"),
            nullable=True,
        ),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("stock_delta", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("before_on_hand", sa.Integer(), nullable=True),
        sa.Column("after_on_hand", sa.Integer(), nullable=True),
        sa.Column("before_state", sa.String(16), nullable=True),
        sa.Column("after_state", sa.String(16), nullable=True),
        sa.Column("before_safe_id", sa.Integer(), sa.ForeignKey("armory_safes.id"), nullable=True),
        sa.Column("after_safe_id", sa.Integer(), sa.ForeignKey("armory_safes.id"), nullable=True),
        sa.Column("remaining_before", sa.Integer(), nullable=True),
        sa.Column("remaining_after", sa.Integer(), nullable=True),
        sa.Column("condition", sa.String(8), nullable=True),
        sa.Column("fault_note", sa.String(500), nullable=True),
        sa.CheckConstraint(_qty("qty"), name="ck_armory_posting_lines_qty"),
        sa.CheckConstraint(
            f"stock_delta >= -{MAX_QTY} AND stock_delta <= {MAX_QTY}",
            name="ck_armory_posting_lines_delta",
        ),
        sa.CheckConstraint(
            _in("before_state", SERIAL_STATES, nullable=True),
            name="ck_armory_posting_lines_before_state",
        ),
        sa.CheckConstraint(
            _in("after_state", SERIAL_STATES, nullable=True),
            name="ck_armory_posting_lines_after_state",
        ),
        sa.CheckConstraint(
            _in("condition", ("ok", "repair"), nullable=True),
            name="ck_armory_posting_lines_condition",
        ),
        sa.UniqueConstraint("posting_id", "position", name="uq_armory_posting_lines_position"),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_armory_posting_lines_serial", "armory_posting_lines", ["serial_id"])
    op.create_index("ix_armory_posting_lines_item", "armory_posting_lines", ["item_id"])
    op.create_index(
        "ix_armory_posting_lines_assignment_line", "armory_posting_lines", ["assignment_line_id"]
    )
    op.create_table(
        "armory_count_lines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("posting_id", sa.Integer(), sa.ForeignKey("armory_postings.id"), nullable=False),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("armory_items.id"), nullable=False),
        sa.Column("expected_qty", sa.Integer(), nullable=True),
        sa.Column("observed_qty", sa.Integer(), nullable=False),
        sa.Column("expected_serial_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("observed_serial_codes", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("expected_unrecorded_qty", sa.Integer(), nullable=True),
        sa.Column("observed_unrecorded_qty", sa.Integer(), nullable=True),
        sa.CheckConstraint(_qty("observed_qty"), name="ck_armory_count_lines_observed"),
        sa.CheckConstraint(
            _qty("expected_qty", nullable=True), name="ck_armory_count_lines_expected"
        ),
        sa.CheckConstraint(
            _qty("expected_unrecorded_qty", nullable=True),
            name="ck_armory_count_lines_expected_unrecorded",
        ),
        sa.CheckConstraint(
            _qty("observed_unrecorded_qty", nullable=True),
            name="ck_armory_count_lines_observed_unrecorded",
        ),
        sa.UniqueConstraint("posting_id", "item_id", name="uq_armory_count_lines_item"),
        sqlite_autoincrement=True,
    )
    op.create_table(
        "armory_discrepancies",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "source_posting_id", sa.Integer(), sa.ForeignKey("armory_postings.id"), nullable=False
        ),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("armory_items.id"), nullable=False),
        sa.Column(
            "assignment_line_id",
            sa.Integer(),
            sa.ForeignKey("armory_assignment_lines.id"),
            nullable=True,
        ),
        sa.Column("serial_id", sa.Integer(), sa.ForeignKey("armory_serials.id"), nullable=True),
        sa.Column("unexpected_serial_code", sa.String(80), nullable=True),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("expected_qty", sa.Integer(), nullable=False),
        sa.Column("observed_qty", sa.Integer(), nullable=False),
        sa.Column(
            "involved_employee_id", sa.String(16), sa.ForeignKey("employees.id"), nullable=True
        ),
        sa.Column("shortfall_reason", sa.String(16), nullable=True),
        sa.Column("reference", sa.String(80), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column(
            "active_decision_posting_id",
            sa.Integer(),
            sa.ForeignKey("armory_postings.id"),
            nullable=True,
        ),
        sa.CheckConstraint(_in("kind", DISCREPANCY_KINDS), name="ck_armory_discrepancies_kind"),
        sa.CheckConstraint(
            _in("shortfall_reason", SHORTFALL_REASONS, nullable=True),
            name="ck_armory_discrepancies_reason",
        ),
        sa.CheckConstraint(
            _qty("expected_qty") + " AND " + _qty("observed_qty"),
            name="ck_armory_discrepancies_qty",
        ),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_armory_discrepancies_source", "armory_discrepancies", ["source_posting_id"])
    op.create_index(
        "ix_armory_discrepancies_decision", "armory_discrepancies", ["active_decision_posting_id"]
    )
    op.create_index("ix_armory_discrepancies_serial", "armory_discrepancies", ["serial_id"])
    op.create_table(
        "armory_decisions",
        sa.Column(
            "posting_id", sa.Integer(), sa.ForeignKey("armory_postings.id"), primary_key=True
        ),
        sa.Column(
            "discrepancy_id", sa.Integer(), sa.ForeignKey("armory_discrepancies.id"), nullable=False
        ),
        sa.Column("outcome", sa.String(24), nullable=False),
        sa.CheckConstraint(_in("outcome", DECISION_OUTCOMES), name="ck_armory_decisions_outcome"),
    )
    op.create_index(
        "ix_armory_decisions_discrepancy", "armory_decisions", ["discrepancy_id", "posting_id"]
    )
    _seed()


def _seed() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "INSERT INTO armory_items (preset_key, name_en, name_ar, kind, category, drawing) "
            "VALUES (:preset_key, :name_en, :name_ar, :kind, :category, :drawing)"
        ),
        [
            dict(
                preset_key=key,
                name_en=en,
                name_ar=ar,
                kind=kind,
                category=category,
                drawing=drawing,
            )
            for key, en, ar, kind, category, drawing in ITEMS
        ],
    )
    item_ids: dict[str, int] = dict(
        connection.execute(sa.text("SELECT preset_key, id FROM armory_items")).tuples().all()
    )
    connection.execute(
        sa.text(
            "INSERT INTO armory_kits (code, name_en, name_ar, firearm_item_id) "
            "VALUES (:code, :name_en, :name_ar, :firearm_item_id)"
        ),
        [
            dict(
                code=code,
                name_en=en,
                name_ar=ar,
                firearm_item_id=item_ids[firearm] if firearm else None,
            )
            for code, en, ar, firearm in KITS
        ],
    )
    kit_ids: dict[str, int] = dict(
        connection.execute(sa.text("SELECT code, id FROM armory_kits")).tuples().all()
    )
    connection.execute(
        sa.text(
            "INSERT INTO armory_kit_items (kit_id, item_id, role, default_qty, substitutes_item_id) "
            "VALUES (:kit_id, :item_id, :role, :default_qty, :substitutes_item_id)"
        ),
        [
            dict(
                kit_id=kit_ids[kit],
                item_id=item_ids[item],
                role=role,
                default_qty=qty,
                substitutes_item_id=item_ids[substitute] if substitute else None,
            )
            for kit, item, role, qty, substitute in KIT_ITEMS
        ],
    )


def downgrade() -> None:
    op.drop_index("ix_armory_decisions_discrepancy", table_name="armory_decisions")
    op.drop_table("armory_decisions")
    op.drop_index("ix_armory_discrepancies_serial", table_name="armory_discrepancies")
    op.drop_index("ix_armory_discrepancies_decision", table_name="armory_discrepancies")
    op.drop_index("ix_armory_discrepancies_source", table_name="armory_discrepancies")
    op.drop_table("armory_discrepancies")
    op.drop_table("armory_count_lines")
    op.drop_index("ix_armory_posting_lines_assignment_line", table_name="armory_posting_lines")
    op.drop_index("ix_armory_posting_lines_item", table_name="armory_posting_lines")
    op.drop_index("ix_armory_posting_lines_serial", table_name="armory_posting_lines")
    op.drop_table("armory_posting_lines")
    op.drop_index("uq_armory_assignment_lines_open_serial", table_name="armory_assignment_lines")
    op.drop_table("armory_assignment_lines")
    op.drop_index("ix_armory_assignments_supervisor", table_name="armory_assignments")
    op.drop_index("ix_armory_assignments_holder", table_name="armory_assignments")
    op.drop_index("uq_armory_assignments_open_firearm", table_name="armory_assignments")
    op.drop_table("armory_assignments")
    op.drop_index("ix_armory_serials_safe_item_state", table_name="armory_serials")
    op.drop_index("uq_armory_serials_live_code", table_name="armory_serials")
    op.drop_table("armory_serials")
    op.drop_index("ix_armory_postings_related", table_name="armory_postings")
    op.drop_index("ix_armory_postings_safe_date", table_name="armory_postings")
    op.drop_index("uq_armory_postings_live_period", table_name="armory_postings")
    op.drop_table("armory_postings")
    op.drop_table("armory_guard_qualifications")
    op.drop_index("uq_armory_stock_batch", table_name="armory_stock")
    op.drop_index("uq_armory_stock_unbatched", table_name="armory_stock")
    op.drop_table("armory_stock")
    op.drop_table("armory_batches")
    op.drop_table("armory_kit_items")
    op.drop_index("uq_armory_kits_firearm", table_name="armory_kits")
    op.drop_table("armory_kits")
    op.drop_index("uq_armory_items_name_ar", table_name="armory_items")
    op.drop_index("uq_armory_items_name_en", table_name="armory_items")
    op.drop_table("armory_items")
    op.drop_index("ix_armory_shift_policies_effective", table_name="armory_shift_policies")
    op.drop_table("armory_shift_policies")
    op.drop_index("uq_armory_safes_duty_path", table_name="armory_safes")
    op.drop_index("uq_armory_safes_vehicle_site", table_name="armory_safes")
    op.drop_index("uq_armory_safes_name_ar", table_name="armory_safes")
    op.drop_index("uq_armory_safes_name_en", table_name="armory_safes")
    op.drop_table("armory_safes")
