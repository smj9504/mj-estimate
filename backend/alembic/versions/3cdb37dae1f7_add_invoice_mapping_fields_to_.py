"""Add invoice mapping fields to WMStandardScopeItem

Revision ID: 3cdb37dae1f7
Revises: 5337888d6feb
Create Date: 2026-01-15 23:53:16.494783

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '3cdb37dae1f7'
down_revision = '5337888d6feb'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add invoice mapping fields to wm_standard_scope_items
    op.add_column('wm_standard_scope_items', sa.Column(
        'line_item_id',
        sa.UUID(),
        nullable=True,
        comment='Mapped line item for invoice generation'
    ))
    op.add_column('wm_standard_scope_items', sa.Column(
        'custom_line_item_name',
        sa.String(length=255),
        nullable=True,
        comment='Custom line item name for invoice (if no line_item_id)'
    ))
    op.add_column('wm_standard_scope_items', sa.Column(
        'custom_line_item_rate',
        sa.DECIMAL(precision=12, scale=4),
        nullable=True,
        comment='Custom rate for invoice (if no line_item_id)'
    ))
    op.add_column('wm_standard_scope_items', sa.Column(
        'quantity_calc_type',
        sa.String(length=30),
        nullable=False,
        server_default='fixed',
        comment='Quantity calculation: fixed, per_day, per_day_capped'
    ))
    op.add_column('wm_standard_scope_items', sa.Column(
        'max_days',
        sa.Integer(),
        nullable=True,
        comment='Maximum days for per_day_capped calculation'
    ))
    op.add_column('wm_standard_scope_items', sa.Column(
        'default_invoice_note',
        sa.Text(),
        nullable=True,
        comment='Default note to include in invoice line item'
    ))

    # Add foreign key constraint
    op.create_foreign_key(
        'fk_wm_standard_scope_items_line_item',
        'wm_standard_scope_items',
        'line_items',
        ['line_item_id'],
        ['id'],
        ondelete='SET NULL'
    )


def downgrade() -> None:
    # Drop foreign key constraint
    op.drop_constraint(
        'fk_wm_standard_scope_items_line_item',
        'wm_standard_scope_items',
        type_='foreignkey'
    )

    # Drop columns
    op.drop_column('wm_standard_scope_items', 'default_invoice_note')
    op.drop_column('wm_standard_scope_items', 'max_days')
    op.drop_column('wm_standard_scope_items', 'quantity_calc_type')
    op.drop_column('wm_standard_scope_items', 'custom_line_item_rate')
    op.drop_column('wm_standard_scope_items', 'custom_line_item_name')
    op.drop_column('wm_standard_scope_items', 'line_item_id')
