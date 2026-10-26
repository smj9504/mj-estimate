"""group bathroom estimates: a restoration plus upgrade options, or remodel options

A bathroom job could only have one estimate. Insurance jobs need the
restoration (what goes to the carrier) next to upgrade options the
customer can pick, and remodel jobs need several options with no
restoration at all. Each estimate stays a full estimate of its own; these
columns say which job it belongs to and what it is within that job.

Every existing estimate becomes the restoration of its own insurance job,
so nothing about it changes.

Revision ID: be20261026grp01
Revises: cab20261023cs01
Create Date: 2026-10-26
"""

from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "be20261026grp01"
down_revision = "cab20261023cs01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bathroom_estimates",
        sa.Column("group_id", UUIDType(), nullable=True),
    )
    op.add_column(
        "bathroom_estimates",
        sa.Column("project_type", sa.String(20), nullable=False,
                  server_default="insurance"),
    )
    op.add_column(
        "bathroom_estimates",
        sa.Column("kind", sa.String(20), nullable=False,
                  server_default="restore"),
    )
    op.add_column(
        "bathroom_estimates",
        sa.Column("option_label", sa.String(100), nullable=True),
    )
    op.add_column(
        "bathroom_estimates",
        sa.Column("option_order", sa.Integer(), nullable=False,
                  server_default=sa.text("0")),
    )
    op.execute("UPDATE bathroom_estimates SET group_id = id WHERE group_id IS NULL")
    op.create_index(
        "ix_bathroom_estimates_group_id", "bathroom_estimates", ["group_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_bathroom_estimates_group_id", table_name="bathroom_estimates")
    op.drop_column("bathroom_estimates", "option_order")
    op.drop_column("bathroom_estimates", "option_label")
    op.drop_column("bathroom_estimates", "kind")
    op.drop_column("bathroom_estimates", "project_type")
    op.drop_column("bathroom_estimates", "group_id")
