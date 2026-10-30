"""Seed recessed light detach line item and standard scope item

Revision ID: wm20261030rld01
Revises: os20261030fd01
Create Date: 2026-10-30

Recessed lights placed on a water mitigation sketch become "Recessed Light
Detach" scope items. Adds the WTR/WTRRLD line item they bill to, and the
system-wide standard scope item that maps them to it when invoice configs are
auto-generated.

Priced at $80/EA, half the median Xactimate "Recessed light fixture - Detach &
reset, entire unit" unit price in the carrier estimates on file (VA/DC/MD/NJ
price lists, 2022-2025: $127-$185, median $158), because mitigation bills the
detach and the reset belongs to reconstruction. It also matches the "Light
fixture - Detach" line item. Xactimate's $4-$5 "trim only" detach doesn't
apply: taking down a ceiling means taking the housing out too.
"""

import uuid

from alembic import op
from sqlalchemy import text

revision = "wm20261030rld01"
down_revision = "os20261030fd01"
branch_labels = None
depends_on = None

_ITEM_CODE = "WTRRLD"
_NAME = "Recessed Light Detach"
# Listed right after "Drywall - Ceiling", the demo it usually goes with
_DISPLAY_ORDER = 14


def upgrade() -> None:
    conn = op.get_bind()

    # line_items has no unique constraint for ON CONFLICT to catch
    line_item_id = conn.execute(
        text("SELECT id FROM line_items WHERE cat = 'WTR' AND item = :item"),
        {"item": _ITEM_CODE},
    ).scalar()

    if line_item_id is None:
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
                """
            ).bindparams(
                id=line_item_id,
                item=_ITEM_CODE,
                description="Recessed light fixture - Detach",
                includes=(
                    "Shut off power, disconnect and remove recessed light "
                    "housing and trim, cap wiring, and set aside for reset. "
                    "Reset not included"
                ),
                unit="EA",
                price=80.00,
            )
        )

    exists = conn.execute(
        text(
            "SELECT 1 FROM wm_standard_scope_items "
            "WHERE lower(name) = lower(:name) AND company_id IS NULL"
        ),
        {"name": _NAME},
    ).scalar()

    if exists:
        return

    op.execute(
        text(
            """
            INSERT INTO wm_standard_scope_items
                (id, item_type, name, unit, default_include_in_debris,
                 line_item_id, quantity_calc_type, default_invoice_note,
                 display_order, is_active)
            VALUES
                (:id, 'demolition', :name, 'EA', false,
                 :line_item_id, 'fixed', :note,
                 :display_order, true)
            """
        ).bindparams(
            id=str(uuid.uuid4()),
            name=_NAME,
            line_item_id=line_item_id,
            note="Detach only - reset not included",
            display_order=_DISPLAY_ORDER,
        )
    )


def downgrade() -> None:
    op.execute(
        text(
            "DELETE FROM wm_standard_scope_items "
            "WHERE name = :name AND company_id IS NULL"
        ).bindparams(name=_NAME)
    )
    op.execute(
        text(
            "DELETE FROM line_items "
            "WHERE cat = 'WTR' AND item = :item"
        ).bindparams(item=_ITEM_CODE)
    )
