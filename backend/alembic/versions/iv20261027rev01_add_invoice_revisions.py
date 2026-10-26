"""invoice revisions: revise a sent invoice and keep every version's PDF

invoices.revised_date: set when an invoice is revised. Its PDF then prints
"Revised: <date>" under the date of issue and "Due upon receipt" in place
of the due date. invoices.version (already there) counts the revisions.

invoice_revisions: each earlier version, frozen at the moment it was
revised, as the PDF request it printed - so the before and after PDFs can
both be made again.

Revision ID: iv20261027rev01
Revises: sc20261027al01
Create Date: 2026-10-27
"""

from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "iv20261027rev01"
down_revision = "sc20261027al01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    invoice_columns = {c["name"] for c in inspector.get_columns("invoices")}
    if "revised_date" not in invoice_columns:
        op.add_column("invoices", sa.Column("revised_date", sa.Date(), nullable=True))

    # Startup's create_all may already have made it.
    if "invoice_revisions" in set(inspector.get_table_names()):
        return
    op.create_table(
        "invoice_revisions",
        sa.Column("id", UUIDType(), primary_key=True),
        sa.Column("invoice_id", UUIDType(), sa.ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("revised_date", sa.Date(), nullable=True),
        sa.Column("total_amount", sa.DECIMAL(15, 2), nullable=True),
        sa.Column("pdf_data", sa.JSON(), nullable=False),
        sa.Column("created_by_id", UUIDType(), sa.ForeignKey("staff.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("invoice_id", "version", name="uq_invoice_revisions_invoice_version"),
    )
    op.create_index("ix_invoice_revisions_id", "invoice_revisions", ["id"])
    op.create_index("ix_invoice_revisions_invoice_id", "invoice_revisions", ["invoice_id"])


def downgrade() -> None:
    op.drop_index("ix_invoice_revisions_invoice_id", table_name="invoice_revisions")
    op.drop_index("ix_invoice_revisions_id", table_name="invoice_revisions")
    op.drop_table("invoice_revisions")
    op.drop_column("invoices", "revised_date")
