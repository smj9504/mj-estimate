"""make plumber_report client_name nullable

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-03-30 17:15:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'e5f6a7b8c9d0'
down_revision = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Make client_name nullable in plumber_reports table"""
    op.alter_column('plumber_reports', 'client_name',
                    existing_type=sa.String(),
                    nullable=True)


def downgrade() -> None:
    """Revert client_name to NOT NULL"""
    op.execute(
        "UPDATE plumber_reports SET client_name = '' "
        "WHERE client_name IS NULL"
    )
    op.alter_column('plumber_reports', 'client_name',
                    existing_type=sa.String(),
                    nullable=False)
