"""Add storage_web_url column to wm_photos

Revision ID: p8q9r0s1t2u3
Revises: o7p8q9r0s1t2
Create Date: 2026-04-14

Adds:
  - storage_web_url VARCHAR(1000) to wm_photos for CDN web-size URL caching
"""

from alembic import op
import sqlalchemy as sa

revision = 'p8q9r0s1t2u3'
down_revision = 'o7p8q9r0s1t2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'wm_photos',
        sa.Column('storage_web_url', sa.String(1000), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('wm_photos', 'storage_web_url')
