"""Seed plastic floor protection line items and standard scope items

Revision ID: wm20261110fpp01
Revises: cs20261109sg01
Create Date: 2026-11-10

Water mitigation sketches can now lay floor protection with plastic & tape as
well as paper & tape, on a floor or on stairs. Sketch scope generation names
the plastic ones "Floor Protection - Plastic" and "Floor Protection - Plastic
(Stairs)". This adds the WTR line items they bill to and the system-wide
standard scope items that map them, so invoice configs pick them up.

Prices (defaults, editable in Line Items):
  - WTRFPP  floor   $0.37/SF: Xactimate VAAR8X_NOV26 DRY MASKSF> "Floor
    protection - plastic and tape - 10 mil" (material 0.12, labor 0.25).
    Carrier estimates on file price the same item $0.27-$0.45 (median $0.31,
    newest lists $0.35-$0.45).
  - WTRFPPS stairs  $1.09/SF: Xactimate has no stair item, and carriers bill
    stairs at the floor rate. Per SF as the sketch measures a stair (from
    above, treads only): risers add ~75% more surface (7.5" riser per 10"
    tread), and each step is cut and taped by hand at about half the flat
    speed. Material 0.12 x 1.75 + labor 0.25 x 1.75 x 2 = 1.085.

The standard scope items take the display order of the paper item of the same
kind, so they list next to it.
"""

import uuid

from alembic import op
from sqlalchemy import text

revision = "wm20261110fpp01"
down_revision = "cs20261109sg01"
branch_labels = None
depends_on = None

# (item code, line item description, includes, price,
#  standard scope item name, paper standard item it lists next to)
_ITEMS = [
    (
        "WTRFPP",
        "Floor protection - plastic and tape - 10 mil",
        "10 mil plastic sheeting laid over the floor with seams and edges "
        "taped, and labor",
        0.37,
        "Floor Protection - Plastic",
        "floor protection",
    ),
    (
        "WTRFPPS",
        "Floor protection - plastic and tape - 10 mil - stairs",
        "10 mil plastic cut to each tread and riser and taped at the nosing "
        "and edges, and labor. Per SF of stair as measured from above "
        "(treads); risers included in the price",
        1.09,
        "Floor Protection - Plastic (Stairs)",
        "floor protection (stairs)",
    ),
]


def upgrade() -> None:
    conn = op.get_bind()

    for code, description, includes, price, std_name, paper_name in _ITEMS:
        # line_items has no unique constraint for ON CONFLICT to catch
        line_item_id = conn.execute(
            text("SELECT id FROM line_items WHERE cat = 'WTR' AND item = :item"),
            {"item": code},
        ).scalar()

        if line_item_id is None:
            line_item_id = str(uuid.uuid4())
            conn.execute(
                text(
                    """
                    INSERT INTO line_items
                        (id, type, cat, item, description,
                         includes, unit, untaxed_unit_price,
                         is_active, version)
                    VALUES
                        (:id, 'CUSTOM', 'WTR', :item, :description,
                         :includes, 'SF', :price,
                         true, 1)
                    """
                ),
                {
                    "id": line_item_id,
                    "item": code,
                    "description": description,
                    "includes": includes,
                    "price": price,
                },
            )

        exists = conn.execute(
            text(
                "SELECT 1 FROM wm_standard_scope_items "
                "WHERE lower(name) = lower(:name) AND company_id IS NULL"
            ),
            {"name": std_name},
        ).scalar()
        if exists:
            continue

        display_order = conn.execute(
            text(
                "SELECT display_order FROM wm_standard_scope_items "
                "WHERE lower(name) = :name AND company_id IS NULL"
            ),
            {"name": paper_name},
        ).scalar()

        conn.execute(
            text(
                """
                INSERT INTO wm_standard_scope_items
                    (id, item_type, name, unit, default_include_in_debris,
                     line_item_id, quantity_calc_type,
                     display_order, is_active)
                VALUES
                    (:id, 'standard', :name, 'SF', false,
                     :line_item_id, 'fixed',
                     :display_order, true)
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "name": std_name,
                "line_item_id": line_item_id,
                "display_order": display_order if display_order is not None else 0,
            },
        )


def downgrade() -> None:
    conn = op.get_bind()
    for code, _, _, _, std_name, _ in _ITEMS:
        conn.execute(
            text(
                "DELETE FROM wm_standard_scope_items "
                "WHERE name = :name AND company_id IS NULL"
            ),
            {"name": std_name},
        )
        conn.execute(
            text("DELETE FROM line_items WHERE cat = 'WTR' AND item = :item"),
            {"item": code},
        )
