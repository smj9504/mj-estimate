"""Add target_total and adjustment_factor to roofing_estimates

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-05-01

Adds target_total and adjustment_factor columns for reverse-pricing
(set desired total, line items scale proportionally).
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'h8i9j0k1l2m3'
down_revision = 'g7h8i9j0k1l2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'roofing_estimates',
        sa.Column('target_total', sa.Float(), nullable=True),
    )
    op.add_column(
        'roofing_estimates',
        sa.Column('adjustment_factor', sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('roofing_estimates', 'adjustment_factor')
    op.drop_column('roofing_estimates', 'target_total')
