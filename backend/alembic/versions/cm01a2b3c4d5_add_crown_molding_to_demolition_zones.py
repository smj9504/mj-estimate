"""Add include_crown_molding to wm_demolition_zones

Revision ID: cm01a2b3c4d5
Revises: a1b2c3d4e5g8
Create Date: 2026-07-09

Adds boolean include_crown_molding flag for wall demolition zones
where crown molding demo is included along the top of the wall.
"""

from alembic import op
import sqlalchemy as sa


revision = "cm01a2b3c4d5"
down_revision = "a1b2c3d4e5g8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "wm_demolition_zones",
        sa.Column(
            "include_crown_molding",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column(
        "wm_demolition_zones",
        "include_crown_molding",
    )
