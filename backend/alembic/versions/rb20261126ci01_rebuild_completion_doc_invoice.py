"""rebuild_completion_docs: add invoice_id

An invoice made from the insurance estimate on a Rebuild project is a real
invoice (Invoices), and its PDF is kept as the project's Invoice completion
document. invoice_id ties the document to that invoice, so the project page
can open it and print its PDF again after it is edited. Empty on every
existing document.

Revision ID: rb20261126ci01
Revises: rb20261125ss01
"""
from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "rb20261126ci01"
down_revision = "rb20261125ss01"
branch_labels = None
depends_on = None

_TABLE = "rebuild_completion_docs"
_COLUMN = "invoice_id"


def _has_column(conn, table: str, col: str) -> bool:
    return col in {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE) or _has_column(conn, _TABLE, _COLUMN):
        return
    op.add_column(
        _TABLE,
        sa.Column(
            _COLUMN, UUIDType(), sa.ForeignKey("invoices.id", ondelete="SET NULL"), nullable=True,
            comment="The invoice this document is the PDF of",
        ),
    )


def downgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE) or not _has_column(conn, _TABLE, _COLUMN):
        return
    op.drop_column(_TABLE, _COLUMN)
