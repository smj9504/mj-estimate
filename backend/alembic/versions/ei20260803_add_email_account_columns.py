"""Add missing columns to email_accounts (sender, oauth, can_send)

Revision ID: ei20260803
Revises: 1f00e0b6c4a6
Create Date: 2026-08-03

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'ei20260803'
down_revision = '1f00e0b6c4a6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing = {c['name'] for c in inspector.get_columns('email_accounts')}

    columns = [
        ('sender_name', sa.Column('sender_name', sa.String(255), nullable=True, comment='Sender full name for signature')),
        ('sender_phone', sa.Column('sender_phone', sa.String(50), nullable=True, comment='Sender phone for signature')),
        ('auth_method', sa.Column('auth_method', sa.String(20), nullable=False, server_default='password', comment='password | oauth')),
        ('oauth_access_token', sa.Column('oauth_access_token', sa.Text(), nullable=True, comment='Encrypted OAuth access token')),
        ('oauth_refresh_token', sa.Column('oauth_refresh_token', sa.Text(), nullable=True, comment='Encrypted OAuth refresh token')),
        ('oauth_token_expiry', sa.Column('oauth_token_expiry', sa.DateTime(timezone=True), nullable=True)),
        ('can_send', sa.Column('can_send', sa.Boolean(), nullable=False, server_default='true', comment='Show in From selector for outbound emails')),
    ]

    for name, col in columns:
        if name not in existing:
            op.add_column('email_accounts', col)


def downgrade() -> None:
    op.drop_column('email_accounts', 'can_send')
    op.drop_column('email_accounts', 'oauth_token_expiry')
    op.drop_column('email_accounts', 'oauth_refresh_token')
    op.drop_column('email_accounts', 'oauth_access_token')
    op.drop_column('email_accounts', 'auth_method')
    op.drop_column('email_accounts', 'sender_phone')
    op.drop_column('email_accounts', 'sender_name')
