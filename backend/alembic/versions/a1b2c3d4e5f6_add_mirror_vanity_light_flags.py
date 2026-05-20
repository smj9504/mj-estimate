"""Add replace_mirror, replace_vanity_light, detach_reset_vanity_light to bathroom_estimates

Revision ID: a1b2c3d4e5f6
Revises: x8y9z0a1b2c3
Create Date: 2026-05-21
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = 'x8y9z0a1b2c3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'bathroom_estimates',
        sa.Column('replace_mirror', sa.Boolean(), nullable=True, server_default='false'),
    )
    op.add_column(
        'bathroom_estimates',
        sa.Column('replace_vanity_light', sa.Boolean(), nullable=True, server_default='false'),
    )
    op.add_column(
        'bathroom_estimates',
        sa.Column('detach_reset_vanity_light', sa.Boolean(), nullable=True, server_default='false'),
    )


def downgrade() -> None:
    op.drop_column('bathroom_estimates', 'detach_reset_vanity_light')
    op.drop_column('bathroom_estimates', 'replace_vanity_light')
    op.drop_column('bathroom_estimates', 'replace_mirror')
