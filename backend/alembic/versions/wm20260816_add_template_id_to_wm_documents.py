"""Add template_id to wm_documents

Revision ID: wm20260816td01
Revises: al20260811b
Create Date: 2026-08-16

Adds template_id (nullable FK -> contract_templates.id) so a WMDocument
generated from a ContractTemplate can be traced back to it. This lets the
document re-edit flow re-derive signature/initial field placements from
the template's field_mappings, instead of only knowing them at initial
generation time.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = 'wm20260816td01'
down_revision = 'al20260811b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'wm_documents',
        sa.Column('template_id', UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        'ix_wm_documents_template', 'wm_documents', ['template_id']
    )
    op.create_foreign_key(
        'fk_wm_documents_template_id',
        'wm_documents', 'contract_templates',
        ['template_id'], ['id'],
    )


def downgrade() -> None:
    op.drop_constraint(
        'fk_wm_documents_template_id', 'wm_documents', type_='foreignkey'
    )
    op.drop_index('ix_wm_documents_template', table_name='wm_documents')
    op.drop_column('wm_documents', 'template_id')
