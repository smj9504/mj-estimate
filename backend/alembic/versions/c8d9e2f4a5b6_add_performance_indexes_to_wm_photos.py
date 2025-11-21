"""add performance indexes to wm_photos

Revision ID: c8d9e2f4a5b6
Revises: b662310f1380
Create Date: 2025-01-27 12:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'c8d9e2f4a5b6'
down_revision = 'b662310f1380'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add performance indexes to wm_photos table"""
    conn = op.get_bind()
    
    # Helper function to safely create index
    def safe_create_index(index_name, table_name, columns, **kwargs):
        result = conn.execute(sa.text(
            "SELECT EXISTS (SELECT 1 FROM pg_indexes "
            "WHERE indexname = :index_name AND tablename = :table_name)"
        ), {"index_name": index_name, "table_name": table_name})
        if not result.scalar():
            if isinstance(columns, list):
                op.create_index(
                    index_name,
                    table_name,
                    columns,
                    **kwargs
                )
            else:
                op.create_index(
                    index_name,
                    table_name,
                    [columns],
                    **kwargs
                )
    
    # Create composite index for job_id + is_trashed (most common query pattern)
    safe_create_index(
        'ix_wm_photos_job_trashed',
        'wm_photos',
        ['job_id', 'is_trashed']
    )
    
    # Create index for category filtering
    safe_create_index(
        'ix_wm_photos_category',
        'wm_photos',
        'category'
    )
    
    # Create index for captured_date sorting
    safe_create_index(
        'ix_wm_photos_captured_date',
        'wm_photos',
        'captured_date'
    )


def downgrade() -> None:
    """Remove performance indexes from wm_photos table"""
    conn = op.get_bind()
    
    # Helper function to safely drop index
    def safe_drop_index(index_name, table_name):
        result = conn.execute(sa.text(
            "SELECT EXISTS (SELECT 1 FROM pg_indexes "
            "WHERE indexname = :index_name AND tablename = :table_name)"
        ), {"index_name": index_name, "table_name": table_name})
        if result.scalar():
            op.drop_index(index_name, table_name=table_name)
    
    # Drop indexes in reverse order
    safe_drop_index('ix_wm_photos_captured_date', 'wm_photos')
    safe_drop_index('ix_wm_photos_category', 'wm_photos')
    safe_drop_index('ix_wm_photos_job_trashed', 'wm_photos')


