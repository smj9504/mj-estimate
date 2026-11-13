"""Xactimate price list: Detach & Reset / Material Only / Install Only prices, and labor rates by trade

Besides an item's own activity (&, +, -) Xactimate's Quick Entry offers up to
three more for it, each at its own price:

- xactimate_items.other_activities: which of R (Detach & Reset), M (Material
  Only) and I (Install Only) the item offers, e.g. "RMI", "MI"; "" when it
  offers none, NULL where it wasn't read
- xactimate_items.detach_reset_price / material_only_price /
  install_only_price: each one's price as Xactimate shows it
- xactimate_components.activity "R": Detach & Reset has its own labor yield
  (CAB CTCON-: R $41.67 vs replace $95.17), so its report's components are
  kept next to the + and - ones. M and I need none: M is the replace
  materials and I the replace labor and equipment.

xactimate_labor_rates: each labor trade's hourly rate (the component code of
a labor component, e.g. CARP-FNC) split the way Xactimate's labor breakdown
shows it: worker's wage + labor burden + labor overhead = the rate.

Revision ID: xp20261113rm01
Revises: flr20261112sc02
Create Date: 2026-11-13
"""

from alembic import op
import sqlalchemy as sa

revision = "xp20261113rm01"
down_revision = "flr20261112sc02"
branch_labels = None
depends_on = None


def _has_column(conn, table: str, col: str) -> bool:
    return col in {c["name"] for c in sa.inspect(conn).get_columns(table)}


ITEM_COLUMNS = (
    ("other_activities", lambda: sa.Column("other_activities", sa.String(4), nullable=True)),
    ("detach_reset_price", lambda: sa.Column("detach_reset_price", sa.DECIMAL(10, 2), nullable=True)),
    ("material_only_price", lambda: sa.Column("material_only_price", sa.DECIMAL(10, 2), nullable=True)),
    ("install_only_price", lambda: sa.Column("install_only_price", sa.DECIMAL(10, 2), nullable=True)),
)


def upgrade() -> None:
    conn = op.get_bind()
    for name, column in ITEM_COLUMNS:
        if not _has_column(conn, "xactimate_items", name):
            op.add_column("xactimate_items", column())
    if "xactimate_labor_rates" not in sa.inspect(conn).get_table_names():
        op.create_table(
            "xactimate_labor_rates",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("trade", sa.String(20), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("price_list", sa.String(30), nullable=True),
            sa.Column("price_year", sa.Integer(), nullable=False),
            sa.Column("price_month", sa.Integer(), nullable=False),
            sa.Column("rate_per_hour", sa.DECIMAL(10, 2), nullable=False),
            sa.Column("wage_per_hour", sa.DECIMAL(10, 2), nullable=False),
            sa.Column("burden_per_hour", sa.DECIMAL(10, 2), nullable=False),
            sa.Column("overhead_per_hour", sa.DECIMAL(10, 2), nullable=False),
            sa.Column("sample_item_code", sa.String(50), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("trade", "price_year", "price_month", name="uq_xactimate_labor_rates_trade_month"),
        )


def downgrade() -> None:
    op.drop_table("xactimate_labor_rates")
    for name, _ in reversed(ITEM_COLUMNS):
        op.drop_column("xactimate_items", name)
