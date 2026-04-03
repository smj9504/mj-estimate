"""add insurance pdf extraction tables

Revision ID: j2k3l4m5n6o7
Revises: i1j2k3l4m5n6
Create Date: 2026-04-01
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "j2k3l4m5n6o7"
down_revision = "i1j2k3l4m5n6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "insurance_pdf_extractions",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("file_id", sa.String(length=255), nullable=False),
        sa.Column("carrier", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="completed"),
        sa.Column("pages", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("raw_text_excerpt", sa.Text(), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column(
            "parser_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["file_id"], ["files.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_insurance_pdf_extractions_id", "insurance_pdf_extractions", ["id"], unique=False)
    op.create_index(
        "ix_insurance_pdf_extractions_file_id",
        "insurance_pdf_extractions",
        ["file_id"],
        unique=False,
    )
    op.create_index(
        "ix_insurance_pdf_extractions_status",
        "insurance_pdf_extractions",
        ["status"],
        unique=False,
    )

    op.create_table(
        "insurance_pdf_extraction_items",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("extraction_id", sa.UUID(), nullable=False),
        sa.Column("room", sa.String(length=255), nullable=True),
        sa.Column("line_item", sa.Text(), nullable=False),
        sa.Column("unit_price", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("quantity", sa.Numeric(precision=12, scale=3), nullable=True),
        sa.Column("measurement", sa.String(length=100), nullable=True),
        sa.Column("unit", sa.String(length=30), nullable=True),
        sa.Column("source_page", sa.Integer(), nullable=True),
        sa.Column("confidence", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column("raw_line", sa.Text(), nullable=True),
        sa.Column("token_offsets", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "validation_flags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["extraction_id"], ["insurance_pdf_extractions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_insurance_pdf_extraction_items_id",
        "insurance_pdf_extraction_items",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_insurance_pdf_extraction_items_extraction_id",
        "insurance_pdf_extraction_items",
        ["extraction_id"],
        unique=False,
    )
    op.create_index(
        "ix_insurance_pdf_extraction_items_source_page",
        "insurance_pdf_extraction_items",
        ["source_page"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_insurance_pdf_extraction_items_source_page", table_name="insurance_pdf_extraction_items")
    op.drop_index("ix_insurance_pdf_extraction_items_extraction_id", table_name="insurance_pdf_extraction_items")
    op.drop_index("ix_insurance_pdf_extraction_items_id", table_name="insurance_pdf_extraction_items")
    op.drop_table("insurance_pdf_extraction_items")

    op.drop_index("ix_insurance_pdf_extractions_status", table_name="insurance_pdf_extractions")
    op.drop_index("ix_insurance_pdf_extractions_file_id", table_name="insurance_pdf_extractions")
    op.drop_index("ix_insurance_pdf_extractions_id", table_name="insurance_pdf_extractions")
    op.drop_table("insurance_pdf_extractions")
