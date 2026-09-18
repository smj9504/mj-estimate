"""add roofing_estimates.square_rounding

Shingles come three bundles to a square and a part bundle cannot be
bought, so the billed roof area steps up to the next third: 9.41 SQ is
quoted as 9.67 SQ, 29 bundles. Without an explanation on the quote the
customer sees 9.67 against a 9.4 SQ roof and cannot tell whether it is
a mistake.

This column stores how that step was computed for each estimate, so the
PDF can print the reasoning instead of the number appearing unsourced.
Computed on calculate; nothing to backfill.

Revision ID: rfg20260918sr12
Revises: rfg20260918jc11
Create Date: 2026-09-18
"""

from alembic import op
import sqlalchemy as sa

revision = 'rfg20260918sr12'
down_revision = 'rfg20260918jc11'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("roofing_estimates")}
    if "square_rounding" in cols:
        return

    json_type = (
        sa.dialects.postgresql.JSONB
        if bind.dialect.name == "postgresql" else sa.JSON
    )
    op.add_column(
        "roofing_estimates",
        sa.Column("square_rounding", json_type(), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("roofing_estimates")}
    if "square_rounding" not in cols:
        return
    op.drop_column("roofing_estimates", "square_rounding")
