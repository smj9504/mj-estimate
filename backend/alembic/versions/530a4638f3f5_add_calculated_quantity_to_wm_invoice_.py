"""Add calculated_quantity to wm_invoice_item_configs

Revision ID: 530a4638f3f5
Revises: 3cdb37dae1f7
Create Date: 2026-01-16 03:19:31.694312

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '530a4638f3f5'
down_revision = '3cdb37dae1f7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add calculated_quantity column for auto-calculated items (e.g., General Conditions)
    op.add_column(
        'wm_invoice_item_configs',
        sa.Column(
            'calculated_quantity',
            sa.DECIMAL(precision=12, scale=4),
            nullable=True,
            comment='Pre-calculated quantity for auto-calculated items (e.g., debris hrs, equipment monitoring hrs)'
        )
    )


def downgrade() -> None:
    op.drop_column('wm_invoice_item_configs', 'calculated_quantity')
