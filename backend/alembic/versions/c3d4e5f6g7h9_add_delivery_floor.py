"""Add delivery_floor to cabinet_estimates

Revision ID: c3d4e5f6g7h9
Revises: b2c3d4e5f6g8
Create Date: 2026-04-30
"""
from alembic import op
import sqlalchemy as sa

revision = 'c3d4e5f6g7h9'
down_revision = 'b2c3d4e5f6g8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'cabinet_estimates',
        sa.Column(
            'delivery_floor',
            sa.Integer(),
            nullable=True,
            server_default='1',
        ),
    )


def downgrade() -> None:
    op.drop_column('cabinet_estimates', 'delivery_floor')
