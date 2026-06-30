"""Add electrician_report_id to claims

Revision ID: a1b2c3d4e5g8
Revises: wm20260624cm01
Create Date: 2026-06-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5g8"
down_revision = "wm20260624cm01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "claims",
        sa.Column(
            "electrician_report_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("electrician_reports.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("claims", "electrician_report_id")
