"""Add bag_count to debris calculation

Revision ID: 394c0a8e4372
Revises: a8b9c0d1e2f3
Create Date: 2026-03-04 00:02:58.845971

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '394c0a8e4372'
down_revision = 'a8b9c0d1e2f3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add bag_count column to wm_debris_calculations table
    op.add_column('wm_debris_calculations', sa.Column('bag_count', sa.Integer(), nullable=True, comment='Number of 42-gallon contractor bags needed'))


def downgrade() -> None:
    # Remove bag_count column from wm_debris_calculations table
    op.drop_column('wm_debris_calculations', 'bag_count')
