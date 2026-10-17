"""add AccuLynx archive tables

Read-only archive of jobs, documents and Communication messages brought over
from AccuLynx before the account was cancelled (app/domains/acculynx_archive).

Revision ID: alx20261017ar01
Revises: wm20261017pdfbg01
Create Date: 2026-10-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'alx20261017ar01'
down_revision = 'wm20261017pdfbg01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Startup's create_all may already have made them
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if 'acculynx_archived_jobs' not in existing:
        op.create_table(
            'acculynx_archived_jobs',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('client_id', UUID(as_uuid=True), sa.ForeignKey('clients.id', ondelete='CASCADE'), nullable=False),
            sa.Column('acculynx_job_id', sa.String(100), nullable=False, unique=True),
            sa.Column('acculynx_contact_id', sa.String(100)),
            sa.Column('job_number', sa.String(50)),
            sa.Column('job_name', sa.String(500)),
            sa.Column('milestone', sa.String(50)),
            sa.Column('trade_types', sa.String(255)),
            sa.Column('work_type', sa.String(100)),
            sa.Column('address', sa.Text()),
            sa.Column('city', sa.String(100)),
            sa.Column('state', sa.String(50)),
            sa.Column('zipcode', sa.String(20)),
            sa.Column('job_created_at', sa.DateTime(timezone=True)),
            sa.Column('milestone_date', sa.DateTime(timezone=True)),
            sa.Column('insurance_company', sa.String(255)),
            sa.Column('claim_number', sa.String(100)),
            sa.Column('date_of_loss', sa.DateTime(timezone=True)),
            sa.Column('damage_location', sa.Text()),
            sa.Column('adjuster_name', sa.String(255)),
            sa.Column('adjuster_phone', sa.String(50)),
            sa.Column('adjuster_email', sa.String(255)),
            sa.Column('approved_job_value', sa.DECIMAL(15, 2)),
            sa.Column('total_received', sa.DECIMAL(15, 2)),
            sa.Column('balance_due', sa.DECIMAL(15, 2)),
            sa.Column('drive_folder_name', sa.String(255)),
            sa.Column('drive_folder_id', sa.String(100)),
            sa.Column('document_count', sa.Integer()),
            sa.Column('message_count', sa.Integer()),
            sa.Column('raw', sa.JSON()),
            sa.Column('import_status', sa.String(20), nullable=False, server_default='importing'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True)),
        )
        op.create_index('ix_acculynx_archived_jobs_client_id', 'acculynx_archived_jobs', ['client_id'])

    if 'acculynx_archived_documents' not in existing:
        op.create_table(
            'acculynx_archived_documents',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('archived_job_id', UUID(as_uuid=True),
                      sa.ForeignKey('acculynx_archived_jobs.id', ondelete='CASCADE'), nullable=False),
            sa.Column('acculynx_file_id', sa.String(100), nullable=False, unique=True),
            sa.Column('folder_name', sa.String(255)),
            sa.Column('name', sa.String(500), nullable=False),
            sa.Column('drive_path', sa.Text()),
            sa.Column('content_type', sa.String(100)),
            sa.Column('size', sa.Integer()),
            sa.Column('uploaded_by', sa.String(255)),
            sa.Column('uploaded_at', sa.DateTime(timezone=True)),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True)),
        )
        op.create_index('ix_acculynx_archived_documents_job_id', 'acculynx_archived_documents', ['archived_job_id'])

    if 'acculynx_archived_messages' not in existing:
        op.create_table(
            'acculynx_archived_messages',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('archived_job_id', UUID(as_uuid=True),
                      sa.ForeignKey('acculynx_archived_jobs.id', ondelete='CASCADE'), nullable=False),
            sa.Column('acculynx_message_id', sa.String(100), nullable=False, unique=True),
            sa.Column('thread_id', sa.String(100), nullable=False),
            sa.Column('message_type', sa.String(30)),
            sa.Column('subject', sa.Text()),
            sa.Column('sender_name', sa.String(255)),
            sa.Column('sender_email', sa.String(255)),
            sa.Column('recipients', sa.JSON()),
            sa.Column('sent_at', sa.DateTime(timezone=True)),
            sa.Column('body_text', sa.Text()),
            sa.Column('attachments', sa.JSON()),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True)),
        )
        op.create_index('ix_acculynx_archived_messages_job_id', 'acculynx_archived_messages', ['archived_job_id'])


def downgrade() -> None:
    op.drop_table('acculynx_archived_messages')
    op.drop_table('acculynx_archived_documents')
    op.drop_table('acculynx_archived_jobs')
