"""add roofing_estimates.job_cost_inputs (labor + disposal cost)

The internal profit panel subtracted only material cost from the
estimate total, which counted the crew and the dumpster as profit and
reported margins near 70% on jobs that clear far less.

This column holds the missing inputs: the crew's per-square rates (they
differ per crew, so they are entered per estimate rather than assumed)
and, when debris goes out on the company's own truck instead of in a
rented can, the landfill tipping fee and the haul trips.

Nullable with no default and no backfill: an estimate with nothing here
reports "labor not entered" rather than a profit figure that silently
treats labor as zero.

Revision ID: rfg20260918jc11
Revises: rfg20260917ps10
Create Date: 2026-09-18
"""

from alembic import op
import sqlalchemy as sa

revision = 'rfg20260918jc11'
down_revision = 'rfg20260917ps10'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("roofing_estimates")}
    if "job_cost_inputs" in cols:
        return

    json_type = (
        sa.dialects.postgresql.JSONB
        if bind.dialect.name == "postgresql" else sa.JSON
    )
    op.add_column(
        "roofing_estimates",
        sa.Column("job_cost_inputs", json_type(), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("roofing_estimates")}
    if "job_cost_inputs" not in cols:
        return
    op.drop_column("roofing_estimates", "job_cost_inputs")
