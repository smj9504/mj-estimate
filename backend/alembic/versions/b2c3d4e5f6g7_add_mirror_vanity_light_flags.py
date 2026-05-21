"""Add mirror/vanity_light flags + detach_reset_mirror to bathroom_estimates

Revision ID: b2c3d4e5f6g7
Revises: z7a8b9c0d1e2
Create Date: 2026-05-21

Adds replace_mirror, detach_reset_mirror, replace_vanity_light,
detach_reset_vanity_light boolean columns.
"""
from alembic import op
import sqlalchemy as sa

revision = 'b2c3d4e5f6g7'
down_revision = ('z7a8b9c0d1e2', 'x8y9z0a1b2c3')
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [c["name"] for c in inspector.get_columns("bathroom_estimates")]

    for col in ['replace_mirror', 'detach_reset_mirror', 'replace_vanity_light', 'detach_reset_vanity_light']:
        if col not in columns:
            op.add_column(
                'bathroom_estimates',
                sa.Column(col, sa.Boolean(), nullable=True, server_default='false'),
            )


def downgrade() -> None:
    for col in ['detach_reset_vanity_light', 'replace_vanity_light', 'detach_reset_mirror', 'replace_mirror']:
        op.drop_column('bathroom_estimates', col)
