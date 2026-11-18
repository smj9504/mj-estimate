"""a note kept with a rebuild line's words

rebuild_wordings.note: printed under the line, saying what its price pays
for; a line of the item comes with it from then on.

Revision ID: rbe20261116nt05
Revises: rbe20261113sk04
Create Date: 2026-11-16
"""

from alembic import op
import sqlalchemy as sa

revision = "rbe20261116nt05"
down_revision = "rbe20261113sk04"
branch_labels = None
depends_on = None


def _has_column(conn) -> bool:
    return any(c["name"] == "note" for c in sa.inspect(conn).get_columns("rebuild_wordings"))


def upgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table("rebuild_wordings") or _has_column(conn):
        return
    op.add_column("rebuild_wordings", sa.Column("note", sa.String(500), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    if sa.inspect(conn).has_table("rebuild_wordings") and _has_column(conn):
        op.drop_column("rebuild_wordings", "note")
