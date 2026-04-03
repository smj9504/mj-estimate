"""add notes column to insurance pdf extraction items

Revision ID: k3l4m5n6o7p8
Revises: j2k3l4m5n6o7
Create Date: 2026-04-01
"""

from alembic import op
import sqlalchemy as sa

revision = "k3l4m5n6o7p8"
down_revision = "j2k3l4m5n6o7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "insurance_pdf_extraction_items",
        sa.Column("notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("insurance_pdf_extraction_items", "notes")
