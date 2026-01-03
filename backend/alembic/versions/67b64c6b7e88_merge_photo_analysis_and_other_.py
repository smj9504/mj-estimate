"""Merge photo_analysis and other migrations

Revision ID: 67b64c6b7e88
Revises: add_photo_analysis_cache, f1a2b3c4d5e6
Create Date: 2025-12-11 17:40:07.103188

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '67b64c6b7e88'
down_revision = ('add_photo_analysis_cache', 'f1a2b3c4d5e6')
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
