"""Add sections_data JSON column to estimates table

Revision ID: g1a2b3c4d5e6
Revises: f1a2b3c4d5e6
Create Date: 2026-03-07

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'g1a2b3c4d5e6'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('estimates', sa.Column('sections_data', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('estimates', 'sections_data')
