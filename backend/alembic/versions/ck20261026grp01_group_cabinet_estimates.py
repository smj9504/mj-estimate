"""group kitchen estimates: a restoration plus upgrade options, or remodel options

As bathroom estimates were grouped (be20261026grp01): an insurance kitchen
job holds the restoration the carrier gets next to upgrade options the
customer can pick, and a remodel job holds options only. An option can
also carry products chosen from the product library (selections), which
price its material and draw its kitchen.

Every existing estimate becomes the restoration of its own insurance job,
so nothing about it changes.

Revision ID: ck20261026grp01
Revises: be20261026sel01
Create Date: 2026-10-26
"""

from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "ck20261026grp01"
down_revision = "be20261026sel01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cabinet_estimates",
        sa.Column("group_id", UUIDType(), nullable=True),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("project_type", sa.String(20), nullable=False,
                  server_default="insurance"),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("kind", sa.String(20), nullable=False,
                  server_default="restore"),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("option_label", sa.String(100), nullable=True),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("option_order", sa.Integer(), nullable=False,
                  server_default=sa.text("0")),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("selections", sa.JSON(), nullable=True),
    )
    op.execute("UPDATE cabinet_estimates SET group_id = id WHERE group_id IS NULL")
    op.create_index(
        "ix_cabinet_estimates_group_id", "cabinet_estimates", ["group_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_cabinet_estimates_group_id", table_name="cabinet_estimates")
    op.drop_column("cabinet_estimates", "selections")
    op.drop_column("cabinet_estimates", "option_order")
    op.drop_column("cabinet_estimates", "option_label")
    op.drop_column("cabinet_estimates", "kind")
    op.drop_column("cabinet_estimates", "project_type")
    op.drop_column("cabinet_estimates", "group_id")
