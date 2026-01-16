"""Add WM scope invoice tables

Revision ID: 5d6e7f8a9b0c
Revises: 4cfe38439ba8
Create Date: 2025-01-15 04:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '5d6e7f8a9b0c'
down_revision: Union[str, None] = '4cfe38439ba8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create wm_scope_invoices table - links WM Job to Invoice
    op.create_table(
        'wm_scope_invoices',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('job_id', postgresql.UUID(as_uuid=True), nullable=False, comment='Water mitigation job reference'),
        sa.Column('invoice_id', postgresql.UUID(as_uuid=True), nullable=False, comment='Generated invoice reference'),
        sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('generated_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True, comment='Optional notes about this invoice generation'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['job_id'], ['water_mitigation_jobs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['invoice_id'], ['invoices.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['generated_by_id'], ['staff.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_wm_scope_invoices_job', 'wm_scope_invoices', ['job_id'])
    op.create_index('ix_wm_scope_invoices_invoice', 'wm_scope_invoices', ['invoice_id'])

    # Create wm_scope_item_invoice_links table - links scope items to invoice line items
    op.create_table(
        'wm_scope_item_invoice_links',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('wm_scope_invoice_id', postgresql.UUID(as_uuid=True), nullable=False, comment='Parent scope invoice record'),
        sa.Column('scope_item_id', postgresql.UUID(as_uuid=True), nullable=False, comment='WM Scope item reference'),
        sa.Column('invoice_item_id', postgresql.UUID(as_uuid=True), nullable=False, comment='Invoice line item reference'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['wm_scope_invoice_id'], ['wm_scope_invoices.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['scope_item_id'], ['wm_scope_items.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['invoice_item_id'], ['invoice_items.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_wm_scope_item_invoice_links_scope_invoice', 'wm_scope_item_invoice_links', ['wm_scope_invoice_id'])
    op.create_index('ix_wm_scope_item_invoice_links_scope_item', 'wm_scope_item_invoice_links', ['scope_item_id'])
    op.create_index('ix_wm_scope_item_invoice_links_invoice_item', 'wm_scope_item_invoice_links', ['invoice_item_id'])

    # Add invoiced tracking columns to wm_scope_items
    op.add_column('wm_scope_items', sa.Column('invoiced', sa.Boolean(), nullable=True, default=False, comment='Whether this item has been invoiced'))
    op.add_column('wm_scope_items', sa.Column('invoiced_at', sa.DateTime(timezone=True), nullable=True, comment='When this item was invoiced'))

    # Set default value for existing records
    op.execute("UPDATE wm_scope_items SET invoiced = false WHERE invoiced IS NULL")

    # Create index for invoiced status queries
    op.create_index('ix_wm_scope_items_invoiced', 'wm_scope_items', ['invoiced'])


def downgrade() -> None:
    # Drop index and columns from wm_scope_items
    op.drop_index('ix_wm_scope_items_invoiced', table_name='wm_scope_items')
    op.drop_column('wm_scope_items', 'invoiced_at')
    op.drop_column('wm_scope_items', 'invoiced')

    # Drop wm_scope_item_invoice_links table
    op.drop_index('ix_wm_scope_item_invoice_links_invoice_item', table_name='wm_scope_item_invoice_links')
    op.drop_index('ix_wm_scope_item_invoice_links_scope_item', table_name='wm_scope_item_invoice_links')
    op.drop_index('ix_wm_scope_item_invoice_links_scope_invoice', table_name='wm_scope_item_invoice_links')
    op.drop_table('wm_scope_item_invoice_links')

    # Drop wm_scope_invoices table
    op.drop_index('ix_wm_scope_invoices_invoice', table_name='wm_scope_invoices')
    op.drop_index('ix_wm_scope_invoices_job', table_name='wm_scope_invoices')
    op.drop_table('wm_scope_invoices')
