"""Add wm_standard_scope_items table

Revision ID: 4ce718cb1bbb
Revises: 04aed2dc1ce9
Create Date: 2026-01-14 23:48:14.632407

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '4ce718cb1bbb'
down_revision = '04aed2dc1ce9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create wm_standard_scope_items table
    op.create_table(
        'wm_standard_scope_items',
        sa.Column('id', sa.UUID(), nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('company_id', sa.UUID(), nullable=True),
        sa.Column('item_type', sa.String(length=50), nullable=False, server_default='standard'),
        sa.Column('category', sa.String(length=100), nullable=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('unit', sa.String(length=20), nullable=False, server_default='SF'),
        sa.Column('default_quantity', sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column('material_weight_id', sa.UUID(), nullable=True),
        sa.Column('default_include_in_debris', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_by_id', sa.UUID(), nullable=True),
        sa.Column('updated_by_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['material_weight_id'], ['material_weights.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by_id'], ['staff.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['updated_by_id'], ['staff.id'], ondelete='SET NULL'),
    )

    # Create indexes
    op.create_index(
        'ix_wm_standard_scope_items_id',
        'wm_standard_scope_items',
        ['id'],
        unique=False
    )
    op.create_index(
        'ix_wm_standard_scope_items_company',
        'wm_standard_scope_items',
        ['company_id'],
        unique=False
    )
    op.create_index(
        'ix_wm_standard_scope_items_type',
        'wm_standard_scope_items',
        ['item_type'],
        unique=False
    )
    op.create_index(
        'ix_wm_standard_scope_items_active',
        'wm_standard_scope_items',
        ['is_active'],
        unique=False
    )
    op.create_index(
        'ix_wm_standard_scope_items_category',
        'wm_standard_scope_items',
        ['category'],
        unique=False
    )


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_wm_standard_scope_items_category', table_name='wm_standard_scope_items')
    op.drop_index('ix_wm_standard_scope_items_active', table_name='wm_standard_scope_items')
    op.drop_index('ix_wm_standard_scope_items_type', table_name='wm_standard_scope_items')
    op.drop_index('ix_wm_standard_scope_items_company', table_name='wm_standard_scope_items')
    op.drop_index('ix_wm_standard_scope_items_id', table_name='wm_standard_scope_items')

    # Drop table
    op.drop_table('wm_standard_scope_items')
