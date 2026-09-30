"""store WM sketch background images in the DB

Revision ID: wm20260930bgimg01
Revises: mrg20260919hd01
Create Date: 2026-09-30 00:00:00.000000

Background images for water mitigation floor sketches are stored on the
row itself instead of Google Drive. Existing rows keep their legacy
storage_provider/storage_file_id and are still served from there.
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'wm20260930bgimg01'
down_revision = 'mrg20260919hd01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE wm_floor_sketches ADD COLUMN IF NOT EXISTS "
        "background_image_data BYTEA"
    )
    op.execute(
        "ALTER TABLE wm_floor_sketches ADD COLUMN IF NOT EXISTS "
        "background_image_content_type VARCHAR(100)"
    )


def downgrade() -> None:
    op.drop_column('wm_floor_sketches', 'background_image_content_type')
    op.drop_column('wm_floor_sketches', 'background_image_data')
