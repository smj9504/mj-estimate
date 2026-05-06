"""Add company_id and claim_id to pack_calculations

Revision ID: j1k2l3m4n5o6
Revises: i9j0k1l2m3n4
Create Date: 2026-05-06

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = 'j1k2l3m4n5o6'
down_revision = 'i9j0k1l2m3n4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('pack_calculations', sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=True))
    op.add_column('pack_calculations', sa.Column('claim_id', UUID(as_uuid=True), sa.ForeignKey('claims.id'), nullable=True))
    op.create_index('ix_pack_calculations_company', 'pack_calculations', ['company_id'])


def downgrade() -> None:
    op.drop_index('ix_pack_calculations_company', table_name='pack_calculations')
    op.drop_column('pack_calculations', 'claim_id')
    op.drop_column('pack_calculations', 'company_id')
