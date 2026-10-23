"""add invoice_id to wm_documents

Saving a generated invoice's PDF deactivated every Invoice document of the
job, so a job with two invoices only ever kept one PDF, and an uploaded
invoice disappeared too. invoice_id records which invoice a saved PDF is
of, so saving it again replaces only that invoice's earlier PDF.

PDFs saved before this are matched to their invoice by the title they were
saved under ("Invoice <number>"). Uploaded invoices are left unlinked.

Revision ID: wm20261023inv01
Revises: wm20261023cy01
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'wm20261023inv01'
down_revision = 'wm20261023cy01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'wm_documents',
        sa.Column('invoice_id', UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        'ix_wm_documents_invoice', 'wm_documents', ['invoice_id']
    )

    op.get_bind().execute(sa.text(
        "UPDATE wm_documents d SET invoice_id = si.invoice_id "
        "FROM wm_scope_invoices si "
        "JOIN invoices i ON i.id = si.invoice_id "
        "WHERE si.job_id = d.job_id "
        "AND d.invoice_id IS NULL "
        "AND d.document_type IN ('Invoice', 'invoice') "
        "AND COALESCE(d.upload_source, 'generated') <> 'manual_upload' "
        "AND d.title = 'Invoice ' || i.invoice_number"
    ))


def downgrade() -> None:
    op.drop_index('ix_wm_documents_invoice', table_name='wm_documents')
    op.drop_column('wm_documents', 'invoice_id')
