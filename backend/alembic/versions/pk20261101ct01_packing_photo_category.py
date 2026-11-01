"""packing photos: a category above the room

A claim's packing photos were filed by room only. Now each is filed under a
category first - the stage of the job it is for, 'water_mitigation' or
'work_completion' - then a room within it, and the packing estimate is made
for one category's rooms.

Existing photos take the category of the photo set they were picked from: a
water mitigation job photo ('wm') goes under water_mitigation, a claim photo
('claim', the claim's Completion photos) under work_completion.

Revision ID: pk20261101ct01
Revises: os20261031ta01
Create Date: 2026-11-01
"""

from alembic import op
import sqlalchemy as sa

revision = "pk20261101ct01"
down_revision = "os20261031ta01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("packing_photos")}
    # Startup's create_all may already have made the table with it.
    if "category" in columns:
        return
    op.add_column(
        "packing_photos",
        sa.Column("category", sa.String(30), nullable=False, server_default="water_mitigation"),
    )
    op.execute("UPDATE packing_photos SET category = 'work_completion' WHERE source = 'claim'")


def downgrade() -> None:
    op.drop_column("packing_photos", "category")
