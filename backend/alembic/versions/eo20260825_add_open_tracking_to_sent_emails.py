"""Add open tracking fields to sent_emails

Revision ID: eo20260825ot01
Revises: asi01a2b3c4d5
Create Date: 2026-08-25

Adds opened_at / open_count / last_opened_at so outbound emails sent via
the claim follow-up module can record pixel-based open tracking.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'eo20260825ot01'
down_revision = 'asi01a2b3c4d5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'sent_emails',
        sa.Column('opened_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'sent_emails',
        sa.Column('open_count', sa.Integer(), nullable=True, server_default='0'),
    )
    op.add_column(
        'sent_emails',
        sa.Column('last_opened_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('sent_emails', 'last_opened_at')
    op.drop_column('sent_emails', 'open_count')
    op.drop_column('sent_emails', 'opened_at')
