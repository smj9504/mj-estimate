"""cabinet boxes: add door_pattern

A cabinet's doors can carry a pattern instead of a plain panel: a diamond
lattice, or a lattice over a carved oval band. Like glass, it belongs to the
box rather than the kitchen; see DOOR_PATTERN_PREMIUM in pricing.py.

NULL is a plain door in the job's door style, so every existing box stays as
it was.

Revision ID: cab20261102dp01
Revises: cs20261102ti01
"""
from alembic import op
import sqlalchemy as sa

revision = "cab20261102dp01"
down_revision = "cs20261102ti01"
branch_labels = None
depends_on = None

_TABLE = "cabinet_boxes"
_COLUMN = "door_pattern"


def _has_column(conn, table: str, col: str) -> bool:
    return col in {
        c["name"] for c in sa.inspect(conn).get_columns(table)
    }


def upgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE):
        return
    if _has_column(conn, _TABLE, _COLUMN):
        return
    op.add_column(
        _TABLE,
        sa.Column(_COLUMN, sa.String(30), nullable=True),
    )


def downgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE):
        return
    if not _has_column(conn, _TABLE, _COLUMN):
        return
    op.drop_column(_TABLE, _COLUMN)
