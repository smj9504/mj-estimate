"""claim_expenses: whose cost it is (contractor or public adjuster)

The contractor and the public adjuster keep separate books on a claim. Every
expense recorded so far was the contractor's, so existing rows start as
contractor.

Revision ID: ex20261106pt01
Revises: pa20261106ro01
"""
from alembic import op
import sqlalchemy as sa

revision = "ex20261106pt01"
down_revision = "pa20261106ro01"
branch_labels = None
depends_on = None

_TABLE = "claim_expenses"
_COLUMN = "party"


def _has_column(conn, table: str, col: str) -> bool:
    return col in {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE) or _has_column(conn, _TABLE, _COLUMN):
        return
    op.add_column(
        _TABLE,
        sa.Column(
            _COLUMN, sa.String(30), nullable=False, server_default="contractor",
            comment="contractor | public_adjuster",
        ),
    )


def downgrade() -> None:
    conn = op.get_bind()
    if sa.inspect(conn).has_table(_TABLE) and _has_column(conn, _TABLE, _COLUMN):
        op.drop_column(_TABLE, _COLUMN)
