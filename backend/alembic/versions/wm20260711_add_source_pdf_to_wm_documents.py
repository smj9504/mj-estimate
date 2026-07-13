"""Add source_pdf_path and source_storage_file_id to wm_documents

Revision ID: wm20260711sp01
Revises: cm01a2b3c4d5
Create Date: 2026-07-11

Adds:
  - source_pdf_path: path to original unannotated PDF for re-editing
  - source_storage_file_id: storage provider file ID for original PDF
"""

from alembic import op
import sqlalchemy as sa

revision = 'wm20260711sp01'
down_revision = 'cm01a2b3c4d5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('wm_documents', sa.Column('source_pdf_path', sa.String(1000), nullable=True))
    op.add_column('wm_documents', sa.Column('source_storage_file_id', sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column('wm_documents', 'source_storage_file_id')
    op.drop_column('wm_documents', 'source_pdf_path')
