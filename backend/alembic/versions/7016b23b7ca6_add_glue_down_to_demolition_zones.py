"""Add glue_down column to wm_demolition_zones

Revision ID: 7016b23b7ca6
Revises: 9f105c157914
Create Date: 2026-05-08

Adds boolean glue_down flag for floor demolition zones where
flooring is glued to substrate, requiring extra removal cost.
"""

from alembic import op
import sqlalchemy as sa


revision = '7016b23b7ca6'
down_revision = '9f105c157914'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'wm_demolition_zones',
        sa.Column(
            'glue_down',
            sa.Boolean(),
            nullable=False,
            server_default='false',
        ),
    )


def downgrade():
    op.drop_column('wm_demolition_zones', 'glue_down')
