"""add roofing manual_structures, roof_penetrations, skylight_replacements, subtotal splits, add_ons

Revision ID: h9i0j1k2l3m4
Revises: g7h8i9j0k1l2
Create Date: 2026-06-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "h9i0j1k2l3m4"
down_revision = "i1j2k3l4m5n7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("roofing_estimates",
                  sa.Column("manual_structures", JSONB, nullable=True))
    op.add_column("roofing_estimates",
                  sa.Column("roof_penetrations", JSONB, nullable=True))
    op.add_column("roofing_estimates",
                  sa.Column("skylight_replacements", JSONB, nullable=True))
    op.add_column("roofing_estimates",
                  sa.Column("roofing_subtotal", sa.Float(), server_default="0"))
    op.add_column("roofing_estimates",
                  sa.Column("gutter_subtotal", sa.Float(), server_default="0"))
    op.add_column("roofing_estimates",
                  sa.Column("add_ons", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("roofing_estimates", "add_ons")
    op.drop_column("roofing_estimates", "gutter_subtotal")
    op.drop_column("roofing_estimates", "roofing_subtotal")
    op.drop_column("roofing_estimates", "skylight_replacements")
    op.drop_column("roofing_estimates", "roof_penetrations")
    op.drop_column("roofing_estimates", "manual_structures")
