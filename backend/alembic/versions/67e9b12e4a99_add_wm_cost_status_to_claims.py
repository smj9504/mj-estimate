"""Add wm_cost_status to claims

Revision ID: 67e9b12e4a99
Revises: j1k2l3m4n5o6, 363ad6f0697d
Create Date: 2026-05-07

Merges two heads and adds WM cost tracking columns.
"""

from alembic import op
import sqlalchemy as sa


revision = '67e9b12e4a99'
down_revision = ('j1k2l3m4n5o6', '363ad6f0697d')
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('claims', sa.Column(
        'wm_cost_status',
        sa.String(50),
        nullable=True,
        comment=(
            'included_in_rebuild | separate_estimate'
            ' | not_received | not_applicable'
        ),
    ))
    op.add_column('claims', sa.Column(
        'wm_estimate_amount',
        sa.Numeric(15, 2),
        nullable=True,
        comment='WM amount if received separately',
    ))


def downgrade():
    op.drop_column('claims', 'wm_estimate_amount')
    op.drop_column('claims', 'wm_cost_status')
