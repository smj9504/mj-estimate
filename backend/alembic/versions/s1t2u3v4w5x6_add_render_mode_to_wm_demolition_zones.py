"""Add render_mode, stroke_style, fill_opacity to wm_demolition_zones

Revision ID: s1t2u3v4w5x6
Revises: r0s1t2u3v4w5
Create Date: 2026-04-15

Adds visual rendering properties to demolition zones:
  - render_mode VARCHAR(20): area, line, shape, text
  - stroke_style VARCHAR(20): solid, dashed, dotted
  - fill_opacity FLOAT: 0-1
"""

from alembic import op
import sqlalchemy as sa

revision = 's1t2u3v4w5x6'
down_revision = 'r0s1t2u3v4w5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'wm_demolition_zones',
        sa.Column('render_mode', sa.String(20), nullable=True)
    )
    op.add_column(
        'wm_demolition_zones',
        sa.Column('stroke_style', sa.String(20), nullable=True)
    )
    op.add_column(
        'wm_demolition_zones',
        sa.Column('fill_opacity', sa.Float, nullable=True)
    )


def downgrade() -> None:
    op.drop_column('wm_demolition_zones', 'fill_opacity')
    op.drop_column('wm_demolition_zones', 'stroke_style')
    op.drop_column('wm_demolition_zones', 'render_mode')
