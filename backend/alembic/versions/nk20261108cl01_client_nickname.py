"""clients: add nickname

What staff call a client among themselves ("아이스크림집", "목사님") when the
name or address isn't how they think of it. Most clients have none, so it
is nullable and starts empty everywhere.

Revision ID: nk20261108cl01
Revises: ck20261106ts01
"""
from alembic import op
import sqlalchemy as sa

revision = "nk20261108cl01"
down_revision = "ck20261106ts01"
branch_labels = None
depends_on = None

_TABLE = "clients"
_COLUMN = "nickname"


def _has_column(conn, table: str, col: str) -> bool:
    return col in {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE) or _has_column(conn, _TABLE, _COLUMN):
        return
    op.add_column(
        _TABLE,
        sa.Column(
            _COLUMN, sa.String(100), nullable=True,
            comment="Name staff call the client by internally; never shown to the customer",
        ),
    )


def downgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE) or not _has_column(conn, _TABLE, _COLUMN):
        return
    op.drop_column(_TABLE, _COLUMN)
