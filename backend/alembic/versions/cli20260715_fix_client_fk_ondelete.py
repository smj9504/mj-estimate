"""fix client_id FK ondelete for contract_instances and pack_calculations

Revision ID: cli20260715fk01
Revises: sup20260715uq01
Create Date: 2026-07-15
"""
from alembic import op
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


def upgrade():
    conn = op.get_bind()

    # contract_instances.client_id -> ADD ondelete SET NULL
    fk = _find_fk_name(conn, 'contract_instances', 'client_id', 'clients')
    if fk:
        op.drop_constraint(fk, 'contract_instances', type_='foreignkey')
    op.create_foreign_key(
        'contract_instances_client_id_fkey', 'contract_instances',
        'clients', ['client_id'], ['id'], ondelete='SET NULL'
    )

    # pack_calculations.client_id -> ADD ondelete SET NULL
    fk = _find_fk_name(conn, 'pack_calculations', 'client_id', 'clients')
    if fk:
        op.drop_constraint(fk, 'pack_calculations', type_='foreignkey')
    op.create_foreign_key(
        'pack_calculations_client_id_fkey', 'pack_calculations',
        'clients', ['client_id'], ['id'], ondelete='SET NULL'
    )


def downgrade():
    conn = op.get_bind()

    fk = _find_fk_name(conn, 'contract_instances', 'client_id', 'clients')
    if fk:
        op.drop_constraint(fk, 'contract_instances', type_='foreignkey')
    op.create_foreign_key(
        'contract_instances_client_id_fkey', 'contract_instances',
        'clients', ['client_id'], ['id']
    )

    fk = _find_fk_name(conn, 'pack_calculations', 'client_id', 'clients')
    if fk:
        op.drop_constraint(fk, 'pack_calculations', type_='foreignkey')
    op.create_foreign_key(
        'pack_calculations_client_id_fkey', 'pack_calculations',
        'clients', ['client_id'], ['id']
    )
