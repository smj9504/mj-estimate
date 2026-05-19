"""Add wm_estimate_file fields to claims

Revision ID: w7x8y9z0a1b2
Revises: v6w7x8y9z0a1
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa

revision = 'w7x8y9z0a1b2'
down_revision = 'v6w7x8y9z0a1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('claims', sa.Column('wm_estimate_file_id', sa.String(255), nullable=True,
                                      comment='Stored WM estimate PDF file ID'))
    op.add_column('claims', sa.Column('wm_estimate_file_name', sa.String(500), nullable=True))


def downgrade():
    op.drop_column('claims', 'wm_estimate_file_name')
    op.drop_column('claims', 'wm_estimate_file_id')
