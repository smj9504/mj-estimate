"""claims, water_mitigation_jobs: add additional_adjusters

A carrier sometimes hands a claim to a third-party adjusting firm, so a claim
or WM job can have up to three adjusters. The first stays in the adjuster_*
columns; the other two go here as [{company, name, phone, email}]. See
app/domains/client/adjusters.py.

NULL is no other adjusters, so every existing row stays as it was.

Revision ID: adj20261103aa01
Revises: cab20261102dp01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "adj20261103aa01"
down_revision = "cab20261102dp01"
branch_labels = None
depends_on = None

_COLUMN = "additional_adjusters"
_COMMENT = "Adjusters past the first [{company, name, phone, email}], at most 2"
# Each table keeps the JSON type its other columns use
_TABLES = (
    ("claims", sa.JSON),
    ("water_mitigation_jobs", JSONB),
)


def _has_column(conn, table: str, col: str) -> bool:
    return col in {
        c["name"] for c in sa.inspect(conn).get_columns(table)
    }


def upgrade() -> None:
    conn = op.get_bind()
    for table, column_type in _TABLES:
        if not sa.inspect(conn).has_table(table):
            continue
        if _has_column(conn, table, _COLUMN):
            continue
        op.add_column(
            table,
            sa.Column(_COLUMN, column_type, nullable=True, comment=_COMMENT),
        )


def downgrade() -> None:
    conn = op.get_bind()
    for table, _ in _TABLES:
        if not sa.inspect(conn).has_table(table):
            continue
        if not _has_column(conn, table, _COLUMN):
            continue
        op.drop_column(table, _COLUMN)
