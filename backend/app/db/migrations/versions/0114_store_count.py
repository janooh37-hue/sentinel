"""Optional item presentation and delivery-only carton metadata.

Revision ID: 0114_store_count
Revises: 0113_store_room
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0114_store_count"
down_revision: str | Sequence[str] | None = "0113_store_room"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FIELDS = (
    ("brand_label", 40),
    ("generic_label_en", 32),
    ("generic_label_ar", 32),
    ("short_name_en", 128),
    ("short_name_ar", 128),
    ("pack_description_en", 160),
    ("pack_description_ar", 160),
)
# Exact official names, never assumed IDs; no quantity or official-name edits.
_BACKFILL = (
    (
        "Nescafe Classic 190 g",
        (
            "NESCAFÉ\nClassic",
            "Coffee",
            "قهوة",
            "Nescafe Classic",
            "نسكافيه كلاسيك",
            "12 jars \u00d7 190 g",
            "كرتون: 12 مرطبانًا، 190 غ لكل مرطبان",
        ),
    ),
    (
        "Coffee-mate 400 g",
        (
            "Coffee-mate",
            "Creamer",
            "مبيض قهوة",
            "Coffee-mate",
            "كوفي ميت",
            "15 jars \u00d7 400 g",
            "كرتون: 15 مرطبانًا، 400 غ لكل مرطبان",
        ),
    ),
    (
        "Lipton Yellow Label tea 400 g",
        (
            "LIPTON\nYellow Label",
            "Tea",
            "شاي",
            "Lipton Yellow Label",
            "ليبتون الأصفر",
            "24 boxes \u00d7 400 g",
            "كرتون: 24 علبة، 400 غ لكل علبة",
        ),
    ),
    (
        "Green tea",
        (
            None,
            "Green tea",
            "شاي أخضر",
            "Green tea",
            "شاي أخضر",
            "Packet; size not recorded",
            "حجم العبوة غير مسجّل · العد بالعلبة",
        ),
    ),
    (
        "Lipton Red Label tea, 100 bags",
        (
            "LIPTON\nRed Label",
            "Tea",
            "شاي",
            "Lipton Red Label",
            "ليبتون الأحمر",
            "36 boxes \u00d7 100 bags",
            "كرتون: 36 علبة، 100 كيس شاي لكل علبة",
        ),
    ),
    (
        "Rainbow milk 170 g",
        (
            "Rainbow",
            "Milk",
            "حليب",
            "Rainbow milk",
            "حليب رينبو",
            "96 tins \u00d7 170 g",
            "كرتون: 96 علبة، 170 غ لكل علبة",
        ),
    ),
    (
        "Liwa water",
        (
            "Liwa",
            "Water",
            "مياه",
            "Liwa water",
            "مياه ليوا",
            "Carton; contents not recorded",
            "حجم العبوة غير مسجّل · العد بالكرتون",
        ),
    ),
    (
        "Coffee cups, 40 per sleeve",
        (
            None,
            "Cups",
            "أكواب",
            "Coffee cups",
            "أكواب قهوة",
            "50 sleeves \u00d7 40 cups",
            "كرتون: 50 رزمة، 40 كوبًا لكل رزمة",
        ),
    ),
    (
        "Big coffee cups",
        (
            None,
            "Cups",
            "أكواب",
            "Large coffee cups",
            "أكواب قهوة كبيرة",
            "Carton; contents not recorded",
            "كرتون · المحتويات غير مسجّلة",
        ),
    ),
    (
        "Masafi café tissues, 150 sheets 2-ply",
        (
            "Masafi",
            "Tissues",
            "مناديل",
            "Masafi tissues",
            "مناديل مسافي",
            "150 sheets · 2-ply; carton contents not recorded",
            "150 منديلًا · طبقتان · محتويات الكرتون غير مسجّلة",
        ),
    ),
    (
        "Nitrile gloves",
        (
            None,
            "Nitrile",
            "نتريل",
            "Nitrile gloves",
            "قفازات نتريل",
            "Carton; contents not recorded",
            "حجم العبوة غير مسجّل · العد بالكرتون",
        ),
    ),
    (
        "Vinyl gloves, 100 per box",
        (
            None,
            "Vinyl",
            "فينيل",
            "Vinyl gloves",
            "قفازات فينيل",
            "10 boxes \u00d7 100 gloves",
            "كرتون: 10 علب، 100 قفاز لكل علبة",
        ),
    ),
    (
        "Face masks, 3-ply blue",
        (
            None,
            "Mask",
            "كمامة",
            "Face masks",
            "كمامات وجه",
            "3-ply; carton contents not recorded",
            "زرقاء · 3 طبقات · حجم العبوة غير مسجّل",
        ),
    ),
)


def upgrade() -> None:
    with op.batch_alter_table("store_items") as batch:
        for field, length in _FIELDS:
            batch.add_column(sa.Column(field, sa.String(length), nullable=True))
    with op.batch_alter_table("store_delivery_lines", recreate="always") as batch:
        batch.add_column(sa.Column("carton_contains_qty", sa.Integer(), nullable=True))
        batch.create_check_constraint(
            "ck_store_delivery_lines_carton_contains",
            "carton_contains_qty IS NULL OR carton_contains_qty >= 1",
        )
    items = sa.table(
        "store_items",
        sa.column("name_en", sa.String()),
        *(sa.column(field, sa.String(length)) for field, length in _FIELDS),
    )
    connection = op.get_bind()
    for name, values in _BACKFILL:
        connection.execute(
            items.update()
            .where(items.c.name_en == name)
            .values(**{field: value for (field, _), value in zip(_FIELDS, values, strict=True)})
        )


def downgrade() -> None:
    with op.batch_alter_table("store_delivery_lines", recreate="always") as batch:
        batch.drop_constraint("ck_store_delivery_lines_carton_contains", type_="check")
        batch.drop_column("carton_contains_qty")
    with op.batch_alter_table("store_items") as batch:
        for field, _ in reversed(_FIELDS):
            batch.drop_column(field)
