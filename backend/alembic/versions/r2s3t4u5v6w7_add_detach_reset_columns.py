"""add detach_reset columns to bathroom_estimates

Revision ID: r2s3t4u5v6w7
Revises: q1r2s3t4u5v6
Create Date: 2026-05-12

"""
from alembic import op
import sqlalchemy as sa

revision = "r2s3t4u5v6w7"
down_revision = "q1r2s3t4u5v6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bathroom_estimates", sa.Column("detach_reset_shower", sa.Boolean(), server_default="false"))
    op.add_column("bathroom_estimates", sa.Column("detach_reset_tub", sa.Boolean(), server_default="false"))
    op.add_column("bathroom_estimates", sa.Column("detach_reset_vanity", sa.Boolean(), server_default="false"))
    op.add_column("bathroom_estimates", sa.Column("detach_reset_toilet", sa.Boolean(), server_default="false"))


def downgrade() -> None:
    op.drop_column("bathroom_estimates", "detach_reset_toilet")
    op.drop_column("bathroom_estimates", "detach_reset_vanity")
    op.drop_column("bathroom_estimates", "detach_reset_tub")
    op.drop_column("bathroom_estimates", "detach_reset_shower")
