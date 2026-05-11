"""Add cement board demo/repair and bathtub surround tile fields

Revision ID: k1l2m3n4o5p6
Revises: 7016b23b7ca6
Create Date: 2026-05-09

Adds:
  - demo_cement_board, demo_cement_board_sf (Phase 1: demo water-damaged cement board)
  - replace_cement_board, replace_cement_board_sf (Phase 3: install new cement board)
  - bathtub surround tile stored in bathtub_spec JSONB (no schema change needed)
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'k1l2m3n4o5p6'
down_revision = '7016b23b7ca6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bathroom_estimates") as batch_op:
        batch_op.add_column(sa.Column("demo_cement_board", sa.Boolean(), default=False))
        batch_op.add_column(sa.Column("demo_cement_board_sf", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("replace_cement_board", sa.Boolean(), default=False))
        batch_op.add_column(sa.Column("replace_cement_board_sf", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("bathroom_estimates") as batch_op:
        batch_op.drop_column("replace_cement_board_sf")
        batch_op.drop_column("replace_cement_board")
        batch_op.drop_column("demo_cement_board_sf")
        batch_op.drop_column("demo_cement_board")
