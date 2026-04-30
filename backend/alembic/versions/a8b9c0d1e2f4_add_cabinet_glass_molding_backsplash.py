"""Add cabinet glass doors, crown molding, backsplash, island panels

Revision ID: a8b9c0d1e2f4
Revises: cs02b3c4d5e6
Create Date: 2026-04-29

Adds:
  - cabinet_boxes.has_glass_door
  - cabinet_estimates: include_crown_molding, include_backsplash,
    backsplash_type, backsplash_sqft, island_end_panels, island_back_panels
"""

from alembic import op
import sqlalchemy as sa

revision = "a8b9c0d1e2f4"
down_revision = "cs02b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Cabinet boxes: glass door flag
    op.add_column(
        "cabinet_boxes",
        sa.Column(
            "has_glass_door",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
    )

    # Cabinet estimates: crown molding
    op.add_column(
        "cabinet_estimates",
        sa.Column(
            "include_crown_molding",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
    )

    # Cabinet estimates: backsplash
    op.add_column(
        "cabinet_estimates",
        sa.Column(
            "include_backsplash",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column(
            "backsplash_type",
            sa.String(50),
            nullable=True,
        ),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column(
            "backsplash_sqft",
            sa.Float(),
            nullable=True,
        ),
    )

    # Cabinet estimates: island panels (SF)
    op.add_column(
        "cabinet_estimates",
        sa.Column(
            "island_end_panel_sqft",
            sa.Float(),
            nullable=True,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column(
            "island_back_panel_sqft",
            sa.Float(),
            nullable=True,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("cabinet_estimates", "island_back_panel_sqft")
    op.drop_column("cabinet_estimates", "island_end_panel_sqft")
    op.drop_column("cabinet_estimates", "backsplash_sqft")
    op.drop_column("cabinet_estimates", "backsplash_type")
    op.drop_column("cabinet_estimates", "include_backsplash")
    op.drop_column("cabinet_estimates", "include_crown_molding")
    op.drop_column("cabinet_boxes", "has_glass_door")
