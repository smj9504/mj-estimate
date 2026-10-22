"""Seed Drywall - 4ft standard scope item

Revision ID: wm20261023dw401
Revises: neg20261023rcv01
Create Date: 2026-10-23

Sketch scope items named "Wall - Drywall 4ft (...)" alias to the
"Drywall - 4ft" standard scope item when invoice configs are
auto-generated, but only "Drywall - 2ft" was ever created, so 4ft walls
came out without a line item. Adds it as a system-wide item mapped to the
WTR/RMDRY4 line item ("Tear out wet drywall, cleanup, bag, per LF - up to
4' tall"), copying the 2ft item's debris material and display order.
"""

import uuid

from alembic import op
from sqlalchemy import text

revision = "wm20261023dw401"
down_revision = "neg20261023rcv01"
branch_labels = None
depends_on = None

_NAME = "Drywall - 4ft"
_ITEM_CODE = "RMDRY4"


def upgrade() -> None:
    conn = op.get_bind()

    line_item_id = conn.execute(
        text(
            "SELECT id FROM line_items "
            "WHERE cat = 'WTR' AND item = :item AND is_active = true"
        ),
        {"item": _ITEM_CODE},
    ).scalar()

    if line_item_id is None:
        return

    exists = conn.execute(
        text(
            "SELECT 1 FROM wm_standard_scope_items "
            "WHERE lower(name) = lower(:name) AND company_id IS NULL"
        ),
        {"name": _NAME},
    ).scalar()

    if exists:
        return

    two_ft = conn.execute(
        text(
            "SELECT material_weight_id, display_order "
            "FROM wm_standard_scope_items "
            "WHERE lower(name) = 'drywall - 2ft' AND company_id IS NULL"
        )
    ).first()

    op.execute(
        text(
            """
            INSERT INTO wm_standard_scope_items
                (id, item_type, name, unit, material_weight_id,
                 default_include_in_debris, line_item_id,
                 quantity_calc_type, display_order, is_active)
            VALUES
                (:id, 'demolition', :name, 'LF', :material_weight_id,
                 true, :line_item_id,
                 'fixed', :display_order, true)
            """
        ).bindparams(
            id=str(uuid.uuid4()),
            name=_NAME,
            material_weight_id=two_ft.material_weight_id if two_ft else None,
            line_item_id=line_item_id,
            display_order=two_ft.display_order if two_ft else 0,
        )
    )


def downgrade() -> None:
    op.execute(
        text(
            "DELETE FROM wm_standard_scope_items "
            "WHERE name = 'Drywall - 4ft' AND company_id IS NULL"
        )
    )
