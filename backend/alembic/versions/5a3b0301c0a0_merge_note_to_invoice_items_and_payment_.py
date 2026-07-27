"""merge note_to_invoice_items and payment_schedule

Revision ID: 5a3b0301c0a0
Revises: i1j2k3l4m5n5, ps20260717
Create Date: 2026-07-24 18:01:07.109144

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '5a3b0301c0a0'
down_revision = ('i1j2k3l4m5n5', 'ps20260717')
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
