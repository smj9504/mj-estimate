"""add water damage repair fields

Revision ID: c3d4e5f6g7h8
Revises: b2c3d4e5f6g7
Create Date: 2026-05-22 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'c3d4e5f6g7h8'
down_revision = 'b2c3d4e5f6g7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('bathroom_estimates',
                  sa.Column('demo_already_done', sa.Boolean(),
                            server_default='false', nullable=True))
    op.add_column('bathroom_estimates',
                  sa.Column('repair_drywall_walls', sa.Boolean(),
                            server_default='false', nullable=True))
    op.add_column('bathroom_estimates',
                  sa.Column('repair_drywall_walls_sf', sa.Float(),
                            nullable=True))
    op.add_column('bathroom_estimates',
                  sa.Column('repair_drywall_ceiling', sa.Boolean(),
                            server_default='false', nullable=True))
    op.add_column('bathroom_estimates',
                  sa.Column('repair_drywall_ceiling_sf', sa.Float(),
                            nullable=True))
    op.add_column('bathroom_estimates',
                  sa.Column('repair_subfloor', sa.Boolean(),
                            server_default='false', nullable=True))
    op.add_column('bathroom_estimates',
                  sa.Column('repair_subfloor_sf', sa.Float(),
                            nullable=True))


def downgrade() -> None:
    op.drop_column('bathroom_estimates', 'repair_subfloor_sf')
    op.drop_column('bathroom_estimates', 'repair_subfloor')
    op.drop_column('bathroom_estimates', 'repair_drywall_ceiling_sf')
    op.drop_column('bathroom_estimates', 'repair_drywall_ceiling')
    op.drop_column('bathroom_estimates', 'repair_drywall_walls_sf')
    op.drop_column('bathroom_estimates', 'repair_drywall_walls')
    op.drop_column('bathroom_estimates', 'demo_already_done')
