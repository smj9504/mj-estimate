"""Add countertop backsplash fields to cabinet_estimates

Revision ID: cab20260713cb01
Revises: cab20260713pf01
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = 'cab20260713cb01'
down_revision = 'cab20260713pf01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'cabinet_estimates',
        sa.Column(
            'include_countertop_backsplash',
            sa.Boolean(),
            nullable=False,
            server_default='false',
        ),
    )
    op.add_column(
        'cabinet_estimates',
        sa.Column(
            'countertop_backsplash_lf',
            sa.Float(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column(
        'cabinet_estimates', 'countertop_backsplash_lf',
    )
    op.drop_column(
        'cabinet_estimates',
        'include_countertop_backsplash',
    )
