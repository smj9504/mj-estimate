"""Add cached labor hours to pack_items

Revision ID: a8b9c0d1e2f3
Revises: 530a4638f3f5, 2b768537a75c
Create Date: 2026-02-12 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a8b9c0d1e2f3'
down_revision = ('530a4638f3f5', '2b768537a75c')  # Merge two heads
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add cached_packing_hours and cached_moving_hours columns to pack_items table."""
    # Add cached labor hours columns for performance optimization
    # These store pre-calculated labor hours to avoid recalculation on every view
    op.add_column('pack_items', sa.Column('cached_packing_hours', sa.Float(), nullable=True))
    op.add_column('pack_items', sa.Column('cached_moving_hours', sa.Float(), nullable=True))


def downgrade() -> None:
    """Remove cached labor hours columns from pack_items table."""
    op.drop_column('pack_items', 'cached_moving_hours')
    op.drop_column('pack_items', 'cached_packing_hours')
