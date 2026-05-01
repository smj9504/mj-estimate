"""Add warranty_info column to roofing_estimates

Revision ID: g7h8i9j0k1l2
Revises: f6g7h8i9j0k1
Create Date: 2026-05-01

Adds warranty_info JSONB column to roofing_estimates table for
customizable material and labor warranty text.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'g7h8i9j0k1l2'
down_revision = 'f6g7h8i9j0k1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    json_type = postgresql.JSONB() if is_pg else sa.JSON()

    op.add_column(
        'roofing_estimates',
        sa.Column('warranty_info', json_type, nullable=True),
    )


def downgrade() -> None:
    op.drop_column('roofing_estimates', 'warranty_info')
