"""add island seating overhang and countertop support count

An island top overhangs its cabinets for seating (10-15"), and past what
the material can carry unsupported it needs brackets or corbels under it.
The estimate had nowhere to keep the overhang (it was a screen-only
setting) and no way to bill the supports.

Revision ID: cab20261023cs01
Revises: wm20261023vs01
Create Date: 2026-10-23
"""

from alembic import op
import sqlalchemy as sa

revision = "cab20261023cs01"
down_revision = "wm20261023vs01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cabinet_estimates",
        sa.Column("island_seating_overhang_in", sa.Float(), nullable=True),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("countertop_support_count", sa.Integer(),
                  nullable=True, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("cabinet_estimates", "countertop_support_count")
    op.drop_column("cabinet_estimates", "island_seating_overhang_in")
