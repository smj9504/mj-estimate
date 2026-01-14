"""Add wm_scope_item_categories table and update standard_scope_items

Revision ID: 4cfe38439ba8
Revises: 4ce718cb1bbb
Create Date: 2026-01-15 00:14:52.992238

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = '4cfe38439ba8'
down_revision = '4ce718cb1bbb'
branch_labels = None
depends_on = None


def table_exists(table_name):
    """Check if a table exists in the database"""
    bind = op.get_bind()
    inspector = inspect(bind)
    return table_name in inspector.get_table_names()


def column_exists(table_name, column_name):
    """Check if a column exists in a table"""
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def index_exists(table_name, index_name):
    """Check if an index exists on a table"""
    bind = op.get_bind()
    inspector = inspect(bind)
    indexes = [idx['name'] for idx in inspector.get_indexes(table_name)]
    return index_name in indexes


def upgrade() -> None:
    # Create wm_scope_item_categories table if it doesn't exist
    if not table_exists('wm_scope_item_categories'):
        op.create_table('wm_scope_item_categories',
            sa.Column('id', sa.UUID(), nullable=False, server_default=sa.text('gen_random_uuid()')),
            sa.Column('company_id', sa.UUID(), nullable=True),
            sa.Column('name', sa.String(length=100), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('color', sa.String(length=7), nullable=True, server_default='#1890ff'),
            sa.Column('icon', sa.String(length=50), nullable=True),
            sa.Column('display_order', sa.Integer(), nullable=True, server_default='0'),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('created_by_id', sa.UUID(), nullable=True),
            sa.Column('updated_by_id', sa.UUID(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['created_by_id'], ['staff.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['updated_by_id'], ['staff.id'], ondelete='SET NULL'),
        )

        # Create indexes for wm_scope_item_categories
        op.create_index('ix_wm_scope_item_categories_id', 'wm_scope_item_categories', ['id'], unique=False)
        op.create_index('ix_wm_scope_item_categories_active', 'wm_scope_item_categories', ['is_active'], unique=False)
        op.create_index('ix_wm_scope_item_categories_company', 'wm_scope_item_categories', ['company_id'], unique=False)
        op.create_index('ix_wm_scope_item_categories_order', 'wm_scope_item_categories', ['display_order'], unique=False)

    # Add category_id column to wm_standard_scope_items if it doesn't exist
    if not column_exists('wm_standard_scope_items', 'category_id'):
        op.add_column('wm_standard_scope_items',
            sa.Column('category_id', sa.UUID(), nullable=True)
        )

    # Drop old category column if it exists (after adding category_id)
    if column_exists('wm_standard_scope_items', 'category'):
        # Drop old index first if it exists and points to string 'category'
        if index_exists('wm_standard_scope_items', 'ix_wm_standard_scope_items_category'):
            op.drop_index('ix_wm_standard_scope_items_category', table_name='wm_standard_scope_items')
        op.drop_column('wm_standard_scope_items', 'category')

    # Create new index on category_id if it doesn't exist
    if not index_exists('wm_standard_scope_items', 'ix_wm_standard_scope_items_category'):
        op.create_index('ix_wm_standard_scope_items_category', 'wm_standard_scope_items', ['category_id'], unique=False)

    # Create foreign key for category_id (check if exists by trying to create)
    try:
        op.create_foreign_key(
            'fk_wm_standard_scope_items_category_id',
            'wm_standard_scope_items',
            'wm_scope_item_categories',
            ['category_id'],
            ['id'],
            ondelete='SET NULL'
        )
    except Exception:
        # FK already exists, ignore
        pass


def downgrade() -> None:
    # Drop foreign key constraint
    op.drop_constraint('fk_wm_standard_scope_items_category_id', 'wm_standard_scope_items', type_='foreignkey')

    # Drop index
    op.drop_index('ix_wm_standard_scope_items_category', table_name='wm_standard_scope_items')

    # Drop category_id column
    op.drop_column('wm_standard_scope_items', 'category_id')

    # Re-add category column (string)
    op.add_column('wm_standard_scope_items',
        sa.Column('category', sa.String(length=100), nullable=True)
    )

    # Re-create index on category
    op.create_index('ix_wm_standard_scope_items_category', 'wm_standard_scope_items', ['category'], unique=False)

    # Drop wm_scope_item_categories indexes
    op.drop_index('ix_wm_scope_item_categories_order', table_name='wm_scope_item_categories')
    op.drop_index('ix_wm_scope_item_categories_company', table_name='wm_scope_item_categories')
    op.drop_index('ix_wm_scope_item_categories_active', table_name='wm_scope_item_categories')
    op.drop_index('ix_wm_scope_item_categories_id', table_name='wm_scope_item_categories')

    # Drop wm_scope_item_categories table
    op.drop_table('wm_scope_item_categories')
