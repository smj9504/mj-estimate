"""Add trim_removal and trim_lf to wm_demolition_zones

Revision ID: w5x6y7z8a9b0
Revises: v4w5x6y7z8a9
Create Date: 2026-04-22

Adds trim partial removal fields:
  - trim_removal VARCHAR(20): full, half, quarter, custom
  - trim_lf DECIMAL(10,2): custom trim length in linear feet
"""

from alembic import op
import sqlalchemy as sa

revision = 'w5x6y7z8a9b0'
down_revision = 'v4w5x6y7z8a9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'wm_demolition_zones',
        sa.Column('trim_removal', sa.String(20), nullable=True)
    )
    op.add_column(
        'wm_demolition_zones',
        sa.Column('trim_lf', sa.Numeric(10, 2), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('wm_demolition_zones', 'trim_lf')
    op.drop_column('wm_demolition_zones', 'trim_removal')
