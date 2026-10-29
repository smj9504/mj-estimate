"""packing photos: a claim's photos picked for its packing estimate, by room

packing_photos: each row points at a photo where it already lives - a
water mitigation job photo (source 'wm', wm_photos.id) or a claim photo
(source 'claim', files.id) - and files it under a room. The packing
estimate builder loads these rooms and runs the AI item analysis on them.

Revision ID: pk20261029ph01
Revises: stg20261029cl01
Create Date: 2026-10-29
"""

from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "pk20261029ph01"
down_revision = "stg20261029cl01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Startup's create_all may already have made it.
    if "packing_photos" in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "packing_photos",
        sa.Column("id", UUIDType(), primary_key=True),
        sa.Column("claim_id", UUIDType(), sa.ForeignKey("claims.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("photo_id", sa.String(64), nullable=False),
        sa.Column("room_name", sa.String(100), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by_id", UUIDType(), sa.ForeignKey("staff.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("claim_id", "source", "photo_id", name="uq_packing_photos_claim_photo"),
    )
    op.create_index("ix_packing_photos_id", "packing_photos", ["id"])
    op.create_index("ix_packing_photos_claim", "packing_photos", ["claim_id"])


def downgrade() -> None:
    op.drop_index("ix_packing_photos_claim", table_name="packing_photos")
    op.drop_index("ix_packing_photos_id", table_name="packing_photos")
    op.drop_table("packing_photos")
