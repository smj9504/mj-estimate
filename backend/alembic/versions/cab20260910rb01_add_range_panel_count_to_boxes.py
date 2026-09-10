"""cabinet boxes: add range_panel_count

Slide-in range bases carry finished end panels on the cabinets flanking the
range opening. The count varies by layout (two flanking ends normally, one
when the opening sits at a wall), so it is per-box state rather than a flat
specialty premium — see RANGE_END_PANEL_EACH in pricing.py.

NULL means "not specified"; the calculator treats that as 2, the common case.
The column is only meaningful when specialty_type == "range_base_slide_in".

Revision ID: cab20260910rb01
Revises: xv20260904vec01
"""
from alembic import op
import sqlalchemy as sa

revision = "cab20260910rb01"
down_revision = "xv20260904vec01"
branch_labels = None
depends_on = None

_TABLE = "cabinet_boxes"
_COLUMN = "range_panel_count"


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
        sa.Column(_COLUMN, sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE):
        return
    if not _has_column(conn, _TABLE, _COLUMN):
        return
    op.drop_column(_TABLE, _COLUMN)
