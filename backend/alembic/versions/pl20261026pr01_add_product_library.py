"""product library: retailer products shared by kitchen and bathroom estimates

Remodel options are built from products the customer can buy and see: a
cabinet line, a faucet, a tile, a vanity. Each is kept once for the whole
company, with its real size, price and unit, pictures (as product files)
and how it looks for the 2D/3D drawings. Estimates copy what they use, so
nothing here points back from an estimate.

Revision ID: pl20261026pr01
Revises: be20261026grp01
Create Date: 2026-10-26
"""

from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "pl20261026pr01"
down_revision = "be20261026grp01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Startup's create_all may already have made it.
    if "products" in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "products",
        sa.Column("id", UUIDType(), primary_key=True),
        sa.Column("company_id", UUIDType(), sa.ForeignKey("companies.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_id", UUIDType(), sa.ForeignKey("staff.id", ondelete="SET NULL"), nullable=True),
        sa.Column("category", sa.String(40), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("brand", sa.String(120), nullable=True),
        sa.Column("model_number", sa.String(120), nullable=True),
        sa.Column("sku", sa.String(120), nullable=True),
        sa.Column("finish", sa.String(160), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("retailer", sa.String(40), nullable=False, server_default="other"),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("price", sa.Numeric(10, 2), nullable=True),
        sa.Column("price_unit", sa.String(10), nullable=False, server_default="each"),
        sa.Column("box_sf", sa.Float(), nullable=True),
        sa.Column("width_in", sa.Float(), nullable=True),
        sa.Column("depth_in", sa.Float(), nullable=True),
        sa.Column("height_in", sa.Float(), nullable=True),
        sa.Column("tile_width_in", sa.Float(), nullable=True),
        sa.Column("tile_length_in", sa.Float(), nullable=True),
        sa.Column("image_file_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("swatch_file_id", sa.String(), nullable=True),
        sa.Column("look", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("specs", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_products_id", "products", ["id"])
    op.create_index("ix_products_category", "products", ["category"])
    op.create_index("ix_products_company_id", "products", ["company_id"])


def downgrade() -> None:
    op.drop_index("ix_products_company_id", table_name="products")
    op.drop_index("ix_products_category", table_name="products")
    op.drop_index("ix_products_id", table_name="products")
    op.drop_table("products")
