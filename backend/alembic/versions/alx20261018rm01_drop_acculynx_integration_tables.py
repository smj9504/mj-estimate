"""drop the outbound AccuLynx integration tables

The AccuLynx account is closed, so the "send claim files to AccuLynx" feature
(app/domains/integrations/acculynx) is gone. Its three tables only linked
claims/clients to AccuLynx ids and logged uploads; the archived jobs live in
acculynx_archived_* and are untouched.

Revision ID: alx20261018rm01
Revises: cl20261017src01
Create Date: 2026-10-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'alx20261018rm01'
down_revision = 'cl20261017src01'
branch_labels = None
depends_on = None


TABLES = ('acculynx_uploads', 'acculynx_contact_links', 'acculynx_job_links')


def upgrade() -> None:
    for table in TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table}")


def downgrade() -> None:
    # Recreates the empty tables only; the rows are not recoverable
    op.create_table(
        'acculynx_job_links',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('claim_id', UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column('acculynx_job_id', sa.String(100), nullable=False),
        sa.Column('acculynx_job_number', sa.String(50)),
        sa.Column('linked_at', sa.DateTime(), nullable=False),
    )
    op.create_table(
        'acculynx_contact_links',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('client_id', UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column('acculynx_contact_id', sa.String(100), nullable=False),
        sa.Column('linked_at', sa.DateTime(), nullable=False),
    )
    op.create_table(
        'acculynx_uploads',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('claim_id', UUID(as_uuid=True), nullable=False),
        sa.Column('acculynx_job_id', sa.String(100), nullable=False),
        sa.Column('source_table', sa.String(20), nullable=False),
        sa.Column('source_id', UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column('filename', sa.String(500)),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('error_message', sa.Text()),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('uploaded_at', sa.DateTime()),
    )
