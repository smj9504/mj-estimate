"""Add wm_invoice_item_configs table

Revision ID: 5337888d6feb
Revises: 51d44a63c7d0
Create Date: 2026-01-15 17:54:15.798365

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '5337888d6feb'
down_revision = '51d44a63c7d0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('wm_invoice_item_configs',
        sa.Column('id', sa.UUID(), nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('job_id', sa.UUID(), nullable=False, comment='Water mitigation job reference'),
        sa.Column('scope_item_id', sa.UUID(), nullable=True, comment='Specific scope item this config applies to'),
        sa.Column('standard_scope_item_id', sa.UUID(), nullable=True, comment='Standard scope item for default config'),
        sa.Column('line_item_id', sa.UUID(), nullable=True, comment='Target line item for invoice'),
        sa.Column('custom_name', sa.String(length=255), nullable=True, comment='Custom line item name'),
        sa.Column('custom_description', sa.Text(), nullable=True, comment='Custom line item description'),
        sa.Column('custom_rate', sa.DECIMAL(precision=12, scale=4), nullable=True, comment='Custom rate'),
        sa.Column('custom_unit', sa.String(length=20), nullable=True, comment='Custom unit (SF, LF, EA)'),
        sa.Column('quantity_calc_type', sa.String(length=30), nullable=False, server_default='fixed',
                  comment="Quantity calculation type: 'fixed', 'per_day', 'per_day_capped'"),
        sa.Column('max_days', sa.Integer(), nullable=True, comment='Maximum days for per_day_capped calculation'),
        sa.Column('default_note', sa.Text(), nullable=True, comment='Default note to include in invoice item description'),
        sa.Column('is_enabled', sa.Boolean(), nullable=True, server_default='true', comment='Whether to include in invoice'),
        sa.Column('display_order', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['job_id'], ['water_mitigation_jobs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['line_item_id'], ['line_items.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['scope_item_id'], ['wm_scope_items.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['standard_scope_item_id'], ['wm_standard_scope_items.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_wm_invoice_item_configs_job', 'wm_invoice_item_configs', ['job_id'], unique=False)
    op.create_index('ix_wm_invoice_item_configs_scope_item', 'wm_invoice_item_configs', ['scope_item_id'], unique=False)
    op.create_index('ix_wm_invoice_item_configs_line_item', 'wm_invoice_item_configs', ['line_item_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_wm_invoice_item_configs_line_item', table_name='wm_invoice_item_configs')
    op.drop_index('ix_wm_invoice_item_configs_scope_item', table_name='wm_invoice_item_configs')
    op.drop_index('ix_wm_invoice_item_configs_job', table_name='wm_invoice_item_configs')
    op.drop_table('wm_invoice_item_configs')
