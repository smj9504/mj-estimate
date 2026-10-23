"""bill debris disposal fee in CY instead of bag count

The Debris disposal fee line item is priced per CY, but its auto-calculated
quantity was the 42-gallon bag count, so 11 bags billed as 11 CY. Configs
still holding that untouched bag count are converted to CY (0.208 CY per bag,
rounded up to 0.5 CY). Already generated invoices are left alone.

Revision ID: wm20261023cy01
Revises: ei20261023wmj01
Create Date: 2026-10-23
"""
from decimal import ROUND_CEILING, Decimal

from alembic import op
import sqlalchemy as sa

revision = 'wm20261023cy01'
down_revision = 'ei20261023wmj01'
branch_labels = None
depends_on = None

BAG_VOLUME_CY = Decimal("0.208")
CY_INCREMENT = Decimal("0.5")


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT c.id, d.bag_count, d.total_weight_ton "
        "FROM wm_invoice_item_configs c "
        "JOIN wm_debris_calculations d ON d.job_id = c.job_id "
        "LEFT JOIN line_items li ON li.id = c.line_item_id "
        "WHERE c.scope_item_id IS NULL "
        "AND c.quantity_calc_type = 'auto_calculated' "
        "AND LOWER(COALESCE(li.description, c.custom_name, '')) LIKE '%disposal fee%' "
        "AND d.bag_count > 0 "
        "AND c.calculated_quantity = d.bag_count"
    )).fetchall()

    for config_id, bag_count, total_weight_ton in rows:
        volume_cy = bag_count * BAG_VOLUME_CY
        billed_cy = (
            (volume_cy / CY_INCREMENT).to_integral_value(rounding=ROUND_CEILING)
            * CY_INCREMENT
        )
        note_lines = [
            f"42-gallon contractor bags: {bag_count} bags × {BAG_VOLUME_CY} CY = {volume_cy:.2f} CY",
            f"Billed at {billed_cy} CY (rounded up to the nearest {CY_INCREMENT} CY)",
        ]
        if total_weight_ton and total_weight_ton > 0:
            note_lines.append(
                f"Total debris: {float(total_weight_ton):.2f} tons"
                f" (~{bag_count} bags @ 85 lbs/bag capacity)"
            )
        bind.execute(
            sa.text(
                "UPDATE wm_invoice_item_configs "
                "SET calculated_quantity = :quantity, default_note = :note "
                "WHERE id = :id"
            ),
            {"quantity": billed_cy, "note": "\n".join(note_lines), "id": config_id},
        )


def downgrade() -> None:
    # Data-only conversion; the bag count is still on wm_debris_calculations
    pass
