"""Add AccuLynx integration tables (acculynx_job_links, acculynx_uploads)

Self-contained AccuLynx module - see
backend/app/domains/integrations/acculynx/__init__.py for the removal
checklist. Only these two new tables are created; no existing table is
altered.

Revision ID: al20260811
Revises: ei20260803
Create Date: 2026-08-11

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = 'al20260811'
down_revision = 'ei20260803'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'acculynx_job_links',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('claim_id', UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column('acculynx_job_id', sa.String(100), nullable=False),
        sa.Column('acculynx_job_number', sa.String(50), nullable=True),
        sa.Column('linked_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_acculynx_job_links_claim_id', 'acculynx_job_links', ['claim_id'])

    op.create_table(
        'acculynx_uploads',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('claim_id', UUID(as_uuid=True), nullable=False),
        sa.Column('acculynx_job_id', sa.String(100), nullable=False),
        sa.Column('source_table', sa.String(20), nullable=False),
        sa.Column('source_id', UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column('filename', sa.String(500), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_acculynx_uploads_claim', 'acculynx_uploads', ['claim_id'])
    op.create_index('ix_acculynx_uploads_source_id', 'acculynx_uploads', ['source_id'])


def downgrade() -> None:
    op.drop_index('ix_acculynx_uploads_source_id', table_name='acculynx_uploads')
    op.drop_index('ix_acculynx_uploads_claim', table_name='acculynx_uploads')
    op.drop_table('acculynx_uploads')

    op.drop_index('ix_acculynx_job_links_claim_id', table_name='acculynx_job_links')
    op.drop_table('acculynx_job_links')
