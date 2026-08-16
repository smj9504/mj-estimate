"""Seed antimicrobial application line item

Revision ID: am01a2b3c4d5
Revises: ls01a2b3c4d5
Create Date: 2026-08-16

Inserts:
  - Line item: Antimicrobial Application at $0.25/SF (material + labor)
    Auto-added to Scope of Work whenever drywall (ceiling/wall) or floor
    demolition is present in a water mitigation sketch, per IICRC S500
    guidance on treating exposed framing/subfloor after demo.
"""

import uuid

from alembic import op
from sqlalchemy import text

revision = "am01a2b3c4d5"
down_revision = "ls01a2b3c4d5"
branch_labels = None
depends_on = None

_ITEM_CODE = "WTRGRM"


def upgrade() -> None:
    line_item_id = str(uuid.uuid4())

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
            item=_ITEM_CODE,
            description="Antimicrobial Application",
            includes=(
                "Apply EPA-registered antimicrobial/germicide agent to exposed "
                "framing, subfloor, and structural surfaces following drywall "
                "or floor demolition, to inhibit mold growth (material + labor)"
            ),
            unit="SF",
            price=0.25,
        )
    )


def downgrade() -> None:
    op.execute(
        text(
            "DELETE FROM line_items "
            "WHERE cat = 'WTR' AND item = :item"
        ).bindparams(item=_ITEM_CODE)
    )
