"""Add line_item_id to wm_scope_items

Revision ID: 51d44a63c7d0
Revises: 5d6e7f8a9b0c
Create Date: 2026-01-15 05:19:09.518852

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '51d44a63c7d0'
down_revision = '5d6e7f8a9b0c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add line_item_id column to wm_scope_items
    op.add_column(
        'wm_scope_items',
        sa.Column(
            'line_item_id',
            sa.UUID(),
            nullable=True,
            comment='Link to LineItem for invoice rate lookup'
        )
    )

    # Create foreign key constraint
    op.create_foreign_key(
        'fk_wm_scope_items_line_item_id',
        'wm_scope_items',
        'line_items',
        ['line_item_id'],
        ['id'],
        ondelete='SET NULL'
    )

    # Create index for better query performance
    op.create_index(
        'ix_wm_scope_items_line_item_id',
        'wm_scope_items',
        ['line_item_id']
    )


def downgrade() -> None:
    # Drop index
    op.drop_index('ix_wm_scope_items_line_item_id', table_name='wm_scope_items')

    # Drop foreign key constraint
    op.drop_constraint('fk_wm_scope_items_line_item_id', 'wm_scope_items', type_='foreignkey')

    # Drop column
    op.drop_column('wm_scope_items', 'line_item_id')
