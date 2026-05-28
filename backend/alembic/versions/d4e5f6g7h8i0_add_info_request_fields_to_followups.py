"""add info request fields to supplement_followups

Revision ID: d4e5f6g7h8i0
Revises: e5f6g7h8i9j1
Create Date: 2025-05-28

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'd4e5f6g7h8i0'
down_revision = 'e5f6g7h8i9j1'
branch_labels = None
depends_on = None


def _column_exists(table, column):
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name=:table AND column_name=:column"
    ), {"table": table, "column": column})
    return result.fetchone() is not None


def upgrade() -> None:
    columns = [
        ('followup_type', sa.Column('followup_type', sa.String(30), nullable=False, server_default='general')),
        ('items_needed', sa.Column('items_needed', JSONB, nullable=True)),
        ('request_to_type', sa.Column('request_to_type', sa.String(50), nullable=True)),
        ('info_status', sa.Column('info_status', sa.String(30), nullable=False, server_default='pending')),
        ('follow_up_count', sa.Column('follow_up_count', sa.Integer, nullable=False, server_default='0')),
        ('last_follow_up_date', sa.Column('last_follow_up_date', sa.DateTime(timezone=True), nullable=True)),
    ]
    for col_name, col_def in columns:
        if not _column_exists('supplement_followups', col_name):
            op.add_column('supplement_followups', col_def)


def downgrade() -> None:
    op.drop_column('supplement_followups', 'last_follow_up_date')
    op.drop_column('supplement_followups', 'follow_up_count')
    op.drop_column('supplement_followups', 'info_status')
    op.drop_column('supplement_followups', 'request_to_type')
    op.drop_column('supplement_followups', 'items_needed')
    op.drop_column('supplement_followups', 'followup_type')
