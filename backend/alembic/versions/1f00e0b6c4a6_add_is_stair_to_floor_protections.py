"""add is_stair to wm_floor_protections

Revision ID: 1f00e0b6c4a6
Revises: 5a3b0301c0a0
Create Date: 2026-07-27 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '1f00e0b6c4a6'
down_revision = '5a3b0301c0a0'
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
