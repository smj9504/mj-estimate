"""Add Google OAuth fields to Staff model

Revision ID: d5d3e463f2e
Revises: c4c2b352fe1d
Create Date: 2026-01-08 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd5d3e463f2e'
down_revision = 'c4c2b352fe1d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add Google OAuth 2.0 fields to staff table
    op.add_column('staff', sa.Column('gdrive_oauth_access_token', sa.Text(), nullable=True))
    op.add_column('staff', sa.Column('gdrive_oauth_refresh_token', sa.Text(), nullable=True))
    op.add_column('staff', sa.Column('gdrive_oauth_token_expiry', sa.DateTime(), nullable=True))
    op.add_column('staff', sa.Column('gdrive_oauth_email', sa.String(length=255), nullable=True))


def downgrade() -> None:
    # Remove Google OAuth 2.0 fields from staff table
    op.drop_column('staff', 'gdrive_oauth_email')
    op.drop_column('staff', 'gdrive_oauth_token_expiry')
    op.drop_column('staff', 'gdrive_oauth_refresh_token')
    op.drop_column('staff', 'gdrive_oauth_access_token')
