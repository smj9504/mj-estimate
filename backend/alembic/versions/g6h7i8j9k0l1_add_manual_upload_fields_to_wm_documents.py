"""Add manual upload fields to wm_documents

Revision ID: g6h7i8j9k0l1
Revises: f5g6h7i8j9k0
Create Date: 2026-05-29

Adds:
  - invoice_amount DECIMAL(10,2) for invoice documents
  - upload_source VARCHAR(50) to distinguish generated vs manual_upload
  - storage_provider VARCHAR(50) for storage provider type
  - storage_file_id VARCHAR(500) for provider-specific file ID
"""

from alembic import op
import sqlalchemy as sa

revision = 'g6h7i8j9k0l1'
down_revision = 'f5g6h7i8j9k0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('wm_documents', sa.Column('invoice_amount', sa.DECIMAL(10, 2), nullable=True))
    op.add_column('wm_documents', sa.Column('upload_source', sa.String(50), server_default='generated', nullable=True))
    op.add_column('wm_documents', sa.Column('storage_provider', sa.String(50), nullable=True))
    op.add_column('wm_documents', sa.Column('storage_file_id', sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column('wm_documents', 'storage_file_id')
    op.drop_column('wm_documents', 'storage_provider')
    op.drop_column('wm_documents', 'upload_source')
    op.drop_column('wm_documents', 'invoice_amount')
