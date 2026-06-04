"""add company_id to rebuild_contractors

Revision ID: h8i9j0k1l2m4
Revises: g6h7i8j9k0l2
Create Date: 2026-06-04

"""
from alembic import op
import sqlalchemy as sa
from app.core.database_types import UUIDType

# revision identifiers
revision = 'h8i9j0k1l2m4'
down_revision = 'g6h7i8j9k0l2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'rebuild_contractors',
        sa.Column('company_id', UUIDType(), sa.ForeignKey('companies.id', ondelete='SET NULL'), nullable=True)
    )
    op.create_unique_constraint(
        'uq_rebuild_contractors_company_id',
        'rebuild_contractors',
        ['company_id']
    )


def downgrade() -> None:
    op.drop_constraint('uq_rebuild_contractors_company_id', 'rebuild_contractors', type_='unique')
    op.drop_column('rebuild_contractors', 'company_id')
