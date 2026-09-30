"""add roofing_material_prices (editable default supplier costs)

Until now the default material costs lived only as constants in
material_cost.py, so correcting a supplier price meant a code change.
This table holds them as data instead, editable from the UI.

company_id NULL is the shared default; a row with a company_id overrides
that one key for that company. Estimates snapshot the costs they were
built on, so editing a row here only affects estimates created later.

The shared defaults are inserted here rather than seeded lazily at
runtime. The price-book UI can only edit rows that already exist — it
never creates them — so an empty table means an empty screen with
nothing to edit. Shipping the rows with the schema also keeps reads from
having to write.

Revision ID: rfg20260917pb03
Revises: rfg20260917ml02
Create Date: 2026-09-17
"""
import uuid

from alembic import op
import sqlalchemy as sa

revision = 'rfg20260917pb03'
down_revision = 'rfg20260917ml02'
branch_labels = None
depends_on = None

TABLE = 'roofing_material_prices'


def _has_table(conn, table: str) -> bool:
    return sa.inspect(conn).has_table(table)


def upgrade() -> None:
    conn = op.get_bind()
    if _has_table(conn, TABLE):
        return

    is_sqlite = conn.dialect.name == 'sqlite'
    uuid_type = sa.String(36) if is_sqlite else sa.dialects.postgresql.UUID(
        as_uuid=True,
    )

    op.create_table(
        TABLE,
        sa.Column('id', uuid_type, primary_key=True),
        sa.Column('material_key', sa.String(100), nullable=False),
        sa.Column('label', sa.String(255), nullable=False),
        sa.Column('category', sa.String(50), nullable=False),
        sa.Column('unit', sa.String(10), nullable=False),
        sa.Column('unit_cost', sa.Float(), nullable=False,
                  server_default='0'),
        sa.Column('is_taxable', sa.Boolean(), server_default=sa.true()),
        sa.Column('is_active', sa.Boolean(), server_default=sa.true()),
        sa.Column('notes', sa.String(500), nullable=True),
        sa.Column('company_id', uuid_type, nullable=True),
        sa.Column('updated_by_id', uuid_type, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'],
                                ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by_id'], ['staff.id'],
                                ondelete='SET NULL'),
    )
    op.create_index('ix_roof_mat_prices_company', TABLE, ['company_id'])
    op.create_index('ix_roof_mat_prices_key', TABLE, ['material_key'])

    _seed_shared_defaults(conn, is_sqlite)


def _seed_shared_defaults(conn, is_sqlite: bool) -> None:
    """Insert the shared (company_id NULL) default cost rows.

    The catalog is imported rather than restated so the seeded values
    cannot drift from the constants the code falls back on. If the app
    package is not importable — some migration runners keep it off the
    path — the table is simply left empty rather than failing the
    migration; the UI is then seeded on first use.
    """
    try:
        from app.domains.roofing_estimate.material_price_book import (
            build_default_catalog,
        )
    except Exception:  # pragma: no cover - depends on runner's sys.path
        print(
            "rfg20260917pb03: app package not importable; "
            "roofing price book left empty (seeded lazily on first use)"
        )
        return

    entries = build_default_catalog()
    if not entries:
        return

    table = sa.table(
        TABLE,
        sa.column('id'),
        sa.column('material_key'),
        sa.column('label'),
        sa.column('category'),
        sa.column('unit'),
        sa.column('unit_cost'),
        sa.column('is_taxable'),
        sa.column('is_active'),
        sa.column('company_id'),
    )
    op.bulk_insert(table, [
        {
            # SQLite stores the UUID as text; Postgres takes it natively.
            'id': str(uuid.uuid4()) if is_sqlite else uuid.uuid4(),
            'material_key': e['material_key'],
            'label': e['label'],
            'category': e['category'],
            'unit': e['unit'],
            'unit_cost': e['unit_cost'],
            'is_taxable': True,
            'is_active': True,
            'company_id': None,
        }
        for e in entries
    ])


def downgrade() -> None:
    conn = op.get_bind()
    if _has_table(conn, TABLE):
        op.drop_table(TABLE)
