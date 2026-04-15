"""Seed WM demolition line items: trim, door, stair

Revision ID: r0s1t2u3v4w5
Revises: q9r0s1t2u3v4
Create Date: 2026-04-15

Inserts default line items for:
  - Window Casing Removal (Small / Medium / Large / X-Large)
  - Door Casing Removal (Small / Medium / Large / X-Large)
  - Door & Frame Removal (Small / Medium / Large / X-Large)
  - Stair Tread Removal (per tread)
"""

import uuid

from alembic import op
from sqlalchemy import text

revision = "r0s1t2u3v4w5"
down_revision = "q9r0s1t2u3v4"
branch_labels = None
depends_on = None

# Line items to seed: (item_code, description, includes, unit, price)
_LINE_ITEMS = [
    # Window Casing Removal
    (
        "WTRWCR-SM",
        "Window Casing Removal - Small",
        "R&R window trim/casing, small window (24-30 in.)",
        "EA",
        20.00,
    ),
    (
        "WTRWCR-MD",
        "Window Casing Removal - Medium",
        "R&R window trim/casing, medium window (36-48 in.)",
        "EA",
        35.00,
    ),
    (
        "WTRWCR-LG",
        "Window Casing Removal - Large",
        "R&R window trim/casing, large window (60-72 in.)",
        "EA",
        50.00,
    ),
    (
        "WTRWCR-XL",
        "Window Casing Removal - X-Large",
        "R&R window trim/casing, x-large window (96+ in.)",
        "EA",
        75.00,
    ),
    # Door Casing Removal
    (
        "WTRDCR-SM",
        "Door Casing Removal - Small",
        "R&R door trim/casing, small door (24-28 in.)",
        "EA",
        35.00,
    ),
    (
        "WTRDCR-MD",
        "Door Casing Removal - Medium",
        "R&R door trim/casing, medium door (30-32 in.)",
        "EA",
        45.00,
    ),
    (
        "WTRDCR-LG",
        "Door Casing Removal - Large",
        "R&R door trim/casing, large door (34-36 in.)",
        "EA",
        55.00,
    ),
    (
        "WTRDCR-XL",
        "Door Casing Removal - X-Large",
        "R&R door trim/casing, double/bi-fold door",
        "EA",
        80.00,
    ),
    # Door & Frame Removal
    (
        "WTRDRF-SM",
        "Door & Frame Removal - Small",
        "Remove door slab & frame, small (24-28 in.)",
        "EA",
        75.00,
    ),
    (
        "WTRDRF-MD",
        "Door & Frame Removal - Medium",
        "Remove door slab & frame, medium (30-32 in.)",
        "EA",
        100.00,
    ),
    (
        "WTRDRF-LG",
        "Door & Frame Removal - Large",
        "Remove door slab & frame, large (34-36 in.)",
        "EA",
        125.00,
    ),
    (
        "WTRDRF-XL",
        "Door & Frame Removal - X-Large",
        "Remove door slab & frame, double/French door",
        "EA",
        175.00,
    ),
    # Stair Tread Removal
    (
        "WTRSTR",
        "Stair Tread Removal",
        "Remove stair tread, per tread",
        "EA",
        85.00,
    ),
]


def upgrade() -> None:
    for item_code, description, includes, unit, price in _LINE_ITEMS:
        item_id = str(uuid.uuid4())
        op.execute(
            text(
                """
                INSERT INTO line_items
                    (id, type, cat, item, description,
                     includes, unit, untaxed_unit_price,
                     is_active, version)
                VALUES
                    (:id, 'CUSTOM', 'WTR', :item, :description,
                     :includes, :unit, :price,
                     true, 1)
                ON CONFLICT DO NOTHING
                """
            ).bindparams(
                id=item_id,
                item=item_code,
                description=description,
                includes=includes,
                unit=unit,
                price=price,
            )
        )


def downgrade() -> None:
    item_codes = [row[0] for row in _LINE_ITEMS]
    for code in item_codes:
        op.execute(
            text(
                "DELETE FROM line_items "
                "WHERE cat = 'WTR' AND item = :item"
            ).bindparams(item=code)
        )
