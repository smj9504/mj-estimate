"""fix client_id FK ondelete for contract_instances and pack_calculations

Revision ID: cli20260715fk01
Revises: sup20260715_add_active_supplement_unique_index
Create Date: 2026-07-15
"""
from alembic import op

# revision identifiers
revision = 'cli20260715fk01'
down_revision = 'sup20260715_add_active_supplement_unique_index'
branch_labels = None
depends_on = None


def upgrade():
    # contract_instances.client_id -> ADD ondelete SET NULL
    op.drop_constraint(
        'contract_instances_client_id_fkey', 'contract_instances', type_='foreignkey'
    )
    op.create_foreign_key(
        'contract_instances_client_id_fkey', 'contract_instances',
        'clients', ['client_id'], ['id'], ondelete='SET NULL'
    )

    # pack_calculations.client_id -> ADD ondelete SET NULL
    op.drop_constraint(
        'pack_calculations_client_id_fkey', 'pack_calculations', type_='foreignkey'
    )
    op.create_foreign_key(
        'pack_calculations_client_id_fkey', 'pack_calculations',
        'clients', ['client_id'], ['id'], ondelete='SET NULL'
    )


def downgrade():
    # Revert contract_instances
    op.drop_constraint(
        'contract_instances_client_id_fkey', 'contract_instances', type_='foreignkey'
    )
    op.create_foreign_key(
        'contract_instances_client_id_fkey', 'contract_instances',
        'clients', ['client_id'], ['id']
    )

    # Revert pack_calculations
    op.drop_constraint(
        'pack_calculations_client_id_fkey', 'pack_calculations', type_='foreignkey'
    )
    op.create_foreign_key(
        'pack_calculations_client_id_fkey', 'pack_calculations',
        'clients', ['client_id'], ['id']
    )
