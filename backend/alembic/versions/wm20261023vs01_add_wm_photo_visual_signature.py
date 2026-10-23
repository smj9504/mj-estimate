"""add wm photo visual signature

Photos are fingerprinted (dHash + 4x4 color layout) so the gallery can sort
similar-looking photos next to each other within a category, which makes
duplicate cleanup easier. NULL means not computed yet.

Revision ID: wm20261023vs01
Revises: cab20261023aj01
Create Date: 2026-10-23
"""

from alembic import op
import sqlalchemy as sa

revision = "wm20261023vs01"
down_revision = "cab20261023aj01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "wm_photos",
        sa.Column("visual_signature", sa.String(112), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("wm_photos", "visual_signature")
