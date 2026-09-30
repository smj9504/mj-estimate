"""let a material's quantity be a spreadsheet formula

"measurement ÷ coverage, round up" covers most materials but cannot say
"if the valley run is long, add waste": estimators write that as

    IF(valley_lf > 15, ROUNDUP(roof_area_waste * 3.15),
                       ROUNDUP(roof_area_waste * 3))

so the formula is stored as text and parsed by formula.py. The simple
basis/coverage columns stay and still work — a row uses whichever it has,
formula first — so nothing changes for a material until someone writes
one.

Revision ID: rfg20260917fx08
Revises: rfg20260917qf07
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa

revision = 'rfg20260917fx08'
down_revision = 'rfg20260917qf07'
branch_labels = None
depends_on = None

TABLE = 'roofing_material_prices'
COLUMN = 'qty_formula'


def _has_table(conn, table: str) -> bool:
    return sa.inspect(conn).has_table(table)


def _has_column(conn, table: str, column: str) -> bool:
    if conn.dialect.name == 'sqlite':
        rows = conn.execute(sa.text(f"PRAGMA table_info({table})")).fetchall()
        return any(r[1] == column for r in rows)
    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column})
    return result.fetchone() is not None


def upgrade() -> None:
    conn = op.get_bind()
    if not _has_table(conn, TABLE):
        return
    if not _has_column(conn, TABLE, COLUMN):
        op.add_column(TABLE, sa.Column(COLUMN, sa.Text(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    if not _has_table(conn, TABLE):
        return
    if _has_column(conn, TABLE, COLUMN):
        op.drop_column(TABLE, COLUMN)
