"""Add island countertop fields

Revision ID: b2c3d4e5f6g8
Revises: a1b2c3d4e5f7
Create Date: 2026-04-30
"""
from alembic import op
import sqlalchemy as sa

revision = 'b2c3d4e5f6g8'
down_revision = 'a1b2c3d4e5f7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'cabinet_estimates',
        sa.Column(
            'island_countertop_material',
            sa.String(100),
            nullable=True,
        ),
    )
    op.add_column(
        'cabinet_estimates',
        sa.Column(
            'island_countertop_sqft',
            sa.Float(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column(
        'cabinet_estimates',
        'island_countertop_sqft',
    )
    op.drop_column(
        'cabinet_estimates',
        'island_countertop_material',
    )
