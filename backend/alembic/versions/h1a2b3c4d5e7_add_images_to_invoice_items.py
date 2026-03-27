"""Add images JSON column to invoice_items table

Revision ID: h1a2b3c4d5e7
Revises: g1a2b3c4d5e6, 394c0a8e4372
Create Date: 2026-03-13

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'h1a2b3c4d5e7'
down_revision = ('g1a2b3c4d5e6', '394c0a8e4372')
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('invoice_items', sa.Column('images', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('invoice_items', 'images')
