"""add w9_file_id to companies

Revision ID: e5f6g7h8i9j1
Revises: None
Create Date: 2024-12-20

"""
from alembic import op
import sqlalchemy as sa

revision = 'e5f6g7h8i9j1'
down_revision = 'c3d4e5f6g7h8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='companies' AND column_name='w9_file_id'"
    ))
    if not result.fetchone():
        op.add_column(
            'companies',
            sa.Column(
                'w9_file_id',
                sa.String(36),
                nullable=True,
                comment='File ID for company W-9 document',
            ),
        )


def downgrade() -> None:
    op.drop_column('companies', 'w9_file_id')
