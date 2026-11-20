"""add the claim closeouts table

claim_closeouts: what closing or denying a claim did to its rebuild projects,
supplements, follow-up tasks and WM jobs, item by item with the status before
and after, so reopening the claim can put each back.

The app's startup also creates missing tables, so it is created only if it
isn't there yet.

Revision ID: cco20261120tb01
Revises: rbe20261116nt05
Create Date: 2026-11-20
"""

from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "cco20261120tb01"
down_revision = "rbe20261116nt05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if sa.inspect(conn).has_table("claim_closeouts"):
        return
    op.create_table(
        "claim_closeouts",
        sa.Column("id", UUIDType(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.Column("claim_id", UUIDType(), sa.ForeignKey("claims.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_status", sa.String(50)),
        sa.Column("to_status", sa.String(50), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("created_by_id", UUIDType(), sa.ForeignKey("staff.id"), nullable=True),
        sa.Column("reopened_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_claim_closeouts_id", "claim_closeouts", ["id"])
    op.create_index("ix_claim_closeouts_claim_id", "claim_closeouts", ["claim_id"])


def downgrade() -> None:
    conn = op.get_bind()
    if sa.inspect(conn).has_table("claim_closeouts"):
        op.drop_table("claim_closeouts")
