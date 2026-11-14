"""add the rebuild estimate's sketch

rebuild_estimates.sketch_data: the estimate's own sketch, drawn with the
flooring estimate's editor. Each room drawn is a room of the estimate,
measured from the drawing.

Revision ID: rbe20261113sk04
Revises: rbe20261113wd03
Create Date: 2026-11-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "rbe20261113sk04"
down_revision = "rbe20261113wd03"
branch_labels = None
depends_on = None


def _has_column(conn) -> bool:
    return any(c["name"] == "sketch_data" for c in sa.inspect(conn).get_columns("rebuild_estimates"))


def upgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table("rebuild_estimates") or _has_column(conn):
        return
    json_type = postgresql.JSONB() if conn.dialect.name == "postgresql" else sa.JSON()
    op.add_column("rebuild_estimates", sa.Column("sketch_data", json_type, nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    if sa.inspect(conn).has_table("rebuild_estimates") and _has_column(conn):
        op.drop_column("rebuild_estimates", "sketch_data")
