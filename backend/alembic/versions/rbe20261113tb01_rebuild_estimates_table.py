"""add the rebuild estimates table

rebuild_estimates: one estimate for a claim's rebuild. The flooring,
bathroom and kitchen cabinet estimates are imported into it line by line
(sources, as they were when imported), and the repairs none of them covers
are added on room by room (rooms, lines). All of it is JSON on the row.

The app's startup also creates missing tables, so it is created only if it
isn't there yet.

Revision ID: rbe20261113tb01
Revises: xp20261113rm01
Create Date: 2026-11-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from app.core.database_types import UUIDType

revision = "rbe20261113tb01"
down_revision = "xp20261113rm01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if sa.inspect(conn).has_table("rebuild_estimates"):
        return
    json_type = postgresql.JSONB() if conn.dialect.name == "postgresql" else sa.JSON()
    op.create_table(
        "rebuild_estimates",
        sa.Column("id", UUIDType(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.Column("claim_id", UUIDType(), sa.ForeignKey("claims.id", ondelete="SET NULL"), nullable=True),
        sa.Column("company_id", UUIDType(), sa.ForeignKey("companies.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_id", UUIDType(), sa.ForeignKey("staff.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="draft"),
        sa.Column("property_address", sa.String(500)),
        sa.Column("city", sa.String(100)),
        sa.Column("state", sa.String(5)),
        sa.Column("zip_code", sa.String(10)),
        sa.Column("rooms", json_type, nullable=True),
        sa.Column("sources", json_type, nullable=True),
        sa.Column("lines", json_type, nullable=True),
        sa.Column("include_overhead_profit", sa.Boolean(), server_default=sa.false()),
        sa.Column("overhead_pct", sa.Float(), server_default="0.1"),
        sa.Column("profit_pct", sa.Float(), server_default="0.1"),
        sa.Column("total", sa.Float(), server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_rebuild_estimates_id", "rebuild_estimates", ["id"])
    op.create_index("ix_rebuild_estimates_claim_id", "rebuild_estimates", ["claim_id"])
    op.create_index("ix_rebuild_estimates_company_id", "rebuild_estimates", ["company_id"])


def downgrade() -> None:
    conn = op.get_bind()
    if sa.inspect(conn).has_table("rebuild_estimates"):
        op.drop_table("rebuild_estimates")
