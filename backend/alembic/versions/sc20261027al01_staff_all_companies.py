"""a staff member can belong to every company, including ones added later

staff.all_companies: when true the person sees the claims and cash jobs of
every company, as if picked for each one. Their picked companies
(staff_companies) still decide where new work of theirs goes by default.

Revision ID: sc20261027al01
Revises: sc20261027co01
Create Date: 2026-10-27
"""

from alembic import op
import sqlalchemy as sa

revision = "sc20261027al01"
down_revision = "sc20261027co01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "staff",
        sa.Column("all_companies", sa.Boolean(), nullable=False,
                  server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("staff", "all_companies")
