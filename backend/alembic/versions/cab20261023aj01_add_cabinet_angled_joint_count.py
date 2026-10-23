"""add cabinet angled joint count

An island or run that turns at an angle other than 90° keeps square
boxes and takes the angle up at each joint: a 45° angled filler, extra
fitting, and an angled countertop cut. The estimator had no way to bill
any of it, so angled layouts were priced as if every turn were square.

Revision ID: cab20261023aj01
Revises: wm20261023inv01
Create Date: 2026-10-23
"""

from alembic import op
import sqlalchemy as sa

revision = "cab20261023aj01"
down_revision = "wm20261023inv01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cabinet_estimates",
        sa.Column("angled_joint_count", sa.Integer(),
                  nullable=True, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("cabinet_estimates", "angled_joint_count")
