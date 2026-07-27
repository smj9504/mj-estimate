"""Add note column to invoice_items table

Revision ID: i1j2k3l4m5n5
Revises: dep20260716dp01
Create Date: 2026-07-24

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'i1j2k3l4m5n5'
down_revision = 'dep20260716dp01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add note column to invoice_items if it doesn't exist
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name='invoice_items' AND column_name='note'"
    ))
    if result.fetchone() is None:
        op.add_column(
            'invoice_items',
            sa.Column('note', sa.Text(), nullable=True)
        )


def downgrade() -> None:
    op.drop_column('invoice_items', 'note')
