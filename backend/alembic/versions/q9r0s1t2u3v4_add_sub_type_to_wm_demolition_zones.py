"""Add sub_type column to wm_demolition_zones

Revision ID: q9r0s1t2u3v4
Revises: p8q9r0s1t2u3
Create Date: 2026-04-15

Adds:
  - sub_type VARCHAR(100) to wm_demolition_zones for wood floor
    sub-classification (hardwood, engineered, laminate, lvp)
"""

from alembic import op
import sqlalchemy as sa

revision = 'q9r0s1t2u3v4'
down_revision = 'p8q9r0s1t2u3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'wm_demolition_zones',
        sa.Column('sub_type', sa.String(100), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('wm_demolition_zones', 'sub_type')
