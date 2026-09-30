"""describe roofing price-book materials by manufacturer and product

A grade is not a price. "Architectural shingle" covers GAF Timberline
HDZ and CertainTeed Landmark Pro, which cost different amounts and come
in different bundle counts, so the row has to name the actual product
being bought. These columns also let a user add a material the seed
catalog never had.

All nullable: existing rows describe a grade rather than a product, and
stay valid — the screen simply shows less detail for them.

Revision ID: rfg20260917pd04
Revises: rfg20260917pb03
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa

revision = 'rfg20260917pd04'
down_revision = 'rfg20260917pb03'
branch_labels = None
depends_on = None

TABLE = 'roofing_material_prices'

COLUMNS = (
    ('manufacturer', lambda: sa.Column(
        'manufacturer', sa.String(100), nullable=True)),
    ('product_name', lambda: sa.Column(
        'product_name', sa.String(200), nullable=True)),
    ('color', lambda: sa.Column('color', sa.String(100), nullable=True)),
    ('size_spec', lambda: sa.Column(
        'size_spec', sa.String(100), nullable=True)),
    ('supplier', lambda: sa.Column(
        'supplier', sa.String(150), nullable=True)),
    ('sku', lambda: sa.Column('sku', sa.String(100), nullable=True)),
    ('coverage_per_unit', lambda: sa.Column(
        'coverage_per_unit', sa.Float(), nullable=True)),
    ('coverage_unit', lambda: sa.Column(
        'coverage_unit', sa.String(10), nullable=True)),
    ('is_custom', lambda: sa.Column(
        'is_custom', sa.Boolean(), nullable=True,
        server_default=sa.false())),
)


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
        # pb03 creates it; nothing to extend if that has not run.
        return

    for name, make in COLUMNS:
        if not _has_column(conn, TABLE, name):
            op.add_column(TABLE, make())

    # Seeded rows came from the catalog, not from a user.
    conn.execute(sa.text(
        f"UPDATE {TABLE} SET is_custom = :false_val "
        "WHERE is_custom IS NULL"
    ), {"false_val": False})


def downgrade() -> None:
    conn = op.get_bind()
    if not _has_table(conn, TABLE):
        return

    for name, _ in reversed(COLUMNS):
        if _has_column(conn, TABLE, name):
            op.drop_column(TABLE, name)
