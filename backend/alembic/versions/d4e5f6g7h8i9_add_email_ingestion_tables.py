"""Add email ingestion tables and normalized_address to clients

Revision ID: d4e5f6g7h8i9
Revises: c3d4e5f6g7h9
Create Date: 2026-04-30

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'd4e5f6g7h8i9'
down_revision = 'c3d4e5f6g7h9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add normalized_address to clients
    op.add_column('clients', sa.Column('normalized_address', sa.String(500), nullable=True))
    op.create_index('ix_clients_normalized_address', 'clients', ['normalized_address'])

    # Create email_accounts table
    op.create_table(
        'email_accounts',
        sa.Column('id', sa.UUID(), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('company_id', sa.UUID(), sa.ForeignKey('companies.id'), nullable=True),
        sa.Column('display_name', sa.String(255), nullable=False),
        sa.Column('email_address', sa.String(255), nullable=False, unique=True),
        sa.Column('provider_type', sa.String(50), nullable=False, server_default='gmail'),
        sa.Column('imap_server', sa.String(255), nullable=False, server_default='imap.gmail.com'),
        sa.Column('imap_port', sa.Integer(), nullable=False, server_default='993'),
        sa.Column('use_ssl', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('username', sa.String(255), nullable=False),
        sa.Column('encrypted_password', sa.Text(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('auto_schedule', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_index('ix_email_accounts_company_id', 'email_accounts', ['company_id'])

    # Create email_ingestion_logs table
    op.create_table(
        'email_ingestion_logs',
        sa.Column('id', sa.UUID(), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('email_account_id', sa.UUID(), sa.ForeignKey('email_accounts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('message_id', sa.String(500), nullable=False, unique=True),
        sa.Column('subject', sa.Text(), nullable=True),
        sa.Column('sender', sa.String(500), nullable=True),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('attachment_name', sa.String(500), nullable=True),
        sa.Column('attachment_hash', sa.String(64), nullable=True),
        sa.Column('status', sa.String(50), nullable=False, server_default='pending'),
        sa.Column('is_insurance_estimate', sa.Boolean(), nullable=True),
        sa.Column('classification_reason', sa.Text(), nullable=True),
        sa.Column('matched_client_id', sa.UUID(), sa.ForeignKey('clients.id', ondelete='SET NULL'), nullable=True),
        sa.Column('matched_claim_id', sa.UUID(), sa.ForeignKey('claims.id', ondelete='SET NULL'), nullable=True),
        sa.Column('match_method', sa.String(100), nullable=True),
        sa.Column('match_confidence', sa.Integer(), nullable=True),
        sa.Column('claim_created', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('negotiation_id', sa.UUID(), nullable=True),
        sa.Column('file_id', sa.String(255), nullable=True),
        sa.Column('skip_reason', sa.Text(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('reviewed_by', sa.String(255), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_index('ix_email_ingestion_logs_account_id', 'email_ingestion_logs', ['email_account_id'])
    op.create_index('ix_email_ingestion_logs_status', 'email_ingestion_logs', ['status'])
    op.create_index('ix_email_ingestion_logs_message_id', 'email_ingestion_logs', ['message_id'], unique=True)
    op.create_index('ix_email_ingestion_logs_attachment_hash', 'email_ingestion_logs', ['attachment_hash'])


def downgrade() -> None:
    op.drop_table('email_ingestion_logs')
    op.drop_table('email_accounts')
    op.drop_index('ix_clients_normalized_address', table_name='clients')
    op.drop_column('clients', 'normalized_address')
