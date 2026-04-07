"""Add content protection table and containment line fields

Revision ID: l4m5n6o7p8q9
Revises: k3l4m5n6o7p8
Create Date: 2026-04-06

Adds:
  - wm_content_protections table (content/furniture protection areas)
  - length_ft, rotation columns to wm_containment_zones (line model)
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'l4m5n6o7p8q9'
down_revision = 'k3l4m5n6o7p8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add length_ft and rotation to containment zones (line model)
    op.add_column(
        'wm_containment_zones',
        sa.Column('length_ft', sa.DECIMAL(10, 4), nullable=True),
    )
    op.add_column(
        'wm_containment_zones',
        sa.Column('rotation', sa.Float(), nullable=True, server_default='0'),
    )

    # Create content protections table
    op.create_table(
        'wm_content_protections',
        sa.Column('id', sa.dialects.postgresql.UUID(),
                  nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  nullable=True),
        sa.Column('floor_sketch_id', sa.dialects.postgresql.UUID(),
                  nullable=False),
        sa.Column('protection_type', sa.String(100),
                  nullable=False, server_default='Plastic sheeting'),
        sa.Column('x', sa.Float(), nullable=False),
        sa.Column('y', sa.Float(), nullable=False),
        sa.Column('width_ft', sa.DECIMAL(10, 4), nullable=False),
        sa.Column('length_ft', sa.DECIMAL(10, 4), nullable=False),
        sa.Column('rotation', sa.Float(), nullable=False,
                  server_default='0'),
        sa.Column('calculated_sqft', sa.DECIMAL(12, 2),
                  nullable=False),
        sa.Column('color', sa.String(7), nullable=False,
                  server_default='#8B5CF6'),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['floor_sketch_id'],
            ['wm_floor_sketches.id'],
            ondelete='CASCADE',
        ),
    )
    op.create_index(
        'ix_wm_content_protections_floor_sketch',
        'wm_content_protections',
        ['floor_sketch_id'],
    )


def downgrade() -> None:
    op.drop_index(
        'ix_wm_content_protections_floor_sketch',
        table_name='wm_content_protections',
    )
    op.drop_table('wm_content_protections')
    op.drop_column('wm_containment_zones', 'rotation')
    op.drop_column('wm_containment_zones', 'length_ft')
