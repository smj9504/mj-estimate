"""add sketch_data to bathroom_estimate

Revision ID: q1r2s3t4u5v6
Revises: k1l2m3n4o5p6
Create Date: 2026-05-10

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = "q1r2s3t4u5v6"
down_revision = "k1l2m3n4o5p6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bathroom_estimates",
        sa.Column("sketch_data", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("bathroom_estimates", "sketch_data")
