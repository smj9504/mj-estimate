"""kitchen estimates: quarter round along the base cabinets

Some kitchens finish the floor with quarter round (shoe molding) along the
toe kick. It is an optional scope flag next to include_toe_kick; existing
estimates get false, so nothing about them changes.

Revision ID: ck20261029qr01
Revises: pk20261029ph01
Create Date: 2026-10-29
"""

from alembic import op
import sqlalchemy as sa

revision = "ck20261029qr01"
down_revision = "pk20261029ph01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cabinet_estimates",
        sa.Column(
            "include_quarter_round",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("cabinet_estimates", "include_quarter_round")
