"""Add Google Drive settings to Staff model

Revision ID: c4c2b352fe1d
Revises: c3d4e5f6a7b8
Create Date: 2026-01-08 01:59:17.709421

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c4c2b352fe1d'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add Google Drive settings columns to staff table
    op.add_column('staff', sa.Column('gdrive_service_account_json', sa.Text(), nullable=True))
    op.add_column('staff', sa.Column('gdrive_root_folder_id', sa.String(length=255), nullable=True))
    op.add_column('staff', sa.Column('gdrive_enabled', sa.Boolean(), nullable=True, server_default='false'))


def downgrade() -> None:
    # Remove Google Drive settings columns from staff table
    op.drop_column('staff', 'gdrive_enabled')
    op.drop_column('staff', 'gdrive_root_folder_id')
    op.drop_column('staff', 'gdrive_service_account_json')
