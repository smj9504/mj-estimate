"""add cabinet overlay style and trim/panel scope fields

The 2026-09-18 pricing review found that fillers, finished end panels,
dishwasher return panels and light rail molding appear on essentially
every real kitchen but had no way to be billed — the estimator had no
field for them at all, so they were either dropped or hand-added later.

overlay_style is the other half of the door-pricing axis: inset doors sit
flush inside the face frame and run +15-25% over full overlay, which the
estimate could not express since only door_style existed.

end_panel_counts is JSON rather than four integer columns because the
panel types are a pricing-table concern (END_PANEL_PRICING) and adding a
fifth type should not need a migration.

Revision ID: cab20260918tp01
Revises: b9c0d1e2f3g4
Create Date: 2026-09-18
"""

from alembic import op
import sqlalchemy as sa

revision = "cab20260918tp01"
down_revision = "b9c0d1e2f3g4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cabinet_estimates",
        sa.Column("overlay_style", sa.String(50), nullable=True),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("filler_count", sa.Integer(),
                  nullable=True, server_default=sa.text("0")),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("end_panel_counts", sa.JSON(), nullable=True),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("dishwasher_return_panel_count", sa.Integer(),
                  nullable=True, server_default=sa.text("0")),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("include_light_rail", sa.Boolean(),
                  nullable=True, server_default=sa.text("false")),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("light_rail_lf", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cabinet_estimates", "light_rail_lf")
    op.drop_column("cabinet_estimates", "include_light_rail")
    op.drop_column("cabinet_estimates", "dishwasher_return_panel_count")
    op.drop_column("cabinet_estimates", "end_panel_counts")
    op.drop_column("cabinet_estimates", "filler_count")
    op.drop_column("cabinet_estimates", "overlay_style")
