"""Add prefab island fields to cabinet_estimates

Revision ID: cab20260713pf01
Revises: wm20260711sp01
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = 'cab20260713pf01'
down_revision = 'wm20260711sp01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'cabinet_estimates',
        sa.Column(
            'island_type', sa.String(20),
            nullable=False, server_default='custom',
        ),
    )
    op.add_column(
        'cabinet_estimates',
        sa.Column(
            'island_prefab_size', sa.String(20),
            nullable=True,
        ),
    )
    op.add_column(
        'cabinet_estimates',
        sa.Column(
            'island_prefab_price', sa.Float(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column('cabinet_estimates', 'island_prefab_price')
    op.drop_column('cabinet_estimates', 'island_prefab_size')
    op.drop_column('cabinet_estimates', 'island_type')
