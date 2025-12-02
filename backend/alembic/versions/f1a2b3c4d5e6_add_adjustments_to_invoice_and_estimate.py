"""add adjustments to invoice and estimate

Revision ID: f1a2b3c4d5e6
Revises: d5a3b8c7f9e2
Create Date: 2025-01-27 10:00:00.000000

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'f1a2b3c4d5e6'
down_revision = 'd5a3b8c7f9e2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add adjustments JSON field to invoices and estimates tables"""
    # Add adjustments column to invoices table
    op.add_column(
        'invoices',
        sa.Column(
            'adjustments',
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
            server_default='[]'
        )
    )

    # Add adjustments column to estimates table
    op.add_column(
        'estimates',
        sa.Column(
            'adjustments',
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
            server_default='[]'
        )
    )

    # Update existing rows to have empty array as default
    op.execute(
        "UPDATE invoices SET adjustments = '[]' WHERE adjustments IS NULL"
    )
    op.execute(
        "UPDATE estimates SET adjustments = '[]' WHERE adjustments IS NULL"
    )


def downgrade() -> None:
    """Remove adjustments column from invoices and estimates tables"""
    op.drop_column('estimates', 'adjustments')
    op.drop_column('invoices', 'adjustments')
