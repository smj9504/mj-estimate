"""add the rebuild wordings table

rebuild_wordings: a company's own words for a price list line, by its code
and the activity it is added as, so a rebuild estimate never prints
Xactimate's descriptions as they are (owner, 2026-11-13). A row with no
company is everyone's.

Revision ID: rbe20261113wd03
Revises: rbe20261113sc02
Create Date: 2026-11-13
"""

from alembic import op
import sqlalchemy as sa

from app.core.database_types import UUIDType

revision = "rbe20261113wd03"
down_revision = "rbe20261113sc02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if sa.inspect(conn).has_table("rebuild_wordings"):
        return
    op.create_table(
        "rebuild_wordings",
        sa.Column("id", UUIDType(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.Column("company_id", UUIDType(), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=True),
        sa.Column("item_code", sa.String(50), nullable=False),
        sa.Column("activity", sa.String(2), nullable=False),
        sa.Column("text", sa.String(500), nullable=False),
        sa.Column("updated_by_id", UUIDType(), sa.ForeignKey("staff.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_rebuild_wordings_id", "rebuild_wordings", ["id"])
    op.create_index("ix_rebuild_wordings_code", "rebuild_wordings", ["item_code", "activity"])


def downgrade() -> None:
    conn = op.get_bind()
    if sa.inspect(conn).has_table("rebuild_wordings"):
        op.drop_table("rebuild_wordings")
