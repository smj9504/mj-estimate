"""kitchen estimates: an island with cabinets on both sides

An island can have cabinets on both long sides, standing back to back. Its
backs then face each other (no back panel), its ends are twice as deep and
neither long side is free for seating. The Edit tab had a screen-only
checkbox for it that changed nothing but a hint; now it is kept with the
estimate, so the price and the Sketch can follow it. Existing estimates get
false, so nothing about them changes.

Revision ID: ck20261106ts01
Revises: fv20261106co01
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa

revision = "ck20261106ts01"
down_revision = "fv20261106co01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cabinet_estimates",
        sa.Column(
            "island_two_sided",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("cabinet_estimates", "island_two_sided")
