"""rebuild_projects: add scope_source

A project's scope of work can be drafted from the claim's insurance
estimate. scope_source records which estimate revision it was drafted from
and when, so the project page can say when a newer estimate has come in
since. Empty on every existing project (its scope was typed by hand).

Revision ID: rb20261125ss01
Revises: cco20261120tb01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "rb20261125ss01"
down_revision = "cco20261120tb01"
branch_labels = None
depends_on = None

_TABLE = "rebuild_projects"
_COLUMN = "scope_source"


def _has_column(conn, table: str, col: str) -> bool:
    return col in {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE) or _has_column(conn, _TABLE, _COLUMN):
        return
    op.add_column(
        _TABLE,
        sa.Column(
            _COLUMN, postgresql.JSONB(), nullable=True,
            comment="Estimate revision the scope of work was drafted from",
        ),
    )


def downgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE) or not _has_column(conn, _TABLE, _COLUMN):
        return
    op.drop_column(_TABLE, _COLUMN)
