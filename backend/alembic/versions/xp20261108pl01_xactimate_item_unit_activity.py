"""Xactimate price list: keep each item's unit, activity, prices by activity and details

The price list is read out of Xactimate's own "Price List Item Report" for
every line item, and out of its Item Activity Information windows. They carry
facts the tables had no place for:

- xactimate_items.unit: EA, SF, LF... (search showed every item as EA)
- xactimate_items.activity: the selector's default activity (&, +, ...)
- xactimate_items.price_list: the Xactimate price list it came from (VAAR8X_NOV26)
- xactimate_items.is_green: Xactimate's green flag on the selector
- xactimate_components.activity: + (replace) or - (remove); an & item's
  report lists both, and the remove components make up its remove price
- xactimate_items.replace_price / remove_price: an & (remove and replace)
  item's price split the way Xactimate prices "+" and "-" on their own;
  untaxed_unit_price stays the whole & price
- xactimate_items.replace_phase / remove_phase: the phase of each activity
  (06 Finish Carpentry / 02 Demolition)
- xactimate_items.replace_market_conditions / remove_market_conditions: the
  report gives one total; Xactimate puts it on either activity or both
- xactimate_items.minimum_group: the labor minimum the item counts toward (CABMN-A)
- xactimate_components.description: "Carpenter - Finish, Trim/Cabinet"
- xactimate_components.supporting_event: the supporting event whose percentage
  the component's yield carries (CAB-LAB 39.583)
- xactimate_supporting_events: each supporting event's text, once

Revision ID: xp20261108pl01
Revises: rb20261109cm01
Create Date: 2026-11-08
"""

from alembic import op
import sqlalchemy as sa

revision = "xp20261108pl01"
down_revision = "rb20261109cm01"
branch_labels = None
depends_on = None


def _has_column(conn, table: str, col: str) -> bool:
    return col in {c["name"] for c in sa.inspect(conn).get_columns(table)}


ITEM_COLUMNS = (
    ("unit", lambda: sa.Column("unit", sa.String(10), nullable=True)),
    ("activity", lambda: sa.Column("activity", sa.String(2), nullable=True)),
    ("price_list", lambda: sa.Column("price_list", sa.String(30), nullable=True)),
    ("is_green", lambda: sa.Column("is_green", sa.Boolean(), nullable=True)),
    ("replace_price", lambda: sa.Column("replace_price", sa.DECIMAL(10, 2), nullable=True)),
    ("remove_price", lambda: sa.Column("remove_price", sa.DECIMAL(10, 2), nullable=True)),
    ("replace_phase", lambda: sa.Column("replace_phase", sa.String(60), nullable=True)),
    ("remove_phase", lambda: sa.Column("remove_phase", sa.String(60), nullable=True)),
    ("replace_market_conditions", lambda: sa.Column("replace_market_conditions", sa.DECIMAL(10, 2), nullable=True)),
    ("remove_market_conditions", lambda: sa.Column("remove_market_conditions", sa.DECIMAL(10, 2), nullable=True)),
    ("minimum_group", lambda: sa.Column("minimum_group", sa.String(20), nullable=True)),
)
COMPONENT_COLUMNS = (
    ("activity", lambda: sa.Column("activity", sa.String(1), nullable=True)),
    ("description", lambda: sa.Column("description", sa.Text(), nullable=True)),
    ("supporting_event", lambda: sa.Column("supporting_event", sa.String(30), nullable=True)),
)


def upgrade() -> None:
    conn = op.get_bind()
    for name, column in ITEM_COLUMNS:
        if not _has_column(conn, "xactimate_items", name):
            op.add_column("xactimate_items", column())
    for name, column in COMPONENT_COLUMNS:
        if not _has_column(conn, "xactimate_components", name):
            op.add_column("xactimate_components", column())
    if "xactimate_supporting_events" not in sa.inspect(conn).get_table_names():
        op.create_table(
            "xactimate_supporting_events",
            sa.Column("code", sa.String(30), primary_key=True),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    op.drop_table("xactimate_supporting_events")
    for name, _ in reversed(COMPONENT_COLUMNS):
        op.drop_column("xactimate_components", name)
    for name, _ in reversed(ITEM_COLUMNS):
        op.drop_column("xactimate_items", name)
