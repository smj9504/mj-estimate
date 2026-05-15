"""Add electrical, permit, outlet relocation fields to cabinet_estimates

Revision ID: t4u5v6w7x8y9
Revises: s3t4u5v6w7x8
Create Date: 2026-05-15
"""
from alembic import op
import sqlalchemy as sa

revision = 't4u5v6w7x8y9'
down_revision = 's3t4u5v6w7x8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cabinet_estimates",
        sa.Column("include_electrical", sa.Boolean(),
                  server_default="false", nullable=False),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("include_permit", sa.Boolean(),
                  server_default="false", nullable=False),
    )
    op.add_column(
        "cabinet_estimates",
        sa.Column("outlet_relocation_count", sa.Integer(),
                  server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("cabinet_estimates", "outlet_relocation_count")
    op.drop_column("cabinet_estimates", "include_permit")
    op.drop_column("cabinet_estimates", "include_electrical")
