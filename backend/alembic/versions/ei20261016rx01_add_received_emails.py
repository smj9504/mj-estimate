"""add received_emails

Polling only recorded PDF attachments (email_ingestion_logs), so inbound
mail without a file - most adjuster replies - never reached the app. This
table keeps one row per inbound message, matched to a claim where possible.

Revision ID: ei20261016rx01
Revises: clm20261016dd01
Create Date: 2026-10-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'ei20261016rx01'
down_revision = 'clm20261016dd01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    # The app's startup create_all may already have made it.
    if 'received_emails' in inspector.get_table_names():
        return

    op.create_table(
        'received_emails',
        sa.Column('id', sa.UUID(), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column(
            'email_account_id', sa.UUID(),
            sa.ForeignKey('email_accounts.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('message_id', sa.String(500), nullable=False),
        sa.Column('in_reply_to', sa.String(500), nullable=True),
        sa.Column('subject', sa.Text(), nullable=True),
        sa.Column('sender', sa.String(500), nullable=True),
        sa.Column('to_addresses', sa.Text(), nullable=True, comment='Raw To header'),
        sa.Column('cc_addresses', sa.Text(), nullable=True, comment='Raw Cc header'),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('snippet', sa.String(300), nullable=True),
        sa.Column('body_text', sa.Text(), nullable=True),
        sa.Column('body_html', sa.Text(), nullable=True),
        sa.Column(
            'attachment_names', postgresql.JSONB(), nullable=True,
            comment='Filenames only; PDFs go through EmailIngestionLog',
        ),
        sa.Column(
            'matched_client_id', sa.UUID(),
            sa.ForeignKey('clients.id', ondelete='SET NULL'), nullable=True,
        ),
        sa.Column(
            'matched_claim_id', sa.UUID(),
            sa.ForeignKey('claims.id', ondelete='SET NULL'), nullable=True,
        ),
        sa.Column('match_method', sa.String(100), nullable=True),
        sa.Column('match_confidence', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_received_emails_id', 'received_emails', ['id'])
    op.create_index(
        'ix_received_emails_account_msgid', 'received_emails',
        ['email_account_id', 'message_id'], unique=True,
    )
    op.create_index('ix_received_emails_claim_id', 'received_emails', ['matched_claim_id'])
    op.create_index('ix_received_emails_received_at', 'received_emails', ['received_at'])


def downgrade() -> None:
    op.drop_table('received_emails')
