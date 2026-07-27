"""add is_stair to wm_floor_protections

Revision ID: a1b2c3d4e5f6
Revises:
Create Date: 2024-01-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use raw SQL to add column with default - safe for existing data
    op.execute(
        "ALTER TABLE wm_floor_protections ADD COLUMN IF NOT EXISTS "
        "is_stair BOOLEAN NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.drop_column('wm_floor_protections', 'is_stair')
