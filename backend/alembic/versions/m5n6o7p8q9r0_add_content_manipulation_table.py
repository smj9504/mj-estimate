"""Add content manipulation table

Revision ID: m5n6o7p8q9r0
Revises: l4m5n6o7p8q9
Create Date: 2026-06-23

Adds:
  - wm_content_manipulations table (content/furniture movement areas)
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'm5n6o7p8q9r0'
down_revision = 'l4m5n6o7p8q9'
branch_labels = None
depends_on = None


def upgrade() -> None:
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


def downgrade() -> None:
    op.drop_index(
        'ix_wm_content_manipulations_floor_sketch',
        table_name='wm_content_manipulations',
    )
    op.drop_table('wm_content_manipulations')
