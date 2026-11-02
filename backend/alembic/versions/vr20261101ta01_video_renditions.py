"""video_renditions: posters and browser-playable copies of stored videos

Jobs and claims can now hold videos, imported from CompanyCam and MagicPlan or
uploaded by hand. A video needs a poster, and an iPhone's HEVC needs an H.264 copy
because plenty of browsers can't decode it. Both are made in the background after
the video is stored, and this keeps where they are and how that went. Videos
stored before this have no row until someone looks at them, which creates one.

Revision ID: vr20261101ta01
Revises: pk20261101md01
Create Date: 2026-11-01
"""

from alembic import op
import sqlalchemy as sa

revision = "vr20261101ta01"
down_revision = "pk20261101md01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Startup's create_all may already have made the table
    if "video_renditions" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "video_renditions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("owner_type", sa.String(20), nullable=False),
        sa.Column("owner_id", sa.String(36), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text()),
        sa.Column("storage_provider", sa.String(50)),
        sa.Column("poster_file_id", sa.Text()),
        sa.Column("playback_file_id", sa.Text()),
        sa.Column("playback_size", sa.BigInteger()),
        sa.Column("codec", sa.String(30)),
        sa.Column("width", sa.Integer()),
        sa.Column("height", sa.Integer()),
        sa.Column("duration_seconds", sa.Float()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("owner_type", "owner_id", name="uq_video_renditions_owner"),
    )


def downgrade() -> None:
    op.drop_table("video_renditions")
