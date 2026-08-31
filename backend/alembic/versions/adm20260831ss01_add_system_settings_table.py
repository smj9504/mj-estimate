"""Add system_settings table

Revision ID: adm20260831ss01
Revises: ei20260831sm01
Create Date: 2026-08-31

Simple global key-value store for admin-toggleable runtime settings
(e.g. ROUTE_PERSONAL_ACCOUNTS_THROUGH_FALLBACK) that shouldn't require a
redeploy to change.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'adm20260831ss01'
down_revision = 'ei20260831sm01'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'system_settings',
        sa.Column('key', sa.String(length=100), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('key'),
    )


def downgrade():
    op.drop_table('system_settings')
