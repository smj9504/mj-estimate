"""add show_insurance to invoices

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-03-31 12:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add show_insurance column to invoices table, default False"""
    op.add_column('invoices', sa.Column('show_insurance', sa.Boolean(), nullable=True, server_default=sa.text('false')))

    # Set show_insurance=true for existing invoices that have insurance data
    op.execute(
        "UPDATE invoices SET show_insurance = true "
        "WHERE insurance_company IS NOT NULL OR insurance_claim_number IS NOT NULL"
    )


def downgrade() -> None:
    """Remove show_insurance column"""
    op.drop_column('invoices', 'show_insurance')
