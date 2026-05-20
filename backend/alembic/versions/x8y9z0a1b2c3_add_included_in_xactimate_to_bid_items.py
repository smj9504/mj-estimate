"""Add included_in_xactimate to bid_item_estimates

Revision ID: x8y9z0a1b2c3
Revises: w7x8y9z0a1b2
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa

revision = 'x8y9z0a1b2c3'
down_revision = 'w7x8y9z0a1b2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'bid_item_estimates',
        sa.Column(
            'included_in_xactimate',
            sa.Boolean(),
            nullable=False,
            server_default='false',
            comment=(
                "If true, this item amount is already included "
                "in Xactimate and excluded from supplement total"
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column('bid_item_estimates', 'included_in_xactimate')
