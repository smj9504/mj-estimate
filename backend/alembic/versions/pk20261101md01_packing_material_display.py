"""packing estimates: materials itemized or grouped

A packing estimate listed every material on its own line. It can now show them
as a few grouped lumps instead (boxes, specialty cartons, furniture protection,
wrapping supplies), the same total either way. pack_calculations.material_display
keeps which: 'itemized' or 'grouped'. Existing estimates stay itemized.

Revision ID: pk20261101md01
Revises: pk20261101ct01
Create Date: 2026-11-01
"""

from alembic import op
import sqlalchemy as sa

revision = "pk20261101md01"
down_revision = "pk20261101ct01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("pack_calculations")}
    # Startup's create_all may already have made the table with it.
    if "material_display" in columns:
        return
    op.add_column(
        "pack_calculations",
        sa.Column("material_display", sa.String(20), nullable=False, server_default="itemized"),
    )


def downgrade() -> None:
    op.drop_column("pack_calculations", "material_display")
