"""Add wm_content_manipulations table (hours unit)

Revision ID: wm20260624cm01
Revises: h9i0j1k2l3m4
Create Date: 2026-06-24

Creates wm_content_manipulations table with hours column.
If the table already exists (created with calculated_sqft), migrates the column.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'wm20260624cm01'
down_revision = 'h9i0j1k2l3m4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'wm_content_manipulations' not in existing_tables:
        # Fresh install: create table with hours column
        op.create_table(
            'wm_content_manipulations',
            sa.Column('id', postgresql.UUID(),
                      nullable=False, server_default=sa.text('gen_random_uuid()')),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True),
                      nullable=True),
            sa.Column('floor_sketch_id', postgresql.UUID(),
                      nullable=False),
            sa.Column('manipulation_type', sa.String(100),
                      nullable=False, server_default='Move out'),
            sa.Column('x', sa.Float(), nullable=False),
            sa.Column('y', sa.Float(), nullable=False),
            sa.Column('width_ft', sa.DECIMAL(10, 4), nullable=False),
            sa.Column('length_ft', sa.DECIMAL(10, 4), nullable=False),
            sa.Column('rotation', sa.Float(), nullable=False,
                      server_default='0'),
            sa.Column('hours', sa.DECIMAL(10, 2),
                      nullable=False, server_default='1.0'),
            sa.Column('color', sa.String(7), nullable=False,
                      server_default='#F97316'),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(
                ['floor_sketch_id'],
                ['wm_floor_sketches.id'],
                ondelete='CASCADE',
            ),
        )
        op.create_index(
            'ix_wm_content_manipulations_floor_sketch',
            'wm_content_manipulations',
            ['floor_sketch_id'],
        )
    else:
        # Table already exists: migrate calculated_sqft -> hours if needed
        existing_columns = [
            c['name'] for c in inspector.get_columns('wm_content_manipulations')
        ]

        if 'hours' not in existing_columns:
            op.add_column(
                'wm_content_manipulations',
                sa.Column('hours', sa.DECIMAL(10, 2),
                          nullable=False, server_default='1.0'),
            )

        if 'calculated_sqft' in existing_columns:
            op.drop_column('wm_content_manipulations', 'calculated_sqft')

        # Create index if missing
        existing_indexes = [
            idx['name']
            for idx in inspector.get_indexes('wm_content_manipulations')
        ]
        if 'ix_wm_content_manipulations_floor_sketch' not in existing_indexes:
            op.create_index(
                'ix_wm_content_manipulations_floor_sketch',
                'wm_content_manipulations',
                ['floor_sketch_id'],
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_columns = [
        c['name'] for c in inspector.get_columns('wm_content_manipulations')
    ]

    if 'calculated_sqft' not in existing_columns:
        op.add_column(
            'wm_content_manipulations',
            sa.Column('calculated_sqft', sa.DECIMAL(12, 2),
                      nullable=False, server_default='0'),
        )

    if 'hours' in existing_columns:
        op.drop_column('wm_content_manipulations', 'hours')
