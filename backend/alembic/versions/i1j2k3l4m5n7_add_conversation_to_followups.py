"""add conversation to supplement followups

Revision ID: i1j2k3l4m5n7
Revises: h8i9j0k1l2m4
Create Date: 2026-06-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'i1j2k3l4m5n7'
down_revision = 'h8i9j0k1l2m4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'supplement_followups',
        sa.Column('conversation', JSONB, default=list,
                  comment='Chronological list of sent/received messages'),
    )


def downgrade() -> None:
    op.drop_column('supplement_followups', 'conversation')
