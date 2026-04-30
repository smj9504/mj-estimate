"""Merge heads + Add location column to cabinet_boxes and line_items

Revision ID: a1b2c3d4e5f7
Revises: z7a8b9c0d1e2
Create Date: 2026-04-30
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f7'
down_revision = ('z7a8b9c0d1e2', 'b9c0d1e2f3g4')
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'cabinet_boxes',
        sa.Column(
            'location',
            sa.String(20),
            nullable=False,
            server_default='perimeter',
        ),
    )
    op.add_column(
        'cabinet_estimate_line_items',
        sa.Column(
            'location',
            sa.String(20),
            nullable=False,
            server_default='perimeter',
        ),
    )


def downgrade() -> None:
    op.drop_column('cabinet_estimate_line_items', 'location')
    op.drop_column('cabinet_boxes', 'location')
