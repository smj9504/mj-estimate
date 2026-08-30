"""Add cabinet_sketches table

Revision ID: cab20260831sk01
Revises: cab20260828ml01
Create Date: 2026-08-31

One optional canvas per cabinet estimate for visualizing cabinet layout.
No child tables — walls and placed cabinets live only in the overlay_data
JSONB column, mirroring the JSONB-only precedent already used for the
water mitigation sketch's shapes/walls/rooms.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'cab20260831sk01'
down_revision = 'cab20260828ml01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'cabinet_sketches',
        sa.Column(
            'id',
            sa.UUID(),
            nullable=False,
            server_default=sa.text('gen_random_uuid()'),
        ),
        sa.Column('estimate_id', sa.UUID(), nullable=False),
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
            ['estimate_id'],
            ['cabinet_estimates.id'],
            ondelete='CASCADE',
        ),
    )
    op.create_index(
        'ix_cabinet_sketches_id',
        'cabinet_sketches',
        ['id'],
        unique=False,
    )
    op.create_index(
        'ix_cabinet_sketches_estimate_id',
        'cabinet_sketches',
        ['estimate_id'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index('ix_cabinet_sketches_estimate_id', table_name='cabinet_sketches')
    op.drop_index('ix_cabinet_sketches_id', table_name='cabinet_sketches')
    op.drop_table('cabinet_sketches')
