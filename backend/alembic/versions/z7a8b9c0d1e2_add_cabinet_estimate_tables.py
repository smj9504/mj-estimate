"""Add cabinet estimate tables

Revision ID: z7a8b9c0d1e2
Revises: y6z7a8b9c0d1
Create Date: 2026-04-28

Creates:
  - cabinet_estimates (main estimate table)
  - cabinet_boxes (individual cabinet boxes)
  - cabinet_estimate_line_items (calculated line items)
  - cabinet_estimate_history (version snapshots)
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "z7a8b9c0d1e2"
down_revision = "y6z7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Detect dialect
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    uuid_type = sa.String(36)
    json_type = sa.JSON()
    if is_pg:
        uuid_type = postgresql.UUID(as_uuid=True)
        json_type = postgresql.JSONB()

    # ── cabinet_estimates ──
    op.create_table(
        "cabinet_estimates",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("claim_id", uuid_type, sa.ForeignKey("claims.id", ondelete="SET NULL"), nullable=True),
        sa.Column("company_id", uuid_type, sa.ForeignKey("companies.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_id", uuid_type, sa.ForeignKey("staff.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="draft"),
        sa.Column("property_address", sa.String(500), nullable=True),
        sa.Column("zip_code", sa.String(10), nullable=True),
        sa.Column("layout_type", sa.String(50), nullable=True),
        sa.Column("kitchen_size_sqft", sa.Float, nullable=True),
        sa.Column("ceiling_height", sa.Float, nullable=True),
        sa.Column("has_soffit", sa.Boolean, server_default="false"),
        sa.Column("tier", sa.String(50), nullable=True),
        sa.Column("box_material", sa.String(50), nullable=True),
        sa.Column("finish", sa.String(50), nullable=True),
        sa.Column("door_style", sa.String(50), nullable=True),
        sa.Column("include_demo", sa.Boolean, server_default="true"),
        sa.Column("include_install", sa.Boolean, server_default="true"),
        sa.Column("include_delivery", sa.Boolean, server_default="true"),
        sa.Column("include_plumbing", sa.Boolean, server_default="false"),
        sa.Column("include_countertop_reset", sa.Boolean, server_default="false"),
        sa.Column("include_hardware", sa.Boolean, server_default="true"),
        sa.Column("countertop_material", sa.String(100), nullable=True),
        sa.Column("countertop_sqft", sa.Float, nullable=True),
        sa.Column("subtotal", sa.Float, server_default="0"),
        sa.Column("overhead_pct", sa.Float, server_default="0.10"),
        sa.Column("overhead_amount", sa.Float, server_default="0"),
        sa.Column("profit_pct", sa.Float, server_default="0.10"),
        sa.Column("profit_amount", sa.Float, server_default="0"),
        sa.Column("total", sa.Float, server_default="0"),
        sa.Column("methodology_notes", sa.Text, nullable=True),
        sa.Column("warning_flags", json_type, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_cabinet_estimates_claim_id", "cabinet_estimates", ["claim_id"])
    op.create_index("ix_cabinet_estimates_company_id", "cabinet_estimates", ["company_id"])
    op.create_index("ix_cabinet_estimates_status", "cabinet_estimates", ["status"])

    # ── cabinet_boxes ──
    op.create_table(
        "cabinet_boxes",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("estimate_id", uuid_type, sa.ForeignKey("cabinet_estimates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(20), nullable=False),
        sa.Column("cab_type", sa.String(20), nullable=False),
        sa.Column("width_inches", sa.Integer, nullable=False),
        sa.Column("height_inches", sa.Float, nullable=False),
        sa.Column("is_specialty", sa.Boolean, server_default="false"),
        sa.Column("specialty_type", sa.String(50), nullable=True),
        sa.Column("qty", sa.Integer, nullable=False, server_default="1"),
        sa.Column("display_order", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_cabinet_boxes_estimate_id", "cabinet_boxes", ["estimate_id"])

    # ── cabinet_estimate_line_items ──
    op.create_table(
        "cabinet_estimate_line_items",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("estimate_id", uuid_type, sa.ForeignKey("cabinet_estimates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("quantity", sa.Float, nullable=False),
        sa.Column("unit", sa.String(10), nullable=False),
        sa.Column("unit_price", sa.Float, nullable=False),
        sa.Column("total", sa.Float, nullable=False),
        sa.Column("category", sa.String(50), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("display_order", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_cabinet_line_items_estimate_id", "cabinet_estimate_line_items", ["estimate_id"])

    # ── cabinet_estimate_history ──
    op.create_table(
        "cabinet_estimate_history",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("estimate_id", uuid_type, sa.ForeignKey("cabinet_estimates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_number", sa.Integer, nullable=False),
        sa.Column("snapshot_data", json_type, nullable=False),
        sa.Column("changed_by_id", uuid_type, sa.ForeignKey("staff.id", ondelete="SET NULL"), nullable=True),
        sa.Column("change_description", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_cabinet_history_estimate_id", "cabinet_estimate_history", ["estimate_id"])


def downgrade() -> None:
    op.drop_table("cabinet_estimate_history")
    op.drop_table("cabinet_estimate_line_items")
    op.drop_table("cabinet_boxes")
    op.drop_table("cabinet_estimates")
