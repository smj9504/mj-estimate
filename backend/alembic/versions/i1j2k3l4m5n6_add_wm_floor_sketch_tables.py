"""Add WM floor sketch tables

Revision ID: i1j2k3l4m5n6
Revises: h1a2b3c4d5e7
Create Date: 2026-03-31

Creates five tables for the Water Mitigation Sketch feature:
  - wm_floor_sketches        (one canvas per floor per job)
  - wm_demolition_zones      (overlay: demolition rectangles)
  - wm_equipment_placements  (overlay: drying equipment icons)
  - wm_containment_zones     (overlay: containment rectangles)
  - wm_floor_protections     (overlay: floor protection strips)
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'i1j2k3l4m5n6'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -------------------------------------------------------------------------
    # wm_floor_sketches
    # -------------------------------------------------------------------------
    op.create_table(
        'wm_floor_sketches',
        sa.Column(
            'id',
            sa.UUID(),
            nullable=False,
            server_default=sa.text('gen_random_uuid()'),
        ),
        sa.Column('job_id', sa.UUID(), nullable=False),
        sa.Column('floor_label', sa.String(length=100), nullable=False),
        sa.Column(
            'floor_order',
            sa.Integer(),
            nullable=False,
            server_default='0',
        ),
        sa.Column('address_display', sa.String(length=500), nullable=True),
        sa.Column(
            'source_type',
            sa.String(length=20),
            nullable=False,
            server_default='sketch',
        ),
        sa.Column('sketch_id', sa.UUID(), nullable=True),
        sa.Column(
            'background_image_url',
            sa.String(length=1000),
            nullable=True,
        ),
        sa.Column(
            'canvas_width',
            sa.Integer(),
            nullable=False,
            server_default='1200',
        ),
        sa.Column(
            'canvas_height',
            sa.Integer(),
            nullable=False,
            server_default='900',
        ),
        sa.Column(
            'scale_pixels_per_foot',
            sa.Float(),
            nullable=False,
            server_default='20.0',
        ),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column(
            'overlay_data',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default='{}',
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['job_id'],
            ['water_mitigation_jobs.id'],
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['sketch_id'],
            ['sketches.id'],
            ondelete='SET NULL',
        ),
    )
    op.create_index(
        'ix_wm_floor_sketches_id',
        'wm_floor_sketches',
        ['id'],
        unique=False,
    )
    op.create_index(
        'ix_wm_floor_sketches_job_id',
        'wm_floor_sketches',
        ['job_id'],
        unique=False,
    )
    op.create_index(
        'ix_wm_floor_sketches_job_order',
        'wm_floor_sketches',
        ['job_id', 'floor_order'],
        unique=False,
    )

    # -------------------------------------------------------------------------
    # wm_demolition_zones
    # -------------------------------------------------------------------------
    op.create_table(
        'wm_demolition_zones',
        sa.Column(
            'id',
            sa.UUID(),
            nullable=False,
            server_default=sa.text('gen_random_uuid()'),
        ),
        sa.Column('floor_sketch_id', sa.UUID(), nullable=False),
        sa.Column('material_type', sa.String(length=100), nullable=False),
        sa.Column('surface', sa.String(length=50), nullable=False),
        sa.Column('color', sa.String(length=7), nullable=False),
        sa.Column('x', sa.Float(), nullable=False),
        sa.Column('y', sa.Float(), nullable=False),
        sa.Column(
            'dimension1_ft',
            sa.Numeric(precision=10, scale=4),
            nullable=False,
        ),
        sa.Column(
            'dimension2_ft',
            sa.Numeric(precision=10, scale=4),
            nullable=False,
        ),
        sa.Column(
            'rotation',
            sa.Float(),
            nullable=False,
            server_default='0',
        ),
        sa.Column(
            'calculated_sqft',
            sa.Numeric(precision=12, scale=2),
            nullable=False,
        ),
        sa.Column('label', sa.String(length=255), nullable=True),
        sa.Column(
            'display_order',
            sa.Integer(),
            nullable=False,
            server_default='0',
        ),
        sa.Column('scope_item_id', sa.UUID(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['floor_sketch_id'],
            ['wm_floor_sketches.id'],
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['scope_item_id'],
            ['wm_scope_items.id'],
            ondelete='SET NULL',
        ),
    )
    op.create_index(
        'ix_wm_demolition_zones_id',
        'wm_demolition_zones',
        ['id'],
        unique=False,
    )
    op.create_index(
        'ix_wm_demolition_zones_floor_sketch',
        'wm_demolition_zones',
        ['floor_sketch_id'],
        unique=False,
    )

    # -------------------------------------------------------------------------
    # wm_equipment_placements
    # -------------------------------------------------------------------------
    op.create_table(
        'wm_equipment_placements',
        sa.Column(
            'id',
            sa.UUID(),
            nullable=False,
            server_default=sa.text('gen_random_uuid()'),
        ),
        sa.Column('floor_sketch_id', sa.UUID(), nullable=False),
        sa.Column('equipment_type', sa.String(length=100), nullable=False),
        sa.Column('x', sa.Float(), nullable=False),
        sa.Column('y', sa.Float(), nullable=False),
        sa.Column('icon_shape', sa.String(length=50), nullable=False),
        sa.Column('color', sa.String(length=7), nullable=False),
        sa.Column('label', sa.String(length=255), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['floor_sketch_id'],
            ['wm_floor_sketches.id'],
            ondelete='CASCADE',
        ),
    )
    op.create_index(
        'ix_wm_equipment_placements_id',
        'wm_equipment_placements',
        ['id'],
        unique=False,
    )
    op.create_index(
        'ix_wm_equipment_placements_floor_sketch',
        'wm_equipment_placements',
        ['floor_sketch_id'],
        unique=False,
    )

    # -------------------------------------------------------------------------
    # wm_containment_zones
    # -------------------------------------------------------------------------
    op.create_table(
        'wm_containment_zones',
        sa.Column(
            'id',
            sa.UUID(),
            nullable=False,
            server_default=sa.text('gen_random_uuid()'),
        ),
        sa.Column('floor_sketch_id', sa.UUID(), nullable=False),
        sa.Column(
            'containment_type',
            sa.String(length=100),
            nullable=False,
            server_default='No zipper',
        ),
        sa.Column('x', sa.Float(), nullable=False),
        sa.Column('y', sa.Float(), nullable=False),
        sa.Column(
            'width_ft',
            sa.Numeric(precision=10, scale=4),
            nullable=True,
        ),
        sa.Column(
            'height_ft',
            sa.Numeric(precision=10, scale=4),
            nullable=True,
        ),
        sa.Column(
            'calculated_sqft',
            sa.Numeric(precision=12, scale=2),
            nullable=False,
        ),
        sa.Column(
            'color',
            sa.String(length=7),
            nullable=False,
            server_default='#0066FF',
        ),
        sa.Column('label', sa.String(length=255), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['floor_sketch_id'],
            ['wm_floor_sketches.id'],
            ondelete='CASCADE',
        ),
    )
    op.create_index(
        'ix_wm_containment_zones_id',
        'wm_containment_zones',
        ['id'],
        unique=False,
    )
    op.create_index(
        'ix_wm_containment_zones_floor_sketch',
        'wm_containment_zones',
        ['floor_sketch_id'],
        unique=False,
    )

    # -------------------------------------------------------------------------
    # wm_floor_protections
    # -------------------------------------------------------------------------
    op.create_table(
        'wm_floor_protections',
        sa.Column(
            'id',
            sa.UUID(),
            nullable=False,
            server_default=sa.text('gen_random_uuid()'),
        ),
        sa.Column('floor_sketch_id', sa.UUID(), nullable=False),
        sa.Column(
            'protection_type',
            sa.String(length=100),
            nullable=False,
            server_default='Heavy duty paper & tape',
        ),
        sa.Column(
            'paper_width_ft',
            sa.Float(),
            nullable=False,
            server_default='3.0',
        ),
        sa.Column('x', sa.Float(), nullable=False),
        sa.Column('y', sa.Float(), nullable=False),
        sa.Column(
            'length_ft',
            sa.Numeric(precision=10, scale=4),
            nullable=False,
        ),
        sa.Column(
            'rotation',
            sa.Float(),
            nullable=False,
            server_default='0',
        ),
        sa.Column(
            'calculated_sqft',
            sa.Numeric(precision=12, scale=2),
            nullable=False,
        ),
        sa.Column(
            'color',
            sa.String(length=7),
            nullable=False,
            server_default='#FFD700',
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['floor_sketch_id'],
            ['wm_floor_sketches.id'],
            ondelete='CASCADE',
        ),
    )
    op.create_index(
        'ix_wm_floor_protections_id',
        'wm_floor_protections',
        ['id'],
        unique=False,
    )
    op.create_index(
        'ix_wm_floor_protections_floor_sketch',
        'wm_floor_protections',
        ['floor_sketch_id'],
        unique=False,
    )


def downgrade() -> None:
    # Drop in reverse dependency order (child tables first)
    op.drop_index(
        'ix_wm_floor_protections_floor_sketch',
        table_name='wm_floor_protections',
    )
    op.drop_index(
        'ix_wm_floor_protections_id',
        table_name='wm_floor_protections',
    )
    op.drop_table('wm_floor_protections')

    op.drop_index(
        'ix_wm_containment_zones_floor_sketch',
        table_name='wm_containment_zones',
    )
    op.drop_index(
        'ix_wm_containment_zones_id',
        table_name='wm_containment_zones',
    )
    op.drop_table('wm_containment_zones')

    op.drop_index(
        'ix_wm_equipment_placements_floor_sketch',
        table_name='wm_equipment_placements',
    )
    op.drop_index(
        'ix_wm_equipment_placements_id',
        table_name='wm_equipment_placements',
    )
    op.drop_table('wm_equipment_placements')

    op.drop_index(
        'ix_wm_demolition_zones_floor_sketch',
        table_name='wm_demolition_zones',
    )
    op.drop_index(
        'ix_wm_demolition_zones_id',
        table_name='wm_demolition_zones',
    )
    op.drop_table('wm_demolition_zones')

    op.drop_index(
        'ix_wm_floor_sketches_job_order',
        table_name='wm_floor_sketches',
    )
    op.drop_index(
        'ix_wm_floor_sketches_job_id',
        table_name='wm_floor_sketches',
    )
    op.drop_index(
        'ix_wm_floor_sketches_id',
        table_name='wm_floor_sketches',
    )
    op.drop_table('wm_floor_sketches')
