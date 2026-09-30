"""add roofing_pricing_settings (editable calculation rates)

The companion to roofing_material_prices, for every number the estimate
calculation uses that is NOT a supplier material cost: installed rates,
pitch and story multipliers, waste factors, sales tax, permit fees and
the fallback material portions. Those lived as constants in pricing.py,
so adjusting one meant a code change and a deploy.

Unlike the material price book, no rows are inserted here. A setting
resolves company row -> global row -> the pricing.py constant, so an
empty table behaves exactly as the code does today and the screen
renders the constants as its defaults. Only deliberate edits are ever
stored, which also means a later change to a default in pricing.py still
reaches every company that never overrode it.

Revision ID: rfg20260917ps10
Revises: rfg20260917sf09
Create Date: 2026-09-17
"""

from alembic import op
import sqlalchemy as sa

revision = 'rfg20260917ps10'
down_revision = 'rfg20260917sf09'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'roofing_pricing_settings' in inspector.get_table_names():
        return

    is_pg = bind.dialect.name == 'postgresql'
    uuid_type = sa.dialects.postgresql.UUID(as_uuid=True) if is_pg \
        else sa.String(36)

    op.create_table(
        'roofing_pricing_settings',
        sa.Column('id', uuid_type, primary_key=True),
        sa.Column('setting_group', sa.String(50), nullable=False),
        sa.Column('setting_key', sa.String(100), nullable=False),
        sa.Column('value', sa.Float(), nullable=False),
        sa.Column('default_value', sa.Float(), nullable=True),
        sa.Column('notes', sa.String(500), nullable=True),
        sa.Column('company_id', uuid_type, nullable=True),
        sa.Column('updated_by_id', uuid_type, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(
            ['company_id'], ['companies.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['updated_by_id'], ['staff.id'], ondelete='SET NULL'),
    )
    op.create_index(
        'ix_roof_pricing_company', 'roofing_pricing_settings', ['company_id'])
    op.create_index(
        'ix_roof_pricing_group', 'roofing_pricing_settings',
        ['setting_group'])
    # One row per setting per scope, so a save is an upsert rather than a
    # silent duplicate that shadows the value the screen just showed.
    op.create_unique_constraint(
        'uq_roof_pricing_scope_key', 'roofing_pricing_settings',
        ['company_id', 'setting_group', 'setting_key'])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'roofing_pricing_settings' not in inspector.get_table_names():
        return
    op.drop_constraint(
        'uq_roof_pricing_scope_key', 'roofing_pricing_settings',
        type_='unique')
    op.drop_index('ix_roof_pricing_group', 'roofing_pricing_settings')
    op.drop_index('ix_roof_pricing_company', 'roofing_pricing_settings')
    op.drop_table('roofing_pricing_settings')
