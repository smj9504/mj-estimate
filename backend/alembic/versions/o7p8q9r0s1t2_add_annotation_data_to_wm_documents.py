"""Add annotation_data column to wm_documents

Revision ID: o7p8q9r0s1t2
Revises: n6o7p8q9r0s1
Create Date: 2026-04-13

Adds:
  - annotation_data TEXT to wm_documents for PDF annotation re-editing
"""

from alembic import op
import sqlalchemy as sa

revision = 'o7p8q9r0s1t2'
down_revision = 'n6o7p8q9r0s1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('wm_documents', sa.Column('annotation_data', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('wm_documents', 'annotation_data')
