"""Add target_total and adjustment_factor to bathroom_estimates

Revision ID: s3t4u5v6w7x8
Revises: r2s3t4u5v6w7
Create Date: 2026-05-12

Adds target_total and adjustment_factor columns for reverse-pricing
(set desired total, line items scale proportionally).
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 's3t4u5v6w7x8'
down_revision = 'r2s3t4u5v6w7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'bathroom_estimates',
        sa.Column('target_total', sa.Float(), nullable=True),
    )
    op.add_column(
        'bathroom_estimates',
        sa.Column('adjustment_factor', sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('bathroom_estimates', 'adjustment_factor')
    op.drop_column('bathroom_estimates', 'target_total')
