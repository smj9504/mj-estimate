"""Add payment_schedule JSON column to estimates table

Revision ID: ps20260717
Revises: y6z7a8b9c0d1
Create Date: 2026-07-17
"""

from alembic import op
from sqlalchemy import text


revision = 'ps20260717'
down_revision = None  # Will auto-detect
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    # Check if column already exists
    try:
        result = conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'estimates' "
                "AND column_name = 'payment_schedule'"
            )
        )
        if result.fetchone():
            return  # Column already exists
    except Exception:
        pass

    # Add payment_schedule column
    op.execute(
        text("ALTER TABLE estimates ADD COLUMN payment_schedule JSON")
    )


def downgrade():
    op.execute(
        text("ALTER TABLE estimates DROP COLUMN IF EXISTS payment_schedule")
    )
