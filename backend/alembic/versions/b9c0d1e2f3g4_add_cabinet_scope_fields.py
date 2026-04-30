"""Add cabinet scope fields: toe kick, countertop, drywall, paint, appliance, dumpster, overview

Revision ID: b9c0d1e2f3g4
Revises: a8b9c0d1e2f4
Create Date: 2026-04-30
"""

from alembic import op
import sqlalchemy as sa

revision = "b9c0d1e2f3g4"
down_revision = "a8b9c0d1e2f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cabinet_estimates",
        sa.Column("include_toe_kick", sa.Boolean(),
                  nullable=True, server_default=sa.text("true")),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("include_countertop", sa.Boolean(),
                  nullable=True, server_default=sa.text("false")),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("include_drywall_repair", sa.Boolean(),
                  nullable=True, server_default=sa.text("false")),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("drywall_repair_sqft", sa.Float(), nullable=True),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("include_painting", sa.Boolean(),
                  nullable=True, server_default=sa.text("false")),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("painting_sqft", sa.Float(), nullable=True),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("include_appliance_rr", sa.Boolean(),
                  nullable=True, server_default=sa.text("false")),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("include_dumpster", sa.Boolean(),
                  nullable=True, server_default=sa.text("true")),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("overview_text", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cabinet_estimates", "overview_text")
    op.drop_column("cabinet_estimates", "include_dumpster")
    op.drop_column("cabinet_estimates", "include_appliance_rr")
    op.drop_column("cabinet_estimates", "painting_sqft")
    op.drop_column("cabinet_estimates", "include_painting")
    op.drop_column("cabinet_estimates", "drywall_repair_sqft")
    op.drop_column("cabinet_estimates", "include_drywall_repair")
    op.drop_column("cabinet_estimates", "include_countertop")
    op.drop_column("cabinet_estimates", "include_toe_kick")
