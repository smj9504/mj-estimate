"""rebuild_projects: add customer_managed

Some claims get a Rebuild project but the customer hires their own
contractor and we don't build it. Those are flagged so the Rebuild list can
leave them out and show them on their own. Every existing project is ours.

Revision ID: rb20261109cm01
Revises: up20261108pb01
"""
from alembic import op
import sqlalchemy as sa

revision = "rb20261109cm01"
down_revision = "up20261108pb01"
branch_labels = None
depends_on = None

_TABLE = "rebuild_projects"
_COLUMN = "customer_managed"


def _has_column(conn, table: str, col: str) -> bool:
    return col in {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE) or _has_column(conn, _TABLE, _COLUMN):
        return
    op.add_column(
        _TABLE,
        sa.Column(
            _COLUMN, sa.Boolean(), nullable=False, server_default=sa.false(),
            comment="Customer hires their own contractor; not our build",
        ),
    )


def downgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table(_TABLE) or not _has_column(conn, _TABLE, _COLUMN):
        return
    op.drop_column(_TABLE, _COLUMN)
