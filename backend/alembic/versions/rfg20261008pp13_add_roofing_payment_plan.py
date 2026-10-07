"""add roofing_estimates.payment_plan

The roofing quote always printed one payment schedule: a deposit, a
payment at material delivery and the balance at the final walk-through.
Some jobs are sold as 50% upon signing and 50% upon completion instead,
so the schedule is now chosen per estimate.

Null means the original three-payment schedule, so existing estimates
print exactly what they did before; nothing to backfill.

Revision ID: rfg20261008pp13
Revises: wm20260930bgimg01
Create Date: 2026-10-08
"""

from alembic import op
import sqlalchemy as sa

revision = 'rfg20261008pp13'
down_revision = 'wm20260930bgimg01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("roofing_estimates")}
    if "payment_plan" in cols:
        return
    op.add_column(
        "roofing_estimates",
        sa.Column("payment_plan", sa.String(30), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("roofing_estimates")}
    if "payment_plan" not in cols:
        return
    op.drop_column("roofing_estimates", "payment_plan")
