"""make invoice client_name nullable

Revision ID: d5a3b8c7f9e2
Revises: c8d9e2f4a5b6
Create Date: 2025-01-26 17:25:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'd5a3b8c7f9e2'
down_revision = 'c8d9e2f4a5b6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Make client_name nullable in invoices table"""
    op.alter_column('invoices', 'client_name',
                    existing_type=sa.String(255),
                    nullable=True)


def downgrade() -> None:
    """Revert client_name to NOT NULL"""
    # First, update any NULL values to empty string to avoid constraint violation
    op.execute("UPDATE invoices SET client_name = '' WHERE client_name IS NULL")

    op.alter_column('invoices', 'client_name',
                    existing_type=sa.String(255),
                    nullable=False)
