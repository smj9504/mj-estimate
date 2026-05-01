"""Add multi-structure support to roofing estimates

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-05-01

Adds:
- structure_results JSONB to roofing_estimates
- structure_index INT to roofing_estimate_line_items
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'i9j0k1l2m3n4'
down_revision = 'h8i9j0k1l2m3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB() if is_pg else sa.JSON()

    op.add_column(
        'roofing_estimates',
        sa.Column(
            'structure_results', json_type,
            nullable=True,
        ),
    )
    op.add_column(
        'roofing_estimate_line_items',
        sa.Column(
            'structure_index', sa.Integer(),
            server_default='0', nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column(
        'roofing_estimate_line_items',
        'structure_index',
    )
    op.drop_column(
        'roofing_estimates',
        'structure_results',
    )
