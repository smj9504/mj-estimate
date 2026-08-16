"""Add sections_data JSON column to invoices table

Revision ID: ls01a2b3c4d5
Revises: wm20260816td01
Create Date: 2026-08-16

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'ls01a2b3c4d5'
down_revision = 'wm20260816td01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('invoices', sa.Column('sections_data', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('invoices', 'sections_data')
