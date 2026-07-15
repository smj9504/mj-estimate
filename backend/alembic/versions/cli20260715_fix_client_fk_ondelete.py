"""fix client_id FK ondelete for contract_instances and pack_calculations

Revision ID: cli20260715fk01
Revises: sup20260715uq01
Create Date: 2026-07-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

# revision identifiers
revision = 'cli20260715fk01'
down_revision = 'sup20260715uq01'
branch_labels = None
depends_on = None


def _find_fk_name(conn, table, column, ref_table):
    """Find actual FK constraint name from pg catalog."""
    result = conn.execute(text("""
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = :table
          AND kcu.column_name = :column
          AND ccu.table_name = :ref_table
    """), {"table": table, "column": column, "ref_table": ref_table})
    row = result.fetchone()
    return row[0] if row else None


def _column_exists(conn, table, column):
    """Check if a column exists in a table."""
    result = conn.execute(text("""
        SELECT 1 FROM information_schema.columns
        WHERE table_name = :table AND column_name = :column
    """), {"table": table, "column": column})
    return result.fetchone() is not None


def _fix_fk(conn, table, column, ref_table, fk_name, ondelete):
    """Add column if missing, then fix FK constraint."""
    if not _column_exists(conn, table, column):
        conn.execute(text(
            f"ALTER TABLE {table} ADD COLUMN {column} UUID"
        ))

    fk = _find_fk_name(conn, table, column, ref_table)
    if fk:
        op.drop_constraint(fk, table, type_='foreignkey')

    op.create_foreign_key(
        fk_name, table, ref_table,
        [column], ['id'], ondelete=ondelete,
    )


def upgrade():
    conn = op.get_bind()

    _fix_fk(conn, 'contract_instances', 'client_id', 'clients',
            'contract_instances_client_id_fkey', 'SET NULL')

    _fix_fk(conn, 'pack_calculations', 'client_id', 'clients',
            'pack_calculations_client_id_fkey', 'SET NULL')


def downgrade():
    conn = op.get_bind()

    fk = _find_fk_name(
        conn, 'contract_instances', 'client_id', 'clients')
    if fk:
        op.drop_constraint(fk, 'contract_instances', type_='foreignkey')
    op.create_foreign_key(
        'contract_instances_client_id_fkey', 'contract_instances',
        'clients', ['client_id'], ['id']
    )

    fk = _find_fk_name(
        conn, 'pack_calculations', 'client_id', 'clients')
    if fk:
        op.drop_constraint(fk, 'pack_calculations', type_='foreignkey')
    op.create_foreign_key(
        'pack_calculations_client_id_fkey', 'pack_calculations',
        'clients', ['client_id'], ['id']
    )
