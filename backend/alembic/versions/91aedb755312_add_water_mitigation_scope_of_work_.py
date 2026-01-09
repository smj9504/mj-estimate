"""Add water mitigation scope of work tables

Revision ID: 91aedb755312
Revises: d5d3e463f2e
Create Date: 2026-01-08 16:14:16.591631

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '91aedb755312'
down_revision = 'd5d3e463f2e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create wm_demolition_types table
    op.create_table(
        'wm_demolition_types',
        sa.Column('id', sa.UUID(), nullable=False,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('category', sa.String(100), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('default_unit', sa.String(20), nullable=False,
                  server_default='SF'),
        sa.Column('material_weight_id', sa.UUID(), nullable=True),
        sa.Column('display_order', sa.Integer(), nullable=True,
                  server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=True,
                  server_default='true'),
        sa.Column('created_by_id', sa.UUID(), nullable=True),
        sa.Column('updated_by_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['material_weight_id'], ['material_weights.id'],
            ondelete='SET NULL'
        ),
        sa.ForeignKeyConstraint(['created_by_id'], ['staff.id']),
        sa.ForeignKeyConstraint(['updated_by_id'], ['staff.id']),
        sa.UniqueConstraint('name')
    )
    op.create_index(
        'ix_wm_demolition_types_active',
        'wm_demolition_types', ['is_active']
    )
    op.create_index(
        'ix_wm_demolition_types_category',
        'wm_demolition_types', ['category']
    )

    # Create wm_scope_locations table
    op.create_table(
        'wm_scope_locations',
        sa.Column('id', sa.UUID(), nullable=False,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('job_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('floor', sa.String(50), nullable=True),
        sa.Column('room_type', sa.String(100), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('display_order', sa.Integer(), nullable=True,
                  server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['job_id'], ['water_mitigation_jobs.id'],
            ondelete='CASCADE'
        )
    )
    op.create_index(
        'ix_wm_scope_locations_job',
        'wm_scope_locations', ['job_id']
    )
    op.create_index(
        'ix_wm_scope_locations_order',
        'wm_scope_locations', ['job_id', 'display_order']
    )

    # Create wm_scope_items table
    op.create_table(
        'wm_scope_items',
        sa.Column('id', sa.UUID(), nullable=False,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('location_id', sa.UUID(), nullable=False),
        sa.Column('item_type', sa.String(50), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('quantity', sa.DECIMAL(12, 4), nullable=True),
        sa.Column('quantity_formula', sa.String(500), nullable=True),
        sa.Column('unit', sa.String(20), nullable=False, server_default='SF'),
        sa.Column('demolition_type_id', sa.UUID(), nullable=True),
        sa.Column('include_in_debris', sa.Boolean(), nullable=True,
                  server_default='true'),
        sa.Column('moisture_level', sa.String(20), nullable=True,
                  server_default="'dry'"),
        sa.Column('display_order', sa.Integer(), nullable=True,
                  server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['location_id'], ['wm_scope_locations.id'],
            ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(
            ['demolition_type_id'], ['wm_demolition_types.id'],
            ondelete='SET NULL'
        )
    )
    op.create_index(
        'ix_wm_scope_items_location',
        'wm_scope_items', ['location_id']
    )
    op.create_index(
        'ix_wm_scope_items_type',
        'wm_scope_items', ['item_type']
    )

    # Create wm_debris_calculations table
    op.create_table(
        'wm_debris_calculations',
        sa.Column('id', sa.UUID(), nullable=False,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('job_id', sa.UUID(), nullable=False),
        sa.Column('total_weight_lb', sa.DECIMAL(12, 2), nullable=True),
        sa.Column('total_weight_ton', sa.DECIMAL(10, 4), nullable=True),
        sa.Column('category_breakdown', postgresql.JSONB(), nullable=True,
                  server_default='{}'),
        sa.Column('dumpster_recommendation', postgresql.JSONB(), nullable=True),
        sa.Column('item_details', postgresql.JSONB(), nullable=True,
                  server_default='[]'),
        sa.Column('calculated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=True),
        sa.Column('calculated_by_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['job_id'], ['water_mitigation_jobs.id'],
            ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(['calculated_by_id'], ['staff.id']),
        sa.UniqueConstraint('job_id')
    )
    op.create_index(
        'ix_wm_debris_calc_job',
        'wm_debris_calculations', ['job_id']
    )


def downgrade() -> None:
    op.drop_index('ix_wm_debris_calc_job', table_name='wm_debris_calculations')
    op.drop_table('wm_debris_calculations')

    op.drop_index('ix_wm_scope_items_type', table_name='wm_scope_items')
    op.drop_index('ix_wm_scope_items_location', table_name='wm_scope_items')
    op.drop_table('wm_scope_items')

    op.drop_index('ix_wm_scope_locations_order', table_name='wm_scope_locations')
    op.drop_index('ix_wm_scope_locations_job', table_name='wm_scope_locations')
    op.drop_table('wm_scope_locations')

    op.drop_index(
        'ix_wm_demolition_types_category', table_name='wm_demolition_types'
    )
    op.drop_index(
        'ix_wm_demolition_types_active', table_name='wm_demolition_types'
    )
    op.drop_table('wm_demolition_types')
