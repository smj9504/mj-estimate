"""claims: add inbox_checked_at

When someone last pressed Check inbox on the claim, so the client page can
ask for a check (a dot on Received) when it was never done or is over a day
old. The morning poll doesn't set it.

NULL is never checked, so every existing claim starts with the dot.

Revision ID: ibx20261105ck01
Revises: adj20261103aa01
"""
from alembic import op
import sqlalchemy as sa

revision = "ibx20261105ck01"
down_revision = "adj20261103aa01"
branch_labels = None
depends_on = None

_TABLE = "claims"
_COLUMN = "inbox_checked_at"


def _has_column(conn, table: str, col: str) -> bool:
    return col in {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE) or _has_column(conn, _TABLE, _COLUMN):
        return
    op.add_column(
        _TABLE,
        sa.Column(
            _COLUMN, sa.DateTime(timezone=True), nullable=True,
            comment="Last time someone pressed Check inbox on this claim",
        ),
    )


def downgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE) or not _has_column(conn, _TABLE, _COLUMN):
        return
    op.drop_column(_TABLE, _COLUMN)
