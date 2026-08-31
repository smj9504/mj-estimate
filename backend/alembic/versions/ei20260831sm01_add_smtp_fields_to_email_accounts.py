"""Add smtp_server/smtp_port to email_accounts

Revision ID: ei20260831sm01
Revises: cab20260831sk01
Create Date: 2026-08-31

Lets a send-only provider (e.g. Resend) be registered as an EmailAccount
without an IMAP endpoint. Null keeps the existing SMTP_PROVIDERS preset
lookup by provider_type; a custom account fills these in directly.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'ei20260831sm01'
down_revision = 'cab20260831sk01'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('email_accounts', sa.Column('smtp_server', sa.String(length=255), nullable=True))
    op.add_column('email_accounts', sa.Column('smtp_port', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('email_accounts', 'smtp_port')
    op.drop_column('email_accounts', 'smtp_server')
