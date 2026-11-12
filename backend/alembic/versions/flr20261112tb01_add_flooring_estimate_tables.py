"""add flooring estimate tables

- flooring_estimates: a flooring estimate priced room by room from its
  sketch. sketch_data holds the rooms in feet (interior, wall to wall),
  room_scopes the floors and the work that goes with them per room,
  job_scope the defaults for every room and the General items.
- flooring_estimate_line_items: the calculated lines, each under its room
  (room_id / room_name; NULL room is the General section).
- flooring_estimate_history: version snapshots.

The app's startup also creates missing tables, so each is created only if
it isn't there yet.

Revision ID: flr20261112tb01
Revises: wm20261110fpp01
Create Date: 2026-11-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from app.core.database_types import UUIDType

revision = "flr20261112tb01"
down_revision = "wm20261110fpp01"
branch_labels = None
depends_on = None


def _has_table(conn, table: str) -> bool:
    return sa.inspect(conn).has_table(table)


def _json(conn):
    return postgresql.JSONB() if conn.dialect.name == "postgresql" else sa.JSON()


def upgrade() -> None:
    conn = op.get_bind()
    json_type = _json(conn)

    if not _has_table(conn, "flooring_estimates"):
        op.create_table(
            "flooring_estimates",
            sa.Column("id", UUIDType(), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.Column("group_id", UUIDType(), nullable=True),
            sa.Column("project_type", sa.String(20), nullable=False, server_default="insurance"),
            sa.Column("kind", sa.String(20), nullable=False, server_default="restore"),
            sa.Column("option_label", sa.String(100), nullable=True),
            sa.Column("option_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("claim_id", UUIDType(), sa.ForeignKey("claims.id", ondelete="SET NULL"), nullable=True),
            sa.Column("company_id", UUIDType(), sa.ForeignKey("companies.id", ondelete="SET NULL"), nullable=True),
            sa.Column("price_book_id", UUIDType(), sa.ForeignKey("price_books.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_by_id", UUIDType(), sa.ForeignKey("staff.id", ondelete="SET NULL"), nullable=True),
            sa.Column("status", sa.String(50), nullable=False, server_default="draft"),
            sa.Column("property_address", sa.String(500)),
            sa.Column("city", sa.String(100)),
            sa.Column("state", sa.String(5)),
            sa.Column("zip_code", sa.String(10)),
            sa.Column("sketch_data", json_type, nullable=True),
            sa.Column("room_scopes", json_type, nullable=True),
            sa.Column("job_scope", json_type, nullable=True),
            sa.Column("overview_text", sa.Text(), nullable=True),
            sa.Column("include_overhead_profit", sa.Boolean(), server_default=sa.false()),
            sa.Column("overhead_pct", sa.Float(), server_default="0.1"),
            sa.Column("profit_pct", sa.Float(), server_default="0.1"),
            sa.Column("calculated_rooms", json_type, nullable=True),
            sa.Column("subtotal", sa.Float(), server_default="0"),
            sa.Column("overhead_amount", sa.Float(), server_default="0"),
            sa.Column("profit_amount", sa.Float(), server_default="0"),
            sa.Column("tax_amount", sa.Float(), server_default="0"),
            sa.Column("total", sa.Float(), server_default="0"),
            sa.Column("methodology_notes", sa.Text(), nullable=True),
            sa.Column("warning_flags", json_type, nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
        )
        op.create_index("ix_flooring_estimates_id", "flooring_estimates", ["id"])
        op.create_index("ix_flooring_estimates_claim_id", "flooring_estimates", ["claim_id"])
        op.create_index("ix_flooring_estimates_company_id", "flooring_estimates", ["company_id"])
        op.create_index("ix_flooring_estimates_status", "flooring_estimates", ["status"])
        op.create_index("ix_flooring_estimates_group_id", "flooring_estimates", ["group_id"])

    if not _has_table(conn, "flooring_estimate_line_items"):
        op.create_table(
            "flooring_estimate_line_items",
            sa.Column("id", UUIDType(), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.Column(
                "estimate_id", UUIDType(),
                sa.ForeignKey("flooring_estimates.id", ondelete="CASCADE"), nullable=False,
            ),
            sa.Column("room_id", sa.String(64), nullable=True),
            sa.Column("room_name", sa.String(200), nullable=False),
            sa.Column("level_name", sa.String(100), nullable=True),
            sa.Column("category", sa.String(30), nullable=False),
            sa.Column("item_key", sa.String(64), nullable=True),
            sa.Column("source", sa.String(10), nullable=False, server_default="item"),
            sa.Column("description", sa.String(500), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("unit", sa.String(10), nullable=False),
            sa.Column("unit_price", sa.Float(), nullable=False),
            sa.Column("total", sa.Float(), nullable=False),
            sa.Column("notes", sa.String(500), nullable=True),
            sa.Column("display_order", sa.Integer(), server_default="0"),
        )
        op.create_index("ix_flooring_estimate_line_items_id", "flooring_estimate_line_items", ["id"])
        op.create_index("ix_flooring_line_items_estimate_id", "flooring_estimate_line_items", ["estimate_id"])

    if not _has_table(conn, "flooring_estimate_history"):
        op.create_table(
            "flooring_estimate_history",
            sa.Column("id", UUIDType(), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.Column(
                "estimate_id", UUIDType(),
                sa.ForeignKey("flooring_estimates.id", ondelete="CASCADE"), nullable=False,
            ),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("snapshot_data", json_type, nullable=False),
            sa.Column("changed_by_id", UUIDType(), sa.ForeignKey("staff.id", ondelete="SET NULL"), nullable=True),
            sa.Column("change_description", sa.String(500), nullable=True),
        )
        op.create_index("ix_flooring_estimate_history_id", "flooring_estimate_history", ["id"])
        op.create_index("ix_flooring_history_estimate_id", "flooring_estimate_history", ["estimate_id"])


def downgrade() -> None:
    conn = op.get_bind()
    for table in ("flooring_estimate_history", "flooring_estimate_line_items", "flooring_estimates"):
        if _has_table(conn, table):
            op.drop_table(table)
