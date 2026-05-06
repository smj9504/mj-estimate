"""Add bathroom estimate tables

Revision ID: e5f6g7h8i9j0
Revises: d4e5f6g7h8i9
Create Date: 2026-04-30

Creates:
  - bathroom_estimates (main estimate table)
  - bathroom_estimate_line_items (calculated line items)
  - bathroom_estimate_history (version snapshots)
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'e5f6g7h8i9j0'
down_revision = 'd4e5f6g7h8i9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    uuid_type = sa.String(36)
    json_type = sa.JSON()

    if is_pg:
        uuid_type = postgresql.UUID(as_uuid=True)
        json_type = postgresql.JSONB()

    # ── bathroom_estimates ──
    op.create_table(
        "bathroom_estimates",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),

        # Relationships
        sa.Column("claim_id", uuid_type, sa.ForeignKey("claims.id", ondelete="SET NULL"), nullable=True),
        sa.Column("company_id", uuid_type, sa.ForeignKey("companies.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_id", uuid_type, sa.ForeignKey("staff.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(50), default="draft", nullable=False),

        # Project meta
        sa.Column("property_address", sa.String(500)),
        sa.Column("city", sa.String(100)),
        sa.Column("state", sa.String(5)),
        sa.Column("zip_code", sa.String(10)),
        sa.Column("building_type", sa.String(50)),
        sa.Column("year_built", sa.Integer),

        # Bathroom info
        sa.Column("designation", sa.String(50)),
        sa.Column("bath_function", sa.String(50)),
        sa.Column("length_ft", sa.Float),
        sa.Column("width_ft", sa.Float),
        sa.Column("height_ft", sa.Float, default=8.0),
        sa.Column("floor_sf", sa.Float),
        sa.Column("wall_sf", sa.Float),

        # Demo scope
        sa.Column("demo_scope", sa.String(50)),
        sa.Column("demo_floor", sa.Boolean, default=False),
        sa.Column("demo_floor_sf", sa.Float, nullable=True),
        sa.Column("demo_walls", sa.Boolean, default=False),
        sa.Column("demo_wall_sf", sa.Float, nullable=True),
        sa.Column("demo_ceiling", sa.Boolean, default=False),
        sa.Column("demo_ceiling_sf", sa.Float, nullable=True),
        sa.Column("replace_shower", sa.Boolean, default=False),
        sa.Column("replace_tub", sa.Boolean, default=False),
        sa.Column("replace_vanity", sa.Boolean, default=False),
        sa.Column("replace_toilet", sa.Boolean, default=False),
        sa.Column("replace_floor", sa.Boolean, default=False),
        sa.Column("water_damage", sa.Boolean, default=False),
        sa.Column("mold_suspected", sa.Boolean, default=False),
        sa.Column("existing_tub_material", sa.String(50)),

        # Component specs (JSONB)
        sa.Column("shower_spec", json_type, nullable=True),
        sa.Column("bathtub_spec", json_type, nullable=True),
        sa.Column("vanity_spec", json_type, nullable=True),
        sa.Column("toilet_spec", json_type, nullable=True),
        sa.Column("floor_spec", json_type, nullable=True),
        sa.Column("walls_spec", json_type, nullable=True),
        sa.Column("accessories_spec", json_type, nullable=True),
        sa.Column("plumbing_spec", json_type, nullable=True),
        sa.Column("electrical_spec", json_type, nullable=True),
        sa.Column("substrate_spec", json_type, nullable=True),
        sa.Column("hidden_costs", json_type, nullable=True),

        # Overview & O&P
        sa.Column("overview_text", sa.Text, nullable=True),
        sa.Column("include_overhead_profit", sa.Boolean, default=False),
        sa.Column("overhead_pct", sa.Float, default=0.10),
        sa.Column("profit_pct", sa.Float, default=0.10),

        # Calculated totals
        sa.Column("subtotal", sa.Float, default=0),
        sa.Column("overhead_amount", sa.Float, default=0),
        sa.Column("profit_amount", sa.Float, default=0),
        sa.Column("tax_amount", sa.Float, default=0),
        sa.Column("total", sa.Float, default=0),

        # Documentation
        sa.Column("methodology_notes", sa.Text, nullable=True),
        sa.Column("warning_flags", json_type, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
    )

    op.create_index("ix_bathroom_estimates_claim_id", "bathroom_estimates", ["claim_id"])
    op.create_index("ix_bathroom_estimates_company_id", "bathroom_estimates", ["company_id"])
    op.create_index("ix_bathroom_estimates_status", "bathroom_estimates", ["status"])

    # ── bathroom_estimate_line_items ──
    op.create_table(
        "bathroom_estimate_line_items",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
        sa.Column("estimate_id", uuid_type,
                  sa.ForeignKey("bathroom_estimates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("phase", sa.Integer, nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("quantity", sa.Float, nullable=False),
        sa.Column("unit", sa.String(10), nullable=False),
        sa.Column("unit_price", sa.Float, nullable=False),
        sa.Column("total", sa.Float, nullable=False),
        sa.Column("category", sa.String(50), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("display_order", sa.Integer, default=0),
    )

    op.create_index("ix_bath_line_items_estimate_id", "bathroom_estimate_line_items", ["estimate_id"])

    # ── bathroom_estimate_history ──
    op.create_table(
        "bathroom_estimate_history",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
        sa.Column("estimate_id", uuid_type,
                  sa.ForeignKey("bathroom_estimates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_number", sa.Integer, nullable=False),
        sa.Column("snapshot_data", json_type, nullable=False),
        sa.Column("changed_by_id", uuid_type,
                  sa.ForeignKey("staff.id", ondelete="SET NULL"), nullable=True),
        sa.Column("change_description", sa.String(500), nullable=True),
    )

    op.create_index("ix_bath_history_estimate_id", "bathroom_estimate_history", ["estimate_id"])


def downgrade() -> None:
    op.drop_table("bathroom_estimate_history")
    op.drop_table("bathroom_estimate_line_items")
    op.drop_table("bathroom_estimates")
