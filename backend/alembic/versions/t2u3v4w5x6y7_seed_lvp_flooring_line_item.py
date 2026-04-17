"""Seed LVP flooring demolition line item and standard scope item mapping

Revision ID: t2u3v4w5x6y7
Revises: s1t2u3v4w5x6
Create Date: 2026-04-17

Inserts:
  - Line item: LVP flooring demolition at $4.00/SF
  - Standard scope item mapping: "Wood Floor (LVP)" → LVP line item
"""

import uuid

from alembic import op
from sqlalchemy import text

revision = "t2u3v4w5x6y7"
down_revision = "s1t2u3v4w5x6"
branch_labels = None
depends_on = None

_LVP_ITEM_CODE = "WTRFLVP"


def upgrade() -> None:
    line_item_id = str(uuid.uuid4())
    std_item_id = str(uuid.uuid4())

    # 1. Create LVP line item
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
            id=line_item_id,
            item=_LVP_ITEM_CODE,
            description="Tear out non-salvageable LVP flooring & bag for disposal",
            includes="Remove non-salvageable luxury vinyl plank (LVP) flooring, cleanup, bag for disposal",
            unit="SF",
            price=4.00,
        )
    )

    # 2. Create standard scope item mapping
    op.execute(
        text(
            """
            INSERT INTO wm_standard_scope_items
                (id, item_type, name, description, unit,
                 line_item_id, is_active, display_order)
            VALUES
                (:id, 'demolition', 'Wood Floor (LVP)',
                 'LVP flooring demolition', 'SF',
                 :line_item_id, true, 100)
            ON CONFLICT DO NOTHING
            """
        ).bindparams(
            id=std_item_id,
            line_item_id=line_item_id,
        )
    )


def downgrade() -> None:
    # Remove standard scope item first (FK dependency)
    op.execute(
        text(
            "DELETE FROM wm_standard_scope_items "
            "WHERE name = 'Wood Floor (LVP)'"
        )
    )
    op.execute(
        text(
            "DELETE FROM line_items "
            "WHERE cat = 'WTR' AND item = :item"
        ).bindparams(item=_LVP_ITEM_CODE)
    )
