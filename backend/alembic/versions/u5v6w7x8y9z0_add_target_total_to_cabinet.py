"""Add target_total and adjustment_factor to cabinet_estimates

Revision ID: u5v6w7x8y9z0
Revises: t4u5v6w7x8y9
Create Date: 2026-05-16
"""
from alembic import op
import sqlalchemy as sa

revision = 'u5v6w7x8y9z0'
down_revision = 't4u5v6w7x8y9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'cabinet_estimates',
        sa.Column('target_total', sa.Float(), nullable=True),
    )
    op.add_column(
        'cabinet_estimates',
        sa.Column('adjustment_factor', sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('cabinet_estimates', 'adjustment_factor')
    op.drop_column('cabinet_estimates', 'target_total')
