"""Add acculynx_contact_links table (client -> AccuLynx contact reuse)

Self-contained AccuLynx module - see
backend/app/domains/integrations/acculynx/__init__.py for the removal
checklist. Only this new table is created; no existing table is altered.

Revision ID: al20260811b
Revises: al20260811
Create Date: 2026-08-11

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = 'al20260811b'
down_revision = 'al20260811'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'acculynx_contact_links',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('client_id', UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column('acculynx_contact_id', sa.String(100), nullable=False),
        sa.Column('linked_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_acculynx_contact_links_client_id', 'acculynx_contact_links', ['client_id'])


def downgrade() -> None:
    op.drop_index('ix_acculynx_contact_links_client_id', table_name='acculynx_contact_links')
    op.drop_table('acculynx_contact_links')
