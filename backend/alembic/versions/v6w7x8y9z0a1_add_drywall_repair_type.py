"""Add drywall_repair_type to cabinet_estimates

Revision ID: v6w7x8y9z0a1
Revises: u5v6w7x8y9z0
Create Date: 2026-05-16
"""
from alembic import op
import sqlalchemy as sa

revision = 'v6w7x8y9z0a1'
down_revision = 'u5v6w7x8y9z0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'cabinet_estimates',
        sa.Column(
            'drywall_repair_type',
            sa.String(20),
            nullable=True,
            server_default='patch',
        ),
    )


def downgrade() -> None:
    op.drop_column(
        'cabinet_estimates',
        'drywall_repair_type',
    )
