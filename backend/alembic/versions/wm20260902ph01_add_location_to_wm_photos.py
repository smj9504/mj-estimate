"""Add location_level and location_room columns to wm_photos

Revision ID: wm20260902ph01
Revises: adm20260831ss01
Create Date: 2026-09-02

Adds:
  - location_level VARCHAR(100) to wm_photos - floor/level tag (e.g. "Basement", "1st Floor")
  - location_room VARCHAR(100) to wm_photos - room name tag (e.g. "Kitchen", "Master Bedroom")
  - index on location_level for filtering
"""

from alembic import op
import sqlalchemy as sa

revision = 'wm20260902ph01'
down_revision = 'adm20260831ss01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'wm_photos',
        sa.Column('location_level', sa.String(100), nullable=True)
    )
    op.add_column(
        'wm_photos',
        sa.Column('location_room', sa.String(100), nullable=True)
    )
    op.create_index(
        'ix_wm_photos_location_level', 'wm_photos', ['location_level']
    )


def downgrade() -> None:
    op.drop_index('ix_wm_photos_location_level', table_name='wm_photos')
    op.drop_column('wm_photos', 'location_room')
    op.drop_column('wm_photos', 'location_level')
